import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import { ROLES_KEY, type Role } from './roles.decorator.js';
import { PrismaService } from '../modules/prisma/prisma.service.js';

const SECRET = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret');

/**
 * Enforces `@Roles(...)` metadata. Methods (and controllers) without the
 * decorator are open — the guard is a no-op there. ADR-0003: role-based
 * access control with three staff roles + the implicit donor role.
 *
 * The guard verifies the HS256 JWT, refuses deactivated subjects, and
 * cross-checks the *claimed* role against the *current* role in the DB —
 * a stale token whose role has since been demoted is rejected. The DB
 * lookup is cheap (single uuid index hit) and only fires on @Roles()-
 * decorated endpoints.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const auth =
      (req.headers['authorization'] as string | undefined) ??
      (req.headers['Authorization'] as string | undefined) ??
      '';
    if (!auth.startsWith('Bearer ')) throw new UnauthorizedException();

    let claimedRole: string | undefined;
    let sub: string | undefined;
    try {
      const { payload } = await jwtVerify(auth.slice('Bearer '.length), SECRET(), {
        algorithms: ['HS256'],
      });
      claimedRole = typeof payload.role === 'string' ? payload.role : undefined;
      sub = typeof payload.sub === 'string' ? payload.sub : undefined;
    } catch {
      throw new UnauthorizedException();
    }
    if (!sub || !claimedRole) throw new UnauthorizedException();

    // Look up the current row — token roles can be stale (admin demoted
    // a user after they signed in). The DB is the source of truth.
    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, role: true, deactivatedAt: true },
    });
    if (!user) throw new UnauthorizedException();
    if (user.deactivatedAt) throw new ForbiddenException('Account deactivated');
    if (!required.includes(user.role as Role)) throw new ForbiddenException();

    (req as { user?: { sub: string; role: Role } }).user = {
      sub,
      role: user.role as Role,
    };
    return true;
  }
}
