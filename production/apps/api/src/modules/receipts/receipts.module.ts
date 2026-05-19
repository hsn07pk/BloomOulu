/**
 * Receipts — Finnish VAT-compliant PDF receipts + annual TVL §57 tax certs.
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
 *   - Sums all eligible donations from a donor in the tax year
 *   - For corporate donors ≥ €850 → TVL §57 wording
 *   - For individual donors → wording for the new 2026 individual scheme
 *     (when finalised; until then, certificate states "informational only")
 */
import {
  Module,
  Controller,
  Get,
  Param,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Roles } from '../../common/roles.decorator.js';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

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
}

@Module({ controllers: [ReceiptsController] })
export class ReceiptsModule {}
