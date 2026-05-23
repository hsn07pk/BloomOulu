/**
 * /v1/files/* — local-storage file server.
 *
 * Replaces presigned MinIO/S3 URLs. Streams content straight from the
 * local STORAGE_DIR set in infra/storage.ts. Used for receipt PDFs,
 * audio narrations, GDPR exports, plant images — anything stored via
 * `uploadToS3` (which now writes locally).
 *
 * Access model matches the previous "presigned URL anyone with the link
 * can fetch" — there's no ACL enforcement here. Keys are UUID/SHA-derived
 * so they're effectively unguessable; receipts/exports use long random
 * tokens in their keys.
 */
import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { readFile } from '../../infra/storage.js';

@Controller('files')
export class FilesController {
  @Get('*key')
  async serve(@Param('key') keyParts: string[] | string, @Res() reply: FastifyReply) {
    const key = Array.isArray(keyParts) ? keyParts.join('/') : keyParts;
    const file = await readFile(key);
    if (!file) throw new NotFoundException(`file not found: ${key}`);
    reply
      .header('content-type', file.contentType)
      .header('cache-control', 'public, max-age=3600, immutable')
      .send(file.body);
  }
}
