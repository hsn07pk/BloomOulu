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
  async heartbeat(@Body(new ZodValidationPipe(HeartbeatDto)) body: z.infer<typeof HeartbeatDto>) {
    await this.prisma.kioskDevice.update({
      where: { id: body.deviceId },
      data: { lastSeen: new Date(), buildSha: body.buildSha ?? undefined },
    });
    return { ok: true };
  }

  @Get(':id/feed')
  async feed(@Param('id') id: string) {
    const blooming = await this.prisma.plant.findMany({
      where: { bloomSeason: { in: ['spring', 'summer', 'all'] }, status: 'active' },
      take: 6,
      include: { primaryImage: true },
    });
    const adoptions = await this.prisma.adoption.findMany({
      where: { status: 'active' },
      take: 12,
      orderBy: { startedAt: 'desc' },
      include: { plant: true, donor: { select: { name: true, locale: true } } },
    });
    return { blooming, adoptions };
  }
}

@Module({ controllers: [KioskController] })
export class KioskModule {}
