import { Body, Controller, NotFoundException, Param, Post } from '@nestjs/common';
import { NarrationService } from './narration.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Internal endpoints to trigger narration generation. Public consumers
 * read narrations via `GET /v1/plants/:slug` (which now eager-presigns
 * AudioNarration.audioUrl). These endpoints are for admins + curl-driven
 * bulk seeding.
 */
@Controller('plants')
export class NarrationController {
  constructor(
    private readonly narration: NarrationService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Generate (or regenerate) narrations for a single plant.
   *
   *   POST /v1/plants/:slug/narrate              → all 3 locales
   *   POST /v1/plants/:slug/narrate?locale=fi    → just FI
   */
  @Post(':slug/narrate')
  async narrate(@Param('slug') slug: string, @Body() body: { locale?: 'en' | 'fi' | 'sv' } | undefined) {
    const plant = await this.prisma.plant.findUnique({ where: { slug }, select: { id: true } });
    if (!plant) throw new NotFoundException();
    if (body?.locale) {
      await this.narration.generateOne(plant.id, body.locale);
      return { ok: true, plant: slug, locale: body.locale };
    }
    for (const locale of ['en', 'fi', 'sv'] as const) {
      await this.narration.generateOne(plant.id, locale);
    }
    return { ok: true, plant: slug, locale: 'all' };
  }
}
