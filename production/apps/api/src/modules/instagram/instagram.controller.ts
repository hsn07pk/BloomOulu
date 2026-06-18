import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';
import { getInstagramConfig } from './instagram.config.js';

const MAX = 9;

@ApiTags('Instagram')
@Controller('instagram')
export class InstagramController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Public Instagram feed (live cached posts or curated fallback)' })
  async feed() {
    const { handle, enabled, lastSyncedAt } = await getInstagramConfig();
    if (!enabled) {
      return { handle, enabled: false, source: 'disabled', lastSyncedAt, posts: [] };
    }
    const live = await this.prisma.instagramPost.findMany({
      where: { isFallback: false },
      orderBy: { takenAt: 'desc' },
      take: MAX,
    });
    const rows =
      live.length > 0
        ? { source: 'live' as const, items: live }
        : {
            source: 'fallback' as const,
            items: await this.prisma.instagramPost.findMany({
              where: { isFallback: true },
              orderBy: { displayOrder: 'asc' },
              take: MAX,
            }),
          };
    return {
      handle,
      enabled: true,
      source: rows.source,
      lastSyncedAt,
      posts: rows.items.map((p) => ({
        shortcode: p.shortcode,
        caption: p.caption,
        takenAt: p.takenAt,
        permalink: p.permalink ?? `https://www.instagram.com/${handle}/`,
        imageUrl: p.imageUrl,
        mediaType: p.mediaType,
      })),
    };
  }
}
