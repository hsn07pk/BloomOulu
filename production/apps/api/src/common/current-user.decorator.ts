import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from './roles.decorator.js';

export interface AuthenticatedUser {
  sub: string;
  role: Role;
}

/**
 * Extract the `req.user` payload set by `RolesGuard` after JWT verification.
 * Pair with `@Roles(...)` so the user is guaranteed to be present.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    return req.user;
  },
);
