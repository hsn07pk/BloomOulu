import { PrismaClient } from '@prisma/client';
import { seedFinnishFlora } from './finnish-flora.js';
import { seedSettings } from './settings.js';
import { seedCitations } from './citations.js';
import { seedEmails } from './emails.js';
import { seedTranslations } from './translations.js';
import { seedContentBlocks } from './content-blocks.js';
import { seedFlags } from './feature-flags.js';
import { seedAdmin } from './admin-user.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding BloomOulu data…');
  await seedSettings(prisma);
  await seedFlags(prisma);
  await seedCitations(prisma);
  await seedFinnishFlora(prisma);
  await seedEmails(prisma);
  await seedTranslations(prisma);
  await seedContentBlocks(prisma);
  await seedAdmin(prisma);
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
