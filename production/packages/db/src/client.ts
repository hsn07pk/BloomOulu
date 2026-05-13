import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __bloomouluPrisma__: PrismaClient | undefined;
}

/**
 * One PrismaClient per process, reused across hot reloads.
 *
 * In NestJS we still use `PrismaService` which extends PrismaClient — this
 * standalone export is for the worker, seed scripts, and one-off CLI tools.
 */
export const prisma: PrismaClient =
  globalThis.__bloomouluPrisma__ ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? ['warn', 'error']
        : ['info', 'warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__bloomouluPrisma__ = prisma;
}

export type Db = typeof prisma;
