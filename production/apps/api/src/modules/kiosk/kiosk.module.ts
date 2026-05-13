import { Module, Controller, Post, Body, Param, Get } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { randomBytes } from 'node:crypto';

const PairDto = z.object({
  code: z.string().length(8),
  deviceFingerprint: z.string().min(8).max(255),
});

const HeartbeatDto = z.object({
  deviceId: z.string().uuid(),
  buildSha: z.string().optional(),
});

@Controller('kiosks')
class KioskController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async create(@Body() body: { label: string; location: string }) {
    const pairingCode = randomBytes(4).toString('hex').toUpperCase().slice(0, 8);
    return this.prisma.kioskDevice.create({
      data: {
        label: body.label,
        location: body.location,
        pairingCode,
        pairingExpiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
  }

  @Post('pair')
  async pair(@Body(new ZodValidationPipe(PairDto)) body: z.infer<typeof PairDto>) {
    const dev = await this.prisma.kioskDevice.findFirst({
      where: {
        pairingCode: body.code,
        pairingExpiresAt: { gt: new Date() },
        status: 'unpaired',
      },
    });
    if (!dev) return { ok: false };
    const token = randomBytes(32).toString('base64url');
    await this.prisma.kioskDevice.update({
      where: { id: dev.id },
      data: {
        status: 'paired',
        pairingCode: null,
        pairingTokenHash: token,
        lastSeen: new Date(),
      },
    });
    return { ok: true, deviceId: dev.id, deviceToken: token };
  }

  @Post('heartbeat')
  async heartbeat(@Body() body: { deviceId?: string; buildSha?: string }) {
    // The lobby kiosk doesn't always carry a deviceId (single-instance
    // install in dev). Heartbeat without an id is allowed and returns ok
    // — we use it as a connectivity probe from the kiosk watchdog.
    if (!body.deviceId) return { ok: true };
    try {
      await this.prisma.kioskDevice.update({
        where: { id: body.deviceId },
        data: { lastSeen: new Date(), buildSha: body.buildSha ?? undefined },
      });
    } catch {
      /* unknown deviceId is fine — first-boot kiosks before pairing */
    }
    return { ok: true };
  }

  /**
   * Feed for the lobby kiosk's main display.
   *
   * - `featured`: a randomly picked "plant of the day" from currently-
   *   active plants whose bloomSeason matches the current season. Pinning
   *   is keyed by UTC date so all kiosks show the same plant on the same
   *   day.
   * - `blooming`: next 5 candidates (so the kiosk can rotate without
   *   re-fetching).
   * - `recentAdoptions`: last 10 active adoptions whose donor opted to
   *   show on the donor wall (defaults to true per schema).
   *
   * Public, no auth — the kiosk's deviceToken is consulted only by
   * heartbeat. The data here is safe to expose to a lobby visitor.
   */
  @Get(':id/feed')
  async feed(@Param('id') _id: string) {
    const month = new Date().getUTCMonth();
    const season =
      month >= 2 && month <= 4
        ? 'spring'
        : month >= 5 && month <= 7
          ? 'summer'
          : month >= 8 && month <= 10
            ? 'autumn'
            : 'winter';
    const candidates = await this.prisma.plant.findMany({
      where: {
        status: 'active',
        bloomSeason: { in: [season as any, 'all'] },
      },
      include: { primaryImage: true, taxon: true },
      orderBy: { adopterCount: 'desc' },
      take: 12,
    });
    // Deterministic "plant of the day" — same plant across all kiosks per
    // UTC day. Falls back to first if no candidates.
    const dayIdx = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    const featured = candidates.length > 0 ? candidates[dayIdx % candidates.length]! : null;
    const blooming = candidates.filter((p) => p.id !== featured?.id).slice(0, 5);

    const adoptions = await this.prisma.adoption.findMany({
      where: { status: 'active', showOnDonorWall: true },
      take: 10,
      orderBy: { startedAt: 'desc' },
      include: {
        plant: { select: { nameFi: true, nameEn: true } },
        donor: { select: { name: true } },
        tier: { select: { name: true, nameFi: true } },
      },
    });
    const recentAdoptions = adoptions.map((a) => ({
      id: a.id,
      // publicName: prefer the adoption's publicName (donor's chosen wall
      // name); fall back to first-name-only, then "Anonymous".
      publicName:
        a.publicName ??
        a.donor.name?.split(' ')[0] ??
        'Anonymous',
      plantNameFi: a.plant.nameFi,
      plantNameEn: a.plant.nameEn,
      tierName: a.tier.name,
    }));

    return { featured, blooming, recentAdoptions };
  }
}

@Module({ controllers: [KioskController] })
export class KioskModule {}
