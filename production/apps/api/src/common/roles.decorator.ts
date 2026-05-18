import { SetMetadata } from '@nestjs/common';

export type Role = 'donor' | 'curator' | 'finance' | 'admin';

export const ROLES_KEY = 'roles';

/**
 * Mark a controller method (or whole controller) as requiring one of the given
 * roles. Enforced by `RolesGuard` which reads the caller's `Authorization:
 * Bearer <jwt>` header, verifies HS256 against `AUTH_SECRET`, and checks the
 * `role` claim. ADR-0003 mandates this on every staff-only endpoint.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
