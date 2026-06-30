/**
 * reconcile-donations.ts — bridge pre-pivot mock data into the Donation model.
 *
 * Context: the adopt→donate pivot dropped the `Adoption` model and replaced it
 * with `Donation`. The pre-pivot mock-history seed (scripts/seed-mock-history.ts,
 * now stale — it references the dropped `prisma.adoption`) left ~70 *succeeded*
 * Payments for mock donors (`@mock.bloomoulu.test`) ORPHANED: no Donation row,
 * because the migration dropped `Payment.adoptionId`. The live site reads the
 * `Donation` table for the homepage gift count, the `/donors` wall and the kiosk
 * feed — so those looked empty ("1 gift / €20,993") while the money (€20,993,
 * read from `Payment`) and supporter count looked healthy. This reconciles them.
 *
 * What it does: creates one COMPLETED Donation per orphaned succeeded mock
 * Payment, preserving donor + amount + settlement date, and links the Payment
 * back via `donationId`. The per-gift directed-species and dedication detail was
 * lost with the `Adoption` table, so wall-presentation fields (publicName,
 * dedication, showOnWall, anonymous) are regenerated to a realistic distribution
 * that mirrors the original seed's intent. Gifts are recorded as *general*
 * donations (plantId = null), so no per-plant counter denormalisation is needed.
 *
 * IDEMPOTENT: only processes succeeded payments of mock donors whose
 * `donationId` is still NULL — re-running is a no-op once linked.
 * REVERSIBLE: every Donation it creates belongs to a `@mock.bloomoulu.test`
 * donor, so it's removed alongside the rest of the mock dataset.
 *
 * Run (inside the api container, matching scripts/seed-mock-history.ts):
 *   docker compose ... exec -T api sh -c \
 *     'cd /app && ln -sfn /app/apps/api/node_modules/@prisma /app/node_modules/@prisma 2>/dev/null; \
 *      pnpm --filter @bloomoulu/db exec tsx /app/scripts/reconcile-donations.ts'
 *
 * Flags: --dry-run  report what would be created, change nothing.
 */
import { prisma } from '@bloomoulu/db';

const MOCK_EMAIL_DOMAIN = '@mock.bloomoulu.test';

// Deterministic PRNG (mulberry32) so regenerated wall fields are reproducible.
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = makeRng(20260627);
const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;

// Realistic short tributes (fi / en / sv) — the originals were lost with Adoption.
const DEDICATIONS = [
  'Suomen luonnon puolesta',
  'Kiitos kauniista puutarhasta',
  'For future generations',
  'In memory of a dear friend',
  'Protect Finnish flora',
  'Rakkaudella luonnolle',
  'Tack för en vacker trädgård',
  'Onnea ja kukkia',
  'Luonnon monimuotoisuuden puolesta',
  'För kommande generationer',
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`── reconcile-donations ${dryRun ? '(DRY RUN) ' : ''}──────────────────────`);

  // Every orphaned (donationId NULL) succeeded payment. Mock-seed donors get a
  // realistic wall presence; non-mock payments are E2E test artifacts (names
  // like "E2E Final") — we still create donations so the gift count reconciles
  // with the €-raised total, but keep them off the public wall (anonymous).
  const payments = await prisma.payment.findMany({
    where: {
      status: 'succeeded',
      donationId: null,
    },
    select: {
      id: true,
      donorId: true,
      amountCents: true,
      currency: true,
      receivedAt: true,
      createdAt: true,
      donor: { select: { name: true, email: true } },
    },
    orderBy: { receivedAt: 'asc' },
  });
  const mockCount = payments.filter((p) => (p.donor.email ?? '').endsWith(MOCK_EMAIL_DOMAIN)).length;
  console.log(`   orphaned succeeded payments: ${payments.length} (${mockCount} mock, ${payments.length - mockCount} test → anonymous)`);
  if (dryRun) {
    const sum = payments.reduce((s, p) => s + p.amountCents, 0);
    console.log(`   would create ${payments.length} completed donations totalling €${(sum / 100).toFixed(0)}`);
    await prisma.$disconnect();
    return;
  }

  let created = 0;
  for (const p of payments) {
    const isMock = (p.donor.email ?? '').endsWith(MOCK_EMAIL_DOMAIN);
    let anonymous: boolean;
    let showOnWall: boolean;
    let publicName: string | null;
    let dedication: string | null;
    if (isMock) {
      anonymous = rand() < 0.12;
      showOnWall = anonymous ? false : rand() < 0.92;
      const firstName = (p.donor.name ?? '').split(' ')[0] || null;
      publicName = !anonymous && firstName && rand() < 0.5 ? firstName : null;
      dedication = !anonymous && rand() < 0.25 ? pick(DEDICATIONS) : null;
    } else {
      // E2E test payment — count it for total consistency, hide from the wall.
      anonymous = true;
      showOnWall = false;
      publicName = null;
      dedication = null;
    }
    const settledAt = p.receivedAt ?? p.createdAt;

    const donation = await prisma.donation.create({
      data: {
        donorId: p.donorId,
        plantId: null, // general donation — the original directed-species link was lost with Adoption
        status: 'completed',
        amountCents: p.amountCents,
        currency: p.currency,
        dedication,
        showOnWall,
        publicName,
        anonymous,
        marketingOptIn: false,
        startedAt: settledAt,
        createdAt: p.createdAt,
        updatedAt: settledAt,
      },
      select: { id: true },
    });
    await prisma.payment.update({ where: { id: p.id }, data: { donationId: donation.id } });
    created++;
  }
  console.log(`   created ${created} completed donations + linked their payments`);

  const [completed, onWall, raised] = await Promise.all([
    prisma.donation.count({ where: { status: 'completed' } }),
    prisma.donation.count({ where: { status: 'completed', showOnWall: true, anonymous: false } }),
    prisma.payment.aggregate({ _sum: { amountCents: true }, where: { status: 'succeeded' } }),
  ]);
  console.log(
    `   → Donation completed=${completed}, on-wall=${onWall}, ` +
      `raised=€${((raised._sum.amountCents ?? 0) / 100).toFixed(0)}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
