/**
 * Read-only tier endpoint. Tiers live in the `Tier` table and are
 * editable from /admin/resources/Tier; the web's adoption flow fetches
 * the live list at SSR time (ISR 5 min) so price changes propagate
 * without a redeploy.
 */
import { Controller, Get, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('tiers')
class TiersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    return this.prisma.tier.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }
}

@Module({ controllers: [TiersController] })
export class TiersModule {}
