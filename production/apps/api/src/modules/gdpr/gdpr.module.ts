/**
 * GDPR — Articles 15 (export) and 17 (erasure).
 *
 * Export: collects every row across User, Adoption, Payment, Receipt,
 * AskMessage, etc. into a JSON file, uploads it to MinIO with a 24-hour
 * pre-signed URL, emails the donor the link.
 *
 * Erasure: pseudonymises all PII columns (email → "deleted-<hash>@bloomoulu.fi",
 * name → null, postalAddress → null) while preserving financial records as
 * required by Finnish accounting law (6 years).
 */
import { Body, Controller, Module, Post } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';

const ExportDto = z.object({ userId: z.string().uuid() });
const EraseDto = z.object({
  userId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

@Controller('gdpr')
class GdprController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post('export')
  async export(@Body(new ZodValidationPipe(ExportDto)) body: z.infer<typeof ExportDto>) {
    const req = await this.prisma.dataExportRequest.create({
      data: { userId: body.userId, status: 'pending' },
    });
    // The worker picks this up and produces the export.
    return { requestId: req.id };
  }

  @Post('erase')
  async erase(@Body(new ZodValidationPipe(EraseDto)) body: z.infer<typeof EraseDto>) {
    const req = await this.prisma.dataErasureRequest.create({
      data: { userId: body.userId, status: 'pending', reason: body.reason ?? null },
    });
    return { requestId: req.id };
  }
}

@Module({ controllers: [GdprController] })
export class GdprModule {}
