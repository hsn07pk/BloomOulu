/**
 * Tax certificates — annual donation-summary PDF documents.
 *
 * Each certificate is a single generic "informational donation summary"
 * (the donor's total settled donations in the tax year). There is no
 * tier-based / corporate (TVL §57 ≥ €850) scheme branching.
 *
 * The Prisma-level certificate row is created by the
 * `tax-cert-annual.processor` job (cron: Jan 5 04:00 UTC, manually fired
 * from admin via `POST /v1/admin/tax-certs/generate`). This module just
 * exposes:
 *
 *   • GET /v1/tax-certs/:id            donor + finance/admin read
 *   • GET /v1/tax-certs/:id/pdf        302 → /v1/files/<key>
 *   • POST /v1/admin/tax-certs/generate  enqueues the annual sweep job
 *
 * Access rules:
 *   • a donor can fetch their own certificates
 *   • finance + admin can fetch any certificate
 *   • anyone else → 403
 *
 * The PDF blob itself lives in local storage (STORAGE_DIR). We never
 * stream the bytes through this controller — instead we 302 to the
 * /v1/files/* route, identical to the Receipts pattern.
 */
import {
  Module,
  Controller,
  Get,
  Post,
  Body,
  Param,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Roles } from '../../common/roles.decorator.js';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { presign } from '../../infra/storage.js';
import { Queue } from 'bullmq';

const STAFF_ROLES = new Set(['finance', 'admin']);

const taxCertQueue = new Queue('tax-cert-annual', {
  connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
});

@Controller('tax-certs')
@Roles('donor', 'finance', 'admin')
class TaxCertsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  async one(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    const c = await this.prisma.taxCertificate.findUnique({
      where: { id },
      include: { donor: { select: { id: true, email: true, name: true } } },
    });
    if (!c) throw new NotFoundException();
    if (c.donor.id !== actor.sub && !STAFF_ROLES.has(actor.role)) {
      throw new ForbiddenException();
    }
    if (c.donor.id !== actor.sub) {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: actor.sub,
          action: 'staff.taxCert.read',
          resource: `TaxCertificate/${c.id}`,
        },
      });
    }
    return c;
  }

  @Get(':id/pdf')
  async pdf(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const c = await this.prisma.taxCertificate.findUnique({
      where: { id },
      include: { donor: { select: { id: true } } },
    });
    if (!c) throw new NotFoundException();
    if (c.donor.id !== actor.sub && !STAFF_ROLES.has(actor.role)) {
      throw new ForbiddenException();
    }
    if (!c.pdfUrl) {
      throw new NotFoundException('PDF not yet generated for this certificate');
    }
    if (c.donor.id !== actor.sub) {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: actor.sub,
          action: 'staff.taxCert.pdf.download',
          resource: `TaxCertificate/${c.id}`,
        },
      });
    }
    const url = await presign(c.pdfUrl, 300);
    reply.code(302).header('location', url).send();
  }
}

/**
 * Admin sub-controller — finance/admin only. Fires the annual sweep job
 * for a given tax year (and optionally a single donor). Returns the
 * BullMQ job id so the admin UI can poll its result.
 */
@Controller('admin/tax-certs')
@Roles('finance', 'admin')
class AdminTaxCertsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('generate')
  async generate(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: { taxYear?: number; donorId?: string },
  ) {
    const taxYear = body?.taxYear ?? new Date().getUTCFullYear() - 1;
    if (!Number.isInteger(taxYear) || taxYear < 2024 || taxYear > 2100) {
      throw new BadRequestException('taxYear must be an integer between 2024 and 2100');
    }
    const job = await taxCertQueue.add(
      'manual',
      { taxYear, donorId: body?.donorId },
      {
        // Unique jobId per click so legitimate re-runs aren't dedup'd.
        jobId: `tax-cert-manual-${taxYear}-${body?.donorId ?? 'all'}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
      },
    );
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.sub,
        action: 'admin.taxCert.generate',
        resource: `TaxYear/${taxYear}${body?.donorId ? `/Donor/${body.donorId}` : ''}`,
      },
    });
    return { jobId: job.id, taxYear, donorId: body?.donorId ?? null };
  }
}

@Module({ controllers: [TaxCertsController, AdminTaxCertsController] })
export class TaxCertsModule {}
