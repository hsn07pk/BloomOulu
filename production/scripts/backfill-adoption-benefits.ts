/**
 * One-off backfill: create AdoptionBenefit rows for every already-active
 * Adoption that didn't go through the new lifecycle path. Idempotent —
 * re-running is a no-op thanks to the (adoptionId, benefitKey) unique
 * index.
 */
import { prisma } from '@bloomoulu/db';
import { benefitsForTier } from '@bloomoulu/constants';

async function main() {
  const adoptions = await prisma.adoption.findMany({
    where: { status: 'active' },
    select: { id: true, tierId: true },
  });
  console.log(`Backfilling benefits for ${adoptions.length} active adoptions…`);
  let total = 0;
  for (const a of adoptions) {
    const catalog = benefitsForTier(a.tierId);
    if (catalog.length === 0) continue;
    const result = await prisma.adoptionBenefit.createMany({
      data: catalog.map((b) => ({
        adoptionId: a.id,
        benefitKey: b.key,
        category: b.category,
        labelSnapshot: b.label,
        donorLabelSnapshot: b.donorLabel ?? null,
        status: b.autoFulfill ? 'fulfilled' : 'pending',
        fulfilledAt: b.autoFulfill ? new Date() : null,
      })),
      skipDuplicates: true,
    });
    total += result.count;
    console.log(`  ${a.id} (${a.tierId}) — ${result.count} new`);
  }
  console.log(`Done. ${total} benefit rows created.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
