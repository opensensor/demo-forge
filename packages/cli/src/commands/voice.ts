/**
 * DemoForge CLI — voice command.
 *
 * Opt-in cloned narration voices:
 *   demoforge voice create <name>        record a consent line + passage, build a profile
 *   demoforge voice create <name> --from recording.wav
 *   demoforge voice test <name> [text]   speak a line in the voice
 *   demoforge voice list
 *   demoforge voice delete <name>
 *
 * Scripts then use `voice: <name>`. Everything stays on this machine.
 */

import { Command } from "commander";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createLogger } from "@demoforge/core";
import {
  ChatterboxBackend,
  deleteVoiceProfile,
  findVoiceToolchain,
  isValidVoiceName,
  listVoiceProfiles,
  loadVoiceProfile,
  saveVoiceProfile,
  sha256File,
  voiceDir,
  type VoiceProfile,
} from "@demoforge/renderer";

type Logger = ReturnType<typeof createLogger>;

/** Minimum consent-statement match (fraction of words heard, in order). */
const CONSENT_THRESHOLD = 0.8;
const MIN_SPEECH_SECONDS = 20;
const REFERENCE_SECONDS = 12;

export function consentStatement(speaker: string): string {
  return `I, ${speaker}, agree to let DemoForge make a synthetic copy of my voice on this computer for narrating demo videos.`;
}

/** Phonetically varied reading (the Rainbow Passage) plus narration-style lines. */
export const READING_PASSAGE = [
  "When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow.",
  "The rainbow is a division of white light into many beautiful colors.",
  "These take the shape of a long round arch, with its path high above,",
  "and its two ends apparently beyond the horizon.",
  "Welcome to the demo. Here you can see every camera live,",
  "browse recordings by date, and jump straight to the moment something happened.",
  "Setup only takes a few minutes, and everything runs on your own hardware.",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Fraction of `expected` words found in order within `heard` (LCS / |expected|). */
export function inOrderMatch(expected: string[], heard: string[]): number {
  if (expected.length === 0) return 0;
  const dp = Array.from({ length: expected.length + 1 }, () => new Array<number>(heard.length + 1).fill(0));
  for (let i = 1; i <= expected.length; i++) {
    for (let j = 1; j <= heard.length; j++) {
      dp[i]![j] =
        expected[i - 1] === heard[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  return dp[expected.length]![heard.length]! / expected.length;
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((done) =>
    rl.question(question, (answer) => {
      rl.close();
      done(answer.trim());
    }),
  );
}

function ffmpeg(args: string[]): string {
  const res = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", ...args], { encoding: "utf-8" });
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${res.stderr.trim().split("\n").slice(-3).join(" | ")}`);
  return res.stderr;
}

function audioStats(file: string): { duration: number; meanDb: number; maxDb: number } {
  const log = ffmpeg(["-i", file, "-af", "volumedetect", "-f", "null", "-"]);
  const num = (re: RegExp) => parseFloat(log.match(re)?.[1] ?? "NaN");
  const [h, m, s] = (log.match(/Duration: (\d+):(\d+):([\d.]+)/)?.slice(1) ?? ["0", "0", "0"]).map(Number);
  return {
    duration: (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0),
    meanDb: num(/mean_volume: (-?[\d.]+) dB/),
    maxDb: num(/max_volume: (-?[\d.]+) dB/),
  };
}

function transcribe(file: string): { text: string; segments: Array<{ start: number; end: number; text: string }> } {
  const toolchain = findVoiceToolchain();
  if (!toolchain) throw new Error("Voice toolchain not installed — run tools/voice/setup.sh");
  const res = spawnSync(toolchain.python, ["-I", toolchain.worker, "transcribe", file], {
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`transcription failed: ${res.stderr.trim().split("\n").slice(-3).join(" | ")}`);
  return JSON.parse(res.stdout.trim().split("\n").pop() ?? "{}");
}

function play(file: string): void {
  for (const player of [["pw-play", file], ["aplay", "-q", file], ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", file]]) {
    const res = spawnSync(player[0]!, player.slice(1), { stdio: "ignore" });
    if (!res.error) return;
  }
}

/** Record mono 48 kHz from the default (or given) source until Enter, or for `seconds`. */
async function record(out: string, options: { device?: string; seconds?: number }): Promise<void> {
  const hasPw = !spawnSync("pw-record", ["--help"], { stdio: "ignore" }).error;
  const [cmd, args] = hasPw
    ? ["pw-record", ["--rate", "48000", "--channels", "1", "--format", "s16", ...(options.device ? ["--target", options.device] : []), out]]
    : ["arecord", ["-q", "-f", "S16_LE", "-r", "48000", "-c", "1", ...(options.device ? ["-D", options.device] : []), out]];

  const proc = spawn(cmd, args as string[], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
  const started = Date.now();
  const timer = setInterval(() => {
    const t = Math.floor((Date.now() - started) / 1000);
    const hint = options.seconds ? `${options.seconds - t}s left` : "press Enter to stop";
    process.stdout.write(`\r  ● REC ${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}  (${hint})   `);
  }, 250);

  const exited = new Promise<number | null>((done) => proc.on("exit", done));
  if (options.seconds) {
    await Promise.race([new Promise((r) => setTimeout(r, options.seconds! * 1000)), exited]);
  } else {
    await Promise.race([ask(""), exited]);
  }
  clearInterval(timer);
  process.stdout.write("\n");
  proc.kill("SIGINT");
  await exited;
  if (!existsSync(out)) throw new Error(`recording failed (${cmd}): ${stderr.trim()}`);
}

// ─── Enrollment ──────────────────────────────────────────────────────────────

interface CreateOptions {
  from?: string;
  speaker?: string;
  device?: string;
  duration?: string;
  force?: boolean;
  play: boolean;
}

async function createVoice(name: string, options: CreateOptions, logger: Logger): Promise<void> {
  if (!isValidVoiceName(name)) throw new Error(`Invalid voice name "${name}": use lowercase letters, digits, - or _`);
  if (loadVoiceProfile(name) && !options.force) throw new Error(`Voice "${name}" exists — use --force to replace it`);
  if (!findVoiceToolchain()) throw new Error("Voice toolchain not installed — run tools/voice/setup.sh");

  const interactive = process.stdin.isTTY && !options.duration;
  const speaker = options.speaker ?? (interactive ? await ask("Your name (as you'll say it in the consent line): ") : "");
  if (!speaker) throw new Error("Pass --speaker \"Your Name\" (the name you say in the consent line)");
  const statement = consentStatement(speaker);

  const work = mkdtempSync(join(tmpdir(), "demoforge-enroll-"));
  try {
    const raw = join(work, "raw.wav");
    if (options.from) {
      copyFileSync(resolve(options.from), raw);
    } else {
      console.log(
        [
          "",
          "DemoForge voice setup — this makes a synthetic copy of YOUR voice, stored only on this computer.",
          "Only record your own voice. Output is watermarked by the model. `demoforge voice delete` removes it.",
          "",
          "Read both parts aloud in your normal narration voice (about 30–45 seconds):",
          "",
          "  1. Consent:",
          `     "${statement}"`,
          "",
          "  2. Passage:",
          ...READING_PASSAGE.map((line) => `     ${line}`),
          "",
          "Tips: quiet room, mic a hand's width away, steady pace — speak the way you'd narrate a demo.",
          "",
        ].join("\n"),
      );
      if (interactive) {
        await ask("Press Enter to start recording… ");
        await record(raw, { device: options.device });
      } else {
        const seconds = parseInt(options.duration ?? "50", 10);
        for (let n = 3; n > 0; n--) {
          process.stdout.write(`\r  Recording starts in ${n}… `);
          await new Promise((r) => setTimeout(r, 1000));
        }
        process.stdout.write("\n");
        await record(raw, { device: options.device, seconds });
      }
    }

    // ── Clean up: high-pass, trim silence at both ends, normalize, 24 kHz mono.
    const rawStats = audioStats(raw);
    const clean = join(work, "recording.wav");
    const trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.2";
    ffmpeg(["-y", "-i", raw, "-af", `highpass=f=80,${trim},areverse,${trim},areverse,loudnorm=I=-20:TP=-2:LRA=11`, "-ar", "24000", "-ac", "1", clean]);
    const stats = audioStats(clean);
    logger.info(`Recorded ${stats.duration.toFixed(1)}s (peak ${rawStats.maxDb} dB, average ${rawStats.meanDb} dB).`);
    if (rawStats.meanDb < -45) throw new Error("Recording is nearly silent — check the microphone/input level and try again.");
    if (rawStats.maxDb >= -0.1) logger.warn("Recording clipped at peaks; lower the mic gain for a cleaner voice.");
    if (stats.duration < MIN_SPEECH_SECONDS) {
      throw new Error(`Only ${stats.duration.toFixed(0)}s of audio — read the full consent line and passage (≥ ${MIN_SPEECH_SECONDS}s).`);
    }

    // ── Consent: the statement must be heard, in order, at the start.
    logger.info("Checking the consent statement (local transcription)…");
    const heard = transcribe(clean);
    const expected = words(statement);
    const heardWords = words(heard.text);
    const score = inOrderMatch(expected, heardWords.slice(0, expected.length + 20));
    if (score < CONSENT_THRESHOLD) {
      throw new Error(
        `Couldn't verify the consent statement (${Math.round(score * 100)}% match). Heard: "${heard.text.slice(0, 160)}…". ` +
          "Read it clearly at the start and try again.",
      );
    }
    logger.info(`Consent verified (${Math.round(score * 100)}% match).`);

    // ── Reference clip: the passage right after the consent line.
    let count = 0;
    let consentEnd = 0;
    for (const segment of heard.segments) {
      count += words(segment.text).length;
      consentEnd = segment.end;
      if (count >= expected.length * 0.9) break;
    }
    const remaining = stats.duration - consentEnd;
    if (remaining < 8) throw new Error("Not enough of the passage was recorded after the consent line.");
    const reference = join(work, "reference.wav");
    ffmpeg(["-y", "-ss", (consentEnd + 0.15).toFixed(2), "-t", String(Math.min(REFERENCE_SECONDS, remaining)), "-i", clean, reference]);

    // ── Save the profile.
    const dir = voiceDir(name);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    const profile: VoiceProfile = {
      name,
      speaker,
      createdAt: new Date().toISOString(),
      engine: "chatterbox",
      reference: join(dir, "reference.wav"),
      recording: join(dir, "recording.wav"),
      sha256: sha256File(reference),
      durationSec: Math.round(stats.duration * 10) / 10,
      consent: {
        statement,
        transcript: heard.text,
        matchScore: Math.round(score * 100) / 100,
        verified: true,
        method: "spoken-statement",
        source: options.from ? "file" : "microphone",
      },
    };
    saveVoiceProfile(profile);
    copyFileSync(reference, profile.reference);
    copyFileSync(clean, profile.recording);
    chmodSync(profile.reference, 0o600);
    chmodSync(profile.recording, 0o600);
    logger.info(`Saved voice "${name}" → ${dir}`);

    // ── Sample.
    logger.info("Generating a sample line in your voice (first run loads the model, ~30s)…");
    const sample = join(dir, "sample.wav");
    const result = await new ChatterboxBackend().synthesize(
      `Hi, this is ${speaker}. This narration was generated from a short recording of my voice.`,
      { voice: name },
    );
    writeFileSync(sample, result.audio, { mode: 0o600 });
    logger.info(`Sample: ${sample}`);
    if (options.play) play(sample);
    logger.info(`Use it with \`voice: ${name}\` in a script, or \`demoforge render … --voice ${name} --narration tts\`.`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ─── Command ─────────────────────────────────────────────────────────────────

export function createVoiceCommand(logger: Logger): Command {
  const voice = new Command("voice").description("Manage opt-in cloned narration voices (stored locally)");

  voice
    .command("create")
    .description("Record yourself reading a consent line and a short passage to create a narration voice")
    .argument("<name>", "Voice name to use in scripts (lowercase, e.g. matt)")
    .option("--from <wav>", "Use an existing recording instead of the microphone (must include the consent line)")
    .option("--speaker <name>", "Your name, as spoken in the consent line")
    .option("--device <target>", "Capture device (PipeWire target id/name, or ALSA device)")
    .option("--duration <seconds>", "Record for a fixed time instead of Enter-to-stop")
    .option("--force", "Replace an existing voice with the same name")
    .option("--no-play", "Don't play the sample when done")
    .action(async (name: string, options: CreateOptions) => {
      try {
        await createVoice(name, options, logger);
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  voice
    .command("test")
    .description("Speak a line in a voice")
    .argument("<name>", "Voice name")
    .argument("[text...]", "Text to speak")
    .option("-o, --out <wav>", "Write the audio here (default: <voice dir>/test.wav)")
    .option("--no-play", "Don't play it")
    .action(async (name: string, text: string[], options: { out?: string; play: boolean }) => {
      try {
        const line = text.length ? text.join(" ") : "Welcome to LightNVR, a lightweight network video recorder.";
        const result = await new ChatterboxBackend().synthesize(line, { voice: name });
        const out = resolve(options.out ?? join(voiceDir(name), "test.wav"));
        writeFileSync(out, result.audio);
        logger.info(`${(result.durationMs / 1000).toFixed(1)}s → ${out}`);
        if (options.play) play(out);
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  voice
    .command("list")
    .description("List voices on this machine")
    .action(() => {
      const profiles = listVoiceProfiles();
      if (profiles.length === 0) {
        logger.info("No voices yet. Create one with `demoforge voice create <name>`.");
        return;
      }
      for (const p of profiles) {
        const consent = p.consent?.verified ? `consent verified (${Math.round(p.consent.matchScore * 100)}%)` : "CONSENT NOT VERIFIED";
        console.log(`${p.name.padEnd(16)} ${p.speaker.padEnd(24)} ${p.createdAt.slice(0, 10)}  ${p.durationSec}s  ${consent}`);
      }
    });

  voice
    .command("delete")
    .description("Delete a voice and all of its recordings")
    .argument("<name>", "Voice name")
    .option("-y, --yes", "Don't ask for confirmation")
    .action(async (name: string, options: { yes?: boolean }) => {
      if (!loadVoiceProfile(name)) {
        logger.error(`No voice named "${name}".`);
        process.exit(1);
      }
      if (!options.yes) {
        const answer = await ask(`Delete voice "${name}" and its recordings? [y/N] `);
        if (!/^y(es)?$/i.test(answer)) return;
      }
      deleteVoiceProfile(name);
      logger.info(`Deleted voice "${name}".`);
    });

  return voice;
}
