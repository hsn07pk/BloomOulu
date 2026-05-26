/**
 * Narration service — autonomously generates audio narrations per plant
 * per locale. Engine is selected at runtime:
 *
 *   macOS dev  → `say` + `ffmpeg`           (Samantha / Satu / Alva voices)
 *   Linux prod → `piper` + `ffmpeg`          (rhasspy/piper-tts, ONNX models)
 *
 * The two adapters produce a Buffer of m4a audio + duration in ms. Storage
 * is S3-compatible (MinIO in dev, S3/B2/R2 in prod). DB row is upserted
 * keyed by (plantId, locale) so reruns are idempotent.
 *
 * On every plant fetch, the controller asks `ensureGenerated(plant.id)` —
 * a fire-and-forget call that enqueues missing locales without blocking
 * the response. Subsequent fetches see the new rows; the frontend gets
 * presigned URLs for playback.
 */
import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { uploadToS3, presign } from '../../infra/storage.js';

type Locale = 'en' | 'fi' | 'sv';
const LOCALES: Locale[] = ['en', 'fi', 'sv'];

interface TtsAdapter {
  name: string;
  available: () => Promise<boolean>;
  /** Returns m4a audio + duration in ms */
  synthesize: (text: string, locale: Locale) => Promise<{ buffer: Buffer; durationMs: number; voiceCredit: string }>;
}

@Injectable()
export class NarrationService {
  private readonly logger = new Logger(NarrationService.name);
  private adapter: TtsAdapter | null = null;
  private adapterPromise: Promise<TtsAdapter | null> | null = null;
  /** plantId+locale → in-flight generation promise — coalesces concurrent requests */
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget: enqueue narration generation for any locale that
   * doesn't yet have a row. Returns immediately — the API request flow
   * stays fast.
   */
  ensureGenerated(plantId: string): void {
    void this.ensureAsync(plantId).catch((err) => {
      this.logger.warn(`narration generation failed for ${plantId}: ${(err as Error).message}`);
    });
  }

  private async ensureAsync(plantId: string): Promise<void> {
    const have = await this.prisma.audioNarration.findMany({
      where: { plantId },
      select: { locale: true },
    });
    const present = new Set(have.map((n) => n.locale.toLowerCase()));
    const missing = LOCALES.filter((l) => !present.has(l));
    if (missing.length === 0) return;
    // Generate sequentially to avoid spawning 3× say/ffmpeg in parallel
    for (const locale of missing) {
      await this.generateOne(plantId, locale);
    }
  }

  /**
   * Generate one (plantId, locale) narration. Idempotent: a concurrent
   * call for the same key joins the in-flight promise.
   */
  async generateOne(plantId: string, locale: Locale): Promise<void> {
    const key = `${plantId}:${locale}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = (async () => {
      try {
        const adapter = await this.getAdapter();
        if (!adapter) {
          this.logger.warn(`no TTS adapter available; skipping narration for ${plantId} ${locale}`);
          return;
        }
        const plant = await this.prisma.plant.findUnique({
          where: { id: plantId },
          select: { slug: true, story: true, nameEn: true },
        });
        if (!plant) return;
        const story = (plant.story as Record<string, string> | null) ?? {};
        const text = (story[locale] || story.en || '').toString().trim();
        if (!text) {
          this.logger.warn(`no story text for ${plant.slug} ${locale}; skipping`);
          return;
        }

        // Trim to ~600 chars for a ~30-second narration. Long stories
        // would produce huge audio files; we already show the full
        // transcript on the page.
        const spoken = text.length > 600 ? text.slice(0, 600).replace(/\s\S+$/, '') + '…' : text;

        const { buffer, durationMs, voiceCredit } = await adapter.synthesize(spoken, locale);
        const storageKey = `narrations/${plant.slug}/${locale}.m4a`;
        // uploadToS3 returns a `local://<key>` URI in the local-storage
        // backend (see apps/api/src/infra/storage.ts). Stored verbatim
        // on AudioNarration.audioUrl and resolved to a browser URL by
        // presign() at read time.
        const refUrl = await uploadToS3({
          key: storageKey,
          body: buffer,
          contentType: 'audio/mp4',
        });

        await this.prisma.audioNarration.upsert({
          where: { plantId_locale: { plantId, locale: locale as 'en' | 'fi' | 'sv' } },
          create: {
            plantId,
            locale: locale as 'en' | 'fi' | 'sv',
            audioUrl: refUrl,
            durationMs,
            transcript: text,
            voiceCredit,
          },
          update: {
            audioUrl: refUrl,
            durationMs,
            transcript: text,
            voiceCredit,
          },
        });
        this.logger.log(`narration generated: ${plant.slug} · ${locale} · ${(durationMs / 1000).toFixed(1)}s · via ${adapter.name}`);
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  /**
   * Resolve the canonical (signed) URL for a narration. Falls back to
   * null if the row hasn't been generated yet.
   */
  async getPresignedUrl(plantId: string, locale: Locale, ttlSec = 3600): Promise<string | null> {
    const row = await this.prisma.audioNarration.findUnique({
      where: { plantId_locale: { plantId, locale: locale as 'en' | 'fi' | 'sv' } },
    });
    if (!row) return null;
    try {
      return await presign(row.audioUrl, ttlSec);
    } catch (err) {
      this.logger.error(`presign failed for ${plantId}/${locale}: ${(err as Error).message}`);
      return null;
    }
  }

  private getAdapter(): Promise<TtsAdapter | null> {
    if (this.adapter) return Promise.resolve(this.adapter);
    if (!this.adapterPromise) {
      this.adapterPromise = this.resolveAdapter();
    }
    return this.adapterPromise.then((a) => {
      this.adapter = a;
      return a;
    });
  }

  private async resolveAdapter(): Promise<TtsAdapter | null> {
    // Prefer Piper on Linux (production quality); fall back to macOS `say`
    // in dev (works on the maintainer's machine without extra installs).
    const candidates: TtsAdapter[] = [piperAdapter, sayAdapter];
    for (const c of candidates) {
      try {
        if (await c.available()) {
          this.logger.log(`TTS adapter: ${c.name}`);
          return c;
        }
      } catch {
        /* try next */
      }
    }
    this.logger.warn('No TTS adapter available — narrations will not be generated. Install `piper` (linux) or run on macOS for `say` support.');
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Adapters
// ─────────────────────────────────────────────────────────────────────────

function which(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn('sh', ['-c', `command -v ${cmd}`]);
    p.on('close', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
}

function runCmd(cmd: string, args: string[], input?: string): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    const stdout: Buffer[] = [];
    const stderr: string[] = [];
    p.stdout.on('data', (d) => stdout.push(d));
    p.stderr.on('data', (d) => stderr.push(d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: Buffer.concat(stdout), stderr: stderr.join('') });
      } else {
        reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr.join('').slice(0, 300)}`));
      }
    });
    if (input != null) {
      p.stdin.write(input);
      p.stdin.end();
    }
  });
}

const VOICES = {
  say: { en: 'Samantha', fi: 'Satu', sv: 'Alva' },
} as const;

const sayAdapter: TtsAdapter = {
  name: 'macos-say',
  available: async () => process.platform === 'darwin' && (await which('say')) && (await which('ffmpeg')),
  synthesize: async (text, locale) => {
    const tmp = await mkdtemp(join(tmpdir(), 'bloom-tts-'));
    const aiff = join(tmp, 'out.aiff');
    const m4a = join(tmp, 'out.m4a');
    const voice = VOICES.say[locale];
    try {
      await runCmd('say', ['-v', voice, '-o', aiff, text]);
      // Encode AIFF → AAC m4a at 64k. -nostats keeps the log quiet.
      await runCmd('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', aiff, '-c:a', 'aac', '-b:a', '64k', m4a]);
      const buffer = await readFile(m4a);
      const durationMs = await probeDurationMs(m4a);
      return { buffer, durationMs, voiceCredit: `macOS · ${voice}` };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  },
};

const piperAdapter: TtsAdapter = {
  name: 'piper',
  available: async () => (await which('piper')) && (await which('ffmpeg')),
  synthesize: async (text, locale) => {
    // Piper expects --model and --output_file. We pick a low-bandwidth
    // voice per locale; the operator picks the model path via env. The
    // model files are downloaded from huggingface.co/rhasspy/piper-voices
    // and stored under /opt/piper/models/ in the docker image.
    const modelEnv = {
      en: process.env.PIPER_MODEL_EN ?? '/opt/piper/models/en_GB-jenny_dioco-medium.onnx',
      fi: process.env.PIPER_MODEL_FI ?? '/opt/piper/models/fi_FI-harri-medium.onnx',
      sv: process.env.PIPER_MODEL_SV ?? '/opt/piper/models/sv_SE-nst-medium.onnx',
    };
    const model = modelEnv[locale];
    const tmp = await mkdtemp(join(tmpdir(), 'bloom-tts-'));
    const wav = join(tmp, 'out.wav');
    const m4a = join(tmp, 'out.m4a');
    try {
      await runCmd('piper', ['--model', model, '--output_file', wav], text);
      await runCmd('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '64k', m4a]);
      const buffer = await readFile(m4a);
      const durationMs = await probeDurationMs(m4a);
      return { buffer, durationMs, voiceCredit: `Piper · ${model.split('/').pop()}` };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  },
};

async function probeDurationMs(file: string): Promise<number> {
  try {
    const { stdout } = await runCmd('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      file,
    ]);
    const sec = parseFloat(stdout.toString().trim());
    return Number.isFinite(sec) ? Math.round(sec * 1000) : 0;
  } catch {
    return 0;
  }
}
