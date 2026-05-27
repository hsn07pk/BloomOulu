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
 */
import { Controller, Get, NotFoundException, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { readFile } from '../../infra/storage.js';

/**
 * Content types we serve INLINE — browser-native renderers exist and the
 * donor benefits from previewing in-tab (receipt PDFs, audio narrations,
 * plant images). Anything not in this set is served as an attachment so
 * a click on the email link triggers a Save dialog rather than a wall of
 * raw JSON in a Chrome tab.
 */
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
  // Strip the .meta.json sidecar suffix on the off-chance a key was
  // mis-routed through us (the readFile path shouldn't allow it, but
  // belt-and-suspenders).
  return last.replace(/\.meta\.json$/, '');
}

@Controller('files')
export class FilesController {
  @Get('*')
  async serve(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const params = (request.params ?? {}) as Record<string, string | undefined>;
    // Fastify maps a trailing `*` wildcard to `params['*']`.
    const key = params['*'] ?? '';
    if (!key) throw new NotFoundException('file path missing');
    const file = await readFile(decodeURIComponent(key));
    if (!file) throw new NotFoundException(`file not found: ${key}`);
    // `?download=1` forces attachment regardless of content type — used
    // by the GDPR / disbursement download buttons that want a save-as
    // prompt even for pdfs.
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
