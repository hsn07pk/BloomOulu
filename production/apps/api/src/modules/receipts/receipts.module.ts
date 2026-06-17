/**
 * Receipts — Finnish VAT-compliant PDF receipts for one-time donations.
 *
 * Access:
 *   - The donor whose Payment generated the Receipt
 *   - finance / admin staff (refund context, support)
 * Anyone else → 403.
 *
 * The receipt PDF is rendered with @react-pdf/renderer and includes:
 *   - Donor name + postal address
 *   - Donation amount + currency
 *   - VAT line breakdown (yleishyödyllinen yhteisö → typically zero-rated)
 *   - Receipt number (gapless year-prefixed counter via DB sequence)
 *   - Garden's legal name + Y-tunnus + IBAN + signature image
 *   - QR linking to receipt verification URL
 *   - Locale of donor (FI/SV/EN content)
 *
 * Tax certificate (annual, December 31):
 *   - Sums all of a donor's settled donations in the tax year
 *   - Issued as a single generic informational donation summary (no
 *     tier-based / corporate scheme branching)
 */
import {
  Module,
  Controller,
  Get,
  Param,
  NotFoundException,
  ForbiddenException,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Roles } from '../../common/roles.decorator.js';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { presign } from '../../infra/storage.js';

const STAFF_ROLES = new Set(['finance', 'admin']);

@Controller('receipts')
@Roles('donor', 'finance', 'admin')
class ReceiptsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':number')
  async one(@CurrentUser() actor: AuthenticatedUser, @Param('number') number: string) {
    const r = await this.prisma.receipt.findUnique({
      where: { number },
      include: { donor: { select: { id: true, name: true, email: true } } },
    });
    if (!r) throw new NotFoundException();
    // ADR-0003: donor can read their own; finance/admin can read any.
    if (r.donor.id !== actor.sub && !STAFF_ROLES.has(actor.role)) {
      throw new ForbiddenException();
    }
    if (r.donor.id !== actor.sub) {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: actor.sub,
          action: 'staff.receipt.read',
          resource: `Receipt/${r.number}`,
        },
      });
    }
    return r;
  }

  /**
   * Stream the receipt PDF by 302-redirecting the browser to a short-
   * lived pre-signed S3/MinIO URL. The donor's browser never sees the
   * underlying bucket URL or credentials; the signed URL is valid for
   * 5 minutes so even a copy-paste leak expires fast.
   *
   * Auth: the donor whose Payment generated this Receipt, or
   * finance/admin staff. The bare s3:// shape in `Receipt.pdfUrl`
   * forces the request through this gate.
   */
  @Get(':number/pdf')
  async pdf(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('number') number: string,
    @Res() reply: FastifyReply,
  ) {
    const r = await this.prisma.receipt.findUnique({
      where: { number },
      include: { donor: { select: { id: true } } },
    });
    if (!r) throw new NotFoundException();
    if (r.donor.id !== actor.sub && !STAFF_ROLES.has(actor.role)) {
      throw new ForbiddenException();
    }
    if (!r.pdfUrl) {
      throw new NotFoundException('PDF not yet generated for this receipt');
    }
    if (r.donor.id !== actor.sub) {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: actor.sub,
          action: 'staff.receipt.pdf.download',
          resource: `Receipt/${r.number}`,
        },
      });
    }
    const url = await presign(r.pdfUrl, 300);
    reply.code(302).header('location', url).send();
  }
}

@Module({ controllers: [ReceiptsController] })
export class ReceiptsModule {}
