#!/usr/bin/env tsx
/**
 * Reset stale PlantImage rows so they get re-fetched with the new
 * source+local model. Deletes:
 *   1. Dead dev-MinIO rows (url contains localhost:9000) — bytes gone, no
 *      recoverable source.
 *   2. Old-model local rows (url starts /v1/files but sourceUrl IS NULL) —
 *      hosted before sourceUrl existed, so a fresh deploy couldn't fall
 *      back; re-fetch them to record the upstream source.
 * Any Plant.primaryImageId pointing at a deleted row is nulled, so
 * enrich-images.ts then re-fetches a fresh primary image for it.
 *
 * Idempotent: once every row has a sourceUrl, this deletes nothing.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const stale = await prisma.plantImage.findMany({
    where: {
      OR: [
        { url: { contains: 'localhost:9000' } },
        { AND: [{ url: { startsWith: '/v1/files/' } }, { sourceUrl: null }] },
      ],
    },
    select: { id: true },
  });
  const ids = stale.map((r) => r.id);
  if (ids.length === 0) {
    console.log('reset: nothing stale — every row has a sourceUrl.');
    return;
  }
  const nulled = await prisma.plant.updateMany({
    where: { primaryImageId: { in: ids } },
    data: { primaryImageId: null },
  });
  const del = await prisma.plantImage.deleteMany({ where: { id: { in: ids } } });
  console.log(
    `reset: deleted ${del.count} stale image rows; nulled ${nulled.count} primaryImageId refs ` +
      `(those plants will be re-fetched by enrich-images).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
