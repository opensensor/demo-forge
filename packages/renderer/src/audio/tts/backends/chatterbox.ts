/**
 * DemoForge renderer — Chatterbox TTS backend (local voice cloning).
 *
 * Speaks in an enrolled voice profile (see `demoforge voice create`). The
 * `voice` option names the profile. A Python worker (tools/voice) loads the
 * model once and serves requests over JSON lines, so a script's narration is
 * synthesized without reloading the model per line. Output is watermarked by
 * Chatterbox.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createInterface } from 'node:readline';

import { findVoiceToolchain, usableVoiceProfile } from '../../voices/profiles.js';
import type { BackendSynthesizeOptions, SynthesisResult, TtsBackend } from '../types.js';

interface Pending {
  resolve: (reply: WorkerReply) => void;
  reject: (err: Error) => void;
}

interface WorkerReply {
  id: number;
  ok: boolean;
  duration_ms?: number;
  error?: string;
}

/** Long-lived worker shared by every backend instance in this process. */
class VoiceWorker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private stderrTail = '';

  request(body: Record<string, unknown>): Promise<WorkerReply> {
    const proc = this.ensure();
    const id = this.nextId++;
    // Keep Node alive only while a request is in flight.
    proc.ref();
    (proc.stdout as unknown as { ref(): void }).ref();
    return new Promise<WorkerReply>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      proc.stdin.write(`${JSON.stringify({ ...body, id })}\n`);
    }).finally(() => {
      if (this.pending.size === 0 && this.proc) {
        this.proc.unref();
        (this.proc.stdout as unknown as { unref(): void }).unref();
      }
    });
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc;
    const toolchain = findVoiceToolchain();
    if (!toolchain) throw new Error('Voice toolchain not installed — run tools/voice/setup.sh');

    const proc = spawn(toolchain.python, ['-I', toolchain.worker, 'serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stderr.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-2000);
    });
    createInterface({ input: proc.stdout }).on('line', (line) => {
      let reply: WorkerReply;
      try {
        reply = JSON.parse(line) as WorkerReply;
      } catch {
        return; // stray library output
      }
      const waiter = this.pending.get(reply.id);
      if (waiter) {
        this.pending.delete(reply.id);
        waiter.resolve(reply);
      }
    });
    proc.on('exit', (code) => {
      const err = new Error(`voice worker exited (${code}): ${this.stderrTail.trim().split('\n').slice(-3).join(' | ')}`);
      for (const waiter of this.pending.values()) waiter.reject(err);
      this.pending.clear();
      this.proc = null;
    });
    (proc.stderr as unknown as { unref(): void }).unref();
    this.proc = proc;
    return proc;
  }
}

const sharedWorker = new VoiceWorker();

export interface ChatterboxOptions {
  /** Emotion/intensity, 0.25–2 (default 0.5). */
  exaggeration?: number;
  /** Pacing/adherence to the reference, 0–1 (default 0.5). */
  cfgWeight?: number;
}

export class ChatterboxBackend implements TtsBackend {
  private options: ChatterboxOptions;

  constructor(options: ChatterboxOptions = {}) {
    this.options = options;
  }

  getName(): string {
    return 'chatterbox';
  }

  async isAvailable(): Promise<boolean> {
    return findVoiceToolchain() !== null;
  }

  async synthesize(text: string, options?: BackendSynthesizeOptions): Promise<SynthesisResult> {
    if (!text) return { audio: Buffer.alloc(0), durationMs: 0, text: '' };

    const voice = options?.voice ?? '';
    const profile = usableVoiceProfile(voice);
    if (!profile) {
      throw new Error(
        `No usable voice profile "${voice}" (missing, unverified consent, or modified reference). ` +
          'Create one with `demoforge voice create <name>`.',
      );
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demoforge-voice-'));
    const out = path.join(tmp, 'line.wav');
    try {
      const reply = await sharedWorker.request({
        text,
        ref: profile.reference,
        out,
        exaggeration: this.options.exaggeration ?? 0.5,
        cfg_weight: this.options.cfgWeight ?? 0.5,
      });
      if (!reply.ok) throw new Error(`Chatterbox synthesis failed: ${reply.error}`);
      return { audio: fs.readFileSync(out), durationMs: reply.duration_ms ?? 0, text };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}
