/**
 * Favourites leaderboard. Visitors "vote for" (favourite) the plants they
 * most want to see protected; the public leaderboard ranks species by votes.
 * Voting is anonymous (a SHA-256 hash of IP+UA, like PlantScan) and
 * idempotent per visitor, so a refresh or re-tap never inflates the count.
 *
 * This pairs with the donation flow: a visitor can favourite a plant for free
 * and, if they wish, direct a gift to it.
 */
import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const VoteBodyDto = z.object({
  /** UI locale at vote time, for signage analysis. */
  locale: z.enum(['en', 'fi', 'sv']).default('fi'),
  /** Optional kiosk / label code printed on the QR sticker. */
  kioskId: z.string().max(64).optional(),
});
type VoteBodyDto = z.infer<typeof VoteBodyDto>;

function visitorHashOf(ip: string | undefined, userAgent: string | undefined): string {
  const ipPart = ip ?? '';
  const uaPart = userAgent ?? '';
  if (!ipPart && !uaPart) return '';
  return createHash('sha256').update(`${ipPart}|${uaPart}`).digest('hex');
}

@ApiTags('Votes')
@Controller()
class VotesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Top favourited plants. Public, cheap (single index scan on voteCount). */
  @Get('votes/leaderboard')
  @ApiOperation({ summary: 'Favourites leaderboard — plants ranked by votes' })
  async leaderboard(@Query('limit') limit?: string) {
    const take = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 100);
    const plants = await this.prisma.plant.findMany({
      where: { status: 'active' },
      // Buzz (anonymous votes) leads the ranking as before; the number of
      // real supporters (donors) is the secondary key so plants with genuine
      // backing edge ahead on ties.
      orderBy: [{ voteCount: 'desc' }, { donorCount: 'desc' }, { nameEn: 'asc' }],
      take,
      select: {
        slug: true,
        nameEn: true,
        nameFi: true,
        nameSv: true,
        redListStatus: true,
        voteCount: true,
        donorCount: true,
        fundedCents: true,
        primaryImage: { select: { url: true, altEn: true } },
      },
    });
    return {
      plants: plants.map((p, i) => ({ rank: i + 1, ...p })),
      asOf: new Date().toISOString(),
    };
  }

  /** Favourite a plant. Idempotent per visitor; returns the live count. */
  @Post('plants/:slug/vote')
  @ApiOperation({ summary: 'Favourite (vote for) a plant' })
  async vote(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(VoteBodyDto)) body: VoteBodyDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const plant = await this.prisma.plant.findUnique({
      where: { slug },
      select: { id: true, voteCount: true },
    });
    if (!plant) throw new NotFoundException(`Plant ${slug} not found`);
    const visitorHash = visitorHashOf(ip, userAgent);

    // Idempotent: one vote per (plant, visitor). Only bump the denormalised
    // counter when the row is genuinely new.
    const result = await this.prisma.$transaction(async (tx) => {
      try {
        await tx.plantVote.create({
          data: {
            plantId: plant.id,
            visitorHash,
            locale: body.locale,
            kioskId: body.kioskId ?? null,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return { voted: true, created: false };
        }
        throw err;
      }
      await tx.plant.update({
        where: { id: plant.id },
        data: { voteCount: { increment: 1 } },
      });
      return { voted: true, created: true };
    });

    return {
      voted: true,
      voteCount: plant.voteCount + (result.created ? 1 : 0),
    };
  }

  /** Remove a favourite (toggle off). Idempotent. */
  @Delete('plants/:slug/vote')
  @ApiOperation({ summary: 'Remove a favourite' })
  async unvote(
    @Param('slug') slug: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const plant = await this.prisma.plant.findUnique({
      where: { slug },
      select: { id: true, voteCount: true },
    });
    if (!plant) throw new NotFoundException(`Plant ${slug} not found`);
    const visitorHash = visitorHashOf(ip, userAgent);

    const removed = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.plantVote.deleteMany({
        where: { plantId: plant.id, visitorHash },
      });
      if (deleted.count > 0) {
        await tx.plant.update({
          where: { id: plant.id },
          data: { voteCount: { decrement: deleted.count } },
        });
      }
      return deleted.count;
    });

    return {
      voted: false,
      voteCount: Math.max(0, plant.voteCount - removed),
    };
  }
}

@Module({ controllers: [VotesController] })
export class VotesModule {}
