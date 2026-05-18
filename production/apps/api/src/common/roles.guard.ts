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

const SECRET = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret');

/**
 * Enforces `@Roles(...)` metadata. Methods (and controllers) without the
 * decorator are open — the guard is a no-op there. ADR-0003: role-based
 * access control with three staff roles + the implicit donor role.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

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

    let role: string | undefined;
    let sub: string | undefined;
    try {
      const { payload } = await jwtVerify(auth.slice('Bearer '.length), SECRET(), {
        algorithms: ['HS256'],
      });
      role = typeof payload.role === 'string' ? payload.role : undefined;
      sub = typeof payload.sub === 'string' ? payload.sub : undefined;
    } catch {
      throw new UnauthorizedException();
    }
    if (!role || !required.includes(role as Role)) throw new ForbiddenException();

    (req as { user?: { sub?: string; role?: Role } }).user = {
      sub,
      role: role as Role,
    };
    return true;
  }
}
