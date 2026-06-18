import { prisma } from '@bloomoulu/db';

const DEFAULT_HANDLE = 'oulubotgarden';

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await prisma.$queryRaw<Array<{ value: unknown }>>`
    SELECT value FROM "SystemSetting" WHERE key = ${key} LIMIT 1`;
  const v = rows[0]?.value;
  return (v === undefined || v === null ? fallback : (v as T));
}

export async function getInstagramConfig(): Promise<{
  handle: string;
  enabled: boolean;
  lastSyncedAt: string | null;
}> {
  const [handle, enabled, lastSyncedAt] = await Promise.all([
    readSetting<string>('instagram.handle', DEFAULT_HANDLE),
    readSetting<boolean>('instagram.enabled', true),
    readSetting<string | null>('instagram.lastSyncedAt', null),
  ]);
  return { handle: handle || DEFAULT_HANDLE, enabled: enabled !== false, lastSyncedAt };
}

export async function setLastSynced(iso: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "SystemSetting" (key, value)
    VALUES ('instagram.lastSyncedAt', ${JSON.stringify(iso)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`;
}
