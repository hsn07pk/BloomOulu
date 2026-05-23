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
    reply
      .header('content-type', file.contentType)
      .header('cache-control', 'public, max-age=3600, immutable')
      .send(file.body);
  }
}
