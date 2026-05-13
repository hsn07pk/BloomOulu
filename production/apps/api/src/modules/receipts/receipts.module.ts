/**
 * Receipts — Finnish VAT-compliant PDF receipts + annual TVL §57 tax certs.
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
import { Module, Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('receipts')
class ReceiptsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':number')
  async one(@Param('number') number: string) {
    const r = await this.prisma.receipt.findUnique({
      where: { number },
      include: { donor: { select: { name: true, email: true } } },
    });
    if (!r) throw new NotFoundException();
    return r;
  }
}

@Module({ controllers: [ReceiptsController] })
export class ReceiptsModule {}
