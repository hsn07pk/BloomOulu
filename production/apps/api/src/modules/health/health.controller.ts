import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('healthz')
  async healthz() {
    const checks: Record<string, 'ok' | 'down'> = { process: 'ok' };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks['db'] = 'ok';
    } catch {
      checks['db'] = 'down';
    }
    const allOk = Object.values(checks).every((v) => v === 'ok');
    return { status: allOk ? 'ok' : 'degraded', checks, ts: new Date().toISOString() };
  }

  @Get('readyz')
  async readyz() {
    return { ready: true };
  }
}
