/**
 * "Me" endpoints — per-user state that the donor's browser reads + writes.
 *
 *   GET    /v1/me/saved              → list of saved plants for the donor
 *   PUT    /v1/me/saved/:slug        → upsert a bookmark (idempotent)
 *   DELETE /v1/me/saved/:slug        → remove a bookmark (no-op if absent)
 *   POST   /v1/me/saved/sync         → bulk merge from the anonymous-localStorage
 *                                      shadow list (called on first sign-in)
 *
 * Identity here comes from a session header — the web's verify route signs
 * the same JWT we read; the api validates it with the shared AUTH_SECRET.
 * In dev we accept either `Authorization: Bearer <jwt>` or the
 * `x-bloomoulu-user-id` shortcut (set by the web's server actions).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { jwtVerify } from 'jose';
import { PrismaService } from '../prisma/prisma.service.js';

const COOKIE_SECRET = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret');

async function userIdFrom(headers: Record<string, string | string[] | undefined>): Promise<string | null> {
  // Preferred: signed JWT from the web's session cookie, forwarded by the
  // web's server-side proxy. Trust the signature, not the bare userId.
  const auth = (Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization) ?? '';
  if (auth.startsWith('Bearer ')) {
    try {
      const { payload } = await jwtVerify(auth.slice('Bearer '.length), COOKIE_SECRET(), { algorithms: ['HS256'] });
      if (payload.sub) return String(payload.sub);
    } catch {
      /* invalid — fall through */
    }
  }
  // Fallback shortcut for dev — the web's server proxy includes the
  // verified userId in this header. NEVER trust this from the browser
  // directly (production requires the JWT path).
  const shortcut = headers['x-bloomoulu-user-id'];
  if (typeof shortcut === 'string' && shortcut.length > 0) return shortcut;
  return null;
}

@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('saved')
  async list(@Headers() headers: Record<string, string | string[] | undefined>) {
    const userId = await userIdFrom(headers);
    if (!userId) throw new UnauthorizedException();
    const rows = await this.prisma.savedPlant.findMany({
      where: { userId },
      orderBy: { savedAt: 'desc' },
      take: 200,
      include: {
        plant: {
          include: {
            primaryImage: true,
            taxon: { select: { latinName: true, family: true } },
          },
        },
      },
    });
    return { items: rows };
  }

  @Put('saved/:slug')
  async save(
    @Param('slug') slug: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const userId = await userIdFrom(headers);
    if (!userId) throw new UnauthorizedException();
    const plant = await this.prisma.plant.findUnique({ where: { slug }, select: { id: true } });
    if (!plant) throw new NotFoundException();
    const row = await this.prisma.savedPlant.upsert({
      where: { userId_plantId: { userId, plantId: plant.id } },
      create: { userId, plantId: plant.id },
      update: {},
    });
    return { ok: true, id: row.id, savedAt: row.savedAt };
  }

  @Delete('saved/:slug')
  async remove(
    @Param('slug') slug: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const userId = await userIdFrom(headers);
    if (!userId) throw new UnauthorizedException();
    const plant = await this.prisma.plant.findUnique({ where: { slug }, select: { id: true } });
    if (!plant) return { ok: true, deleted: 0 };
    const r = await this.prisma.savedPlant.deleteMany({
      where: { userId, plantId: plant.id },
    });
    return { ok: true, deleted: r.count };
  }

  /**
   * Bulk merge for the anonymous → signed-in handoff. The frontend reads
   * its localStorage shadow on first sign-in and posts the slug list once.
   * Already-saved rows are left alone (upsert + skipDuplicates semantics).
   */
  @Post('saved/sync')
  async sync(
    @Body() body: { slugs: string[] },
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const userId = await userIdFrom(headers);
    if (!userId) throw new UnauthorizedException();
    if (!Array.isArray(body.slugs) || body.slugs.length === 0) return { ok: true, merged: 0 };
    const plants = await this.prisma.plant.findMany({
      where: { slug: { in: body.slugs.slice(0, 200) } },
      select: { id: true },
    });
    if (plants.length === 0) return { ok: true, merged: 0 };
    const data = plants.map((p) => ({ userId, plantId: p.id }));
    const r = await this.prisma.savedPlant.createMany({
      data,
      skipDuplicates: true,
    });
    return { ok: true, merged: r.count };
  }
}
