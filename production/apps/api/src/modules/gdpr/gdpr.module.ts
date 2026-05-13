/**
 * GDPR — Articles 15 (export) and 17 (erasure).
 *
 * Export (Art. 15): self-service. The donor submits POST /v1/gdpr/export
 * from My Garden, we enqueue the export job immediately, the worker
 * collects every PII row, uploads JSON to MinIO, emails a 24h-presigned
 * URL.
 *
 * Erasure (Art. 17): requires an admin approval step. Some erasure
 * requests carry legal holds (open chargeback, tax-year not yet closed,
 * pending investigation). Workflow:
 *
 *   donor POSTs /v1/gdpr/erase
 *     → DataErasureRequest(status='pending', approach='pseudonymise')
 *     → admin reviews in /admin/resources/DataErasureRequest
 *     → admin clicks "Approve & execute" → status='verified' + enqueue
 *     → worker pseudonymises PII, retains Payment/Receipt/TaxCert per
 *       Finnish accounting law (Kirjanpitolaki 2:5 §, 6-year retention)
 *     → status='completed'
 *
 *   Rejection path: admin clicks "Reject" → status='rejected' + reason.
 */
import { Body, Controller, Module, Post } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { enqueueGdprExport } from '../jobs/enqueue.js';

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
    const req = await this.prisma.$transaction(async (tx) => {
      const r = await tx.dataExportRequest.create({
        data: { userId: body.userId, status: 'pending' },
      });
      await this.audit.log(tx, {
        actorUserId: body.userId,
        action: 'gdpr.export.requested',
        resource: `DataExportRequest/${r.id}`,
      });
      return r;
    });
    // Fire the worker job right after the txn commits. The worker is
    // idempotent on requestId.
    await enqueueGdprExport({ requestId: req.id });
    return { requestId: req.id, status: 'queued' };
  }

  @Post('erase')
  async erase(@Body(new ZodValidationPipe(EraseDto)) body: z.infer<typeof EraseDto>) {
    const req = await this.prisma.$transaction(async (tx) => {
      const r = await tx.dataErasureRequest.create({
        data: { userId: body.userId, status: 'pending', reason: body.reason ?? null },
      });
      await this.audit.log(tx, {
        actorUserId: body.userId,
        action: 'gdpr.erase.requested',
        resource: `DataErasureRequest/${r.id}`,
        after: { reason: body.reason ?? null },
      });
      return r;
    });
    // No worker enqueue here — an admin must approve the request first
    // (see /admin/resources/DataErasureRequest → "Approve & execute").
    return {
      requestId: req.id,
      status: 'awaiting_admin_review',
      note: 'A garden admin will review your request within 30 days per GDPR Art. 12(3).',
    };
  }
}

@Module({ controllers: [GdprController] })
export class GdprModule {}
