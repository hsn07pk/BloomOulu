import type { PrismaClient } from '@prisma/client';

/**
 * Bootstrap one admin user from env. Run only on fresh installs.
 * The actual password is stored as a bcrypt hash in env, never in DB; this
 * function just records the User row + role.
 */
export async function seedAdmin(prisma: PrismaClient) {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  if (!email) {
    console.log('Skipping admin user seed (set ADMIN_BOOTSTRAP_EMAIL to enable)');
    return;
  }
  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      role: 'admin',
      locale: 'en',
      emailVerified: new Date(),
    },
    update: { role: 'admin' },
  });
  console.log(`Seeded admin user: ${email}`);
}
