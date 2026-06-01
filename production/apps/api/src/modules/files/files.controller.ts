/**
 * /v1/files/* — local-storage file server.
 *
 * Replaces presigned MinIO/S3 URLs. Streams content straight from the
 * local STORAGE_DIR set in infra/storage.ts. Used for receipt PDFs,
 * audio narrations, GDPR exports, plant images — anything stored via
 * `uploadToS3` (which now writes locally).
 *
 * Routing: Fastify rejects named wildcard params (e.g. `*path`), so we
 * use a plain Fastify wildcard at the controller path and read the key
 * from `request.params['*']` — the standard way to capture a multi-
 * segment URL suffix on Fastify.
 *
 * Plant-image fallback: a PlantImage.url is the stable local key
 * `/v1/files/plant-images/<id>.<ext>`, but the bytes may not be cached
 * locally yet (a fresh deploy with an empty volume, or a download still
 * pending). Rather than 404 — which would leave the grid image-less — we
 * 302 to the row's `sourceUrl` (the canonical Wikimedia / iNaturalist
 * URL). The background cache job then fills the local copy and subsequent
 * requests serve from disk, so third parties aren't hit on every view.
 */
import { Controller, Get, NotFoundException, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { readFile } from '../../infra/storage.js';
import { PrismaService } from '../prisma/prisma.service.js';

const INLINE_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'image/gif',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
]);

function basename(key: string): string {
  const last = key.split('/').pop() ?? key;
  return last.replace(/\.meta\.json$/, '');
}

@Controller('files')
export class FilesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('*')
  async serve(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const params = (request.params ?? {}) as Record<string, string | undefined>;
    const key = params['*'] ?? '';
    if (!key) throw new NotFoundException('file path missing');
    const decodedKey = decodeURIComponent(key);
    const file = await readFile(decodedKey);
    if (!file) {
      // Plant-image fallback: redirect to the upstream source so the page
      // is never image-less while the local copy is still being cached.
      if (decodedKey.startsWith('plant-images/')) {
        const row = await this.prisma.plantImage.findFirst({
          where: { url: `/v1/files/${decodedKey}` },
          select: { sourceUrl: true },
        });
        if (row?.sourceUrl) {
          // 302 (not 301) — the local copy is expected to land soon and
          // should win once present. Short cache so the redirect itself
          // isn't pinned for long.
          reply.header('cache-control', 'public, max-age=300').redirect(row.sourceUrl, 302);
          return;
        }
      }
      throw new NotFoundException(`file not found: ${key}`);
    }
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const forceDownload = query['download'] === '1' || query['download'] === 'true';
    const disposition =
      forceDownload || !INLINE_CONTENT_TYPES.has(file.contentType)
        ? `attachment; filename="${basename(key)}"`
        : `inline; filename="${basename(key)}"`;
    reply
      .header('content-type', file.contentType)
      .header('content-disposition', disposition)
      .header('cache-control', 'public, max-age=3600, immutable')
      .send(file.body);
  }
}
