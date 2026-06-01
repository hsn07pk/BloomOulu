#!/usr/bin/env tsx
/**
 * Fill `origin` for cultivars / hybrids / unidentified taxa that have no
 * single wild native range (so native-range sources like WCVP and GBIF
 * legitimately return nothing for them). Without this they keep the
 * placeholder "Origin pending".
 *
 *   pnpm tsx scripts/enrich-origin-cultivars.ts [--dry-run]
 *
 * Targets active plants still origin-pending whose Latin name marks them as
 * horticultural: a cultivar epithet ('...'), a hybrid (x / ×), `hybr.`, or
 * an unranked `sp.`. Idempotent.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry-run');
const ORIGIN =
  'Of horticultural (cultivated) origin — a cultivar, hybrid, or cultivated selection without a single wild native range.';

async function main() {
  const pending = await prisma.plant.findMany({
    where: {
      status: 'active',
      OR: [{ origin: { contains: 'pending', mode: 'insensitive' } }, { origin: '' }],
      taxon: {
        OR: [
          { latinName: { contains: "'" } },
          { latinName: { contains: ' x ' } },
          { latinName: { contains: ' × ' } },
          { latinName: { contains: 'hybr' } },
          { latinName: { contains: ' sp.' } },
          { latinName: { contains: ' cv' } },
        ],
      },
    },
    select: { id: true, taxon: { select: { latinName: true } } },
  });
  console.log(`${pending.length} cultivar/hybrid plants still origin-pending${DRY ? ' (dry run)' : ''}.`);
  if (!DRY && pending.length > 0) {
    const res = await prisma.plant.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { origin: ORIGIN },
    });
    console.log(`Set horticultural origin on ${res.count} plants.`);
  }
  const remaining = await prisma.plant.count({
    where: {
      status: 'active',
      OR: [{ origin: { contains: 'pending', mode: 'insensitive' } }, { origin: '' }],
    },
  });
  console.log(`Origin-pending remaining (non-cultivar): ${remaining}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
