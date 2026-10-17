/**
 * DemoForge voices — opt-in cloned narration voices.
 *
 * A voice profile is a short recording of a person reading a fixed passage,
 * which a zero-shot model (Chatterbox) conditions on to speak new text in
 * that voice. Profiles live only on this machine (default ~/.demoforge/voices)
 * and each one records how consent was given: the speaker reads a consent
 * statement aloud, and a local transcription must match it.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface VoiceConsent {
  /** The statement the speaker was asked to read. */
  statement: string;
  /** What local transcription heard. */
  transcript: string;
  /** Fraction of statement words heard, in order (0–1). */
  matchScore: number;
  verified: boolean;
  method: 'spoken-statement';
  source: 'microphone' | 'file';
}

export interface VoiceProfile {
  name: string;
  /** Speaker's name as stated in the consent line. */
  speaker: string;
  createdAt: string;
  engine: 'chatterbox';
  /** Conditioning clip for the model (absolute path). */
  reference: string;
  /** Full cleaned-up recording (absolute path). */
  recording: string;
  /** sha256 of the reference clip; part of synthesis cache keys. */
  sha256: string;
  durationSec: number;
  consent: VoiceConsent;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function isValidVoiceName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

/** Where voice profiles are stored. */
export function voicesDir(): string {
  return process.env.DEMOFORGE_VOICES_DIR ?? path.join(os.homedir(), '.demoforge', 'voices');
}

export function voiceDir(name: string): string {
  if (!isValidVoiceName(name)) {
    throw new Error(`Invalid voice name "${name}": use lowercase letters, digits, - or _ (max 32)`);
  }
  return path.join(voicesDir(), name);
}

export function loadVoiceProfile(name: string): VoiceProfile | null {
  if (!isValidVoiceName(name)) return null;
  const file = path.join(voiceDir(name), 'profile.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as VoiceProfile;
}

export function saveVoiceProfile(profile: VoiceProfile): string {
  const dir = voiceDir(profile.name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'profile.json');
  fs.writeFileSync(file, JSON.stringify(profile, null, 2), { mode: 0o600 });
  return file;
}

export function listVoiceProfiles(): VoiceProfile[] {
  const dir = voicesDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => loadVoiceProfile(name))
    .filter((p): p is VoiceProfile => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Delete a profile and every file recorded for it. */
export function deleteVoiceProfile(name: string): boolean {
  const dir = voiceDir(name);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * A profile usable for synthesis: present, consent verified, and its
 * reference clip unchanged since enrollment.
 */
export function usableVoiceProfile(name: string): VoiceProfile | null {
  const profile = loadVoiceProfile(name);
  if (!profile || !profile.consent?.verified || !fs.existsSync(profile.reference)) return null;
  return sha256File(profile.reference) === profile.sha256 ? profile : null;
}

// ─── Toolchain ───────────────────────────────────────────────────────────────

export interface VoiceToolchain {
  python: string;
  worker: string;
}

/**
 * Locate the Python voice toolchain (tools/voice). DEMOFORGE_VOICE_DIR
 * overrides; otherwise search upward from this module for the repo's tools/.
 */
export function findVoiceToolchain(): VoiceToolchain | null {
  const candidates: string[] = [];
  if (process.env.DEMOFORGE_VOICE_DIR) candidates.push(process.env.DEMOFORGE_VOICE_DIR);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    candidates.push(path.join(dir, 'tools', 'voice'));
    dir = path.dirname(dir);
  }
  for (const candidate of candidates) {
    const python = path.join(candidate, '.venv', 'bin', 'python');
    const worker = path.join(candidate, 'voice_worker.py');
    if (fs.existsSync(python) && fs.existsSync(worker)) return { python, worker };
  }
  return null;
}
