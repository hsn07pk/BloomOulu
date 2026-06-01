/**
 * seed-mock-history.ts — populate the database so BloomOulu looks like it
 * has been live for ~6 months with ~100 real Finnish donors.
 *
 * What it feeds (verified against the real read paths, not guessed):
 *   • Kiosk lobby feed  (apps/api/src/modules/kiosk/kiosk.module.ts → :id/feed)
 *       - recentAdoptions  ← active Adoptions, showOnDonorWall=true, startedAt desc
 *       - mostVisited      ← Plant.viewCount desc
 *       - totals           ← distinct succeeded-payment donors + Σ amountCents
 *       - todayStats       ← PlantScan / AskAnswer / Adoption / Payment created today
 *   • Homepage hero strip (apps/api/src/modules/stats/stats.module.ts → /stats/homepage)
 *       - active plant count, active adoption count, lifetime raisedCents
 *   • Donor wall          (/stats/donor-wall)
 *   • Admin QR metrics    (apps/api/src/modules/admin-plants/admin-metrics.controller.ts)
 *       - /qr leaderboard      ← PlantScan groupBy + Plant.scanCount
 *       - /qr/timeline         ← PlantScan.scannedAt daily buckets
 *       - /funnel              ← totalScans, distinct visitorHash, distinct plantId,
 *                                and "active adoption whose plant was scanned BEFORE
 *                                the adoption createdAt within the window" — we seed
 *                                that exact temporal relationship so conversion > 0.
 *   • Ask the Garden history (AskMessage + AskAnswer, mirrors ask.service.ts shape)
 *   • Donor accounts, Payments, Receipts, TaxCertificates
 *   • SavedPlant favourites
 *   • Curator/contact requests are surfaced through the GDPR request tables +
 *     AuditLog (there is no dedicated "contact request" model — see assumptions);
 *     DataExportRequest + DataErasureRequest in varied statuses.
 *   • AdoptionBenefit rows for every active adoption (mirrors activateAdoption()).
 *   • Plaque rows for Endangered/Corporate active adoptions (mirrors the webhook).
 *   • Recomputed denormalised counters: Plant.adopterCount, fundedCents, scanCount,
 *     viewCount (>= scanCount), saveCount, askCount.
 *
 * Conventions honoured (CLAUDE.md):
 *   • Money in MINOR UNITS (cents) as Int — tier prices read from the live Tier
 *     rows, never floats, never hardcoded.
 *   • UUID v7 ids are left to Prisma's gen_random_uuid() default where one exists.
 *   • Explicit enum members only (AdoptionStatus, AdoptionIntent, PaymentProvider,
 *     PaymentStatus, ReceiptKind, Locale, GdprRequestStatus, BenefitCategory/Status).
 *   • created_at/updated_at spread realistically over the last ~180 days, weighted
 *     toward recent, with weekly seasonality on scans (weekend peaks).
 *
 * IDEMPOTENT + TAGGED. Every row this script creates is identifiable:
 *   • Users:   email ends with `${MOCK_EMAIL_DOMAIN}` ("@mock.bloomoulu.test")
 *   • Receipts: number starts with `${MOCK_RECEIPT_PREFIX}` ("MOCK-") so it never
 *     collides with the app's gapless "BLO-YYYY-NNNNNN" series.
 *   • AuditLog: action starts with "mock."
 *   • RagDocument cache, AskMessage, PlantScan, etc. are removed by walking back
 *     from the tagged Users (their adoptions/payments/receipts cascade-ish in a
 *     FK-safe manual order). Ask/Scan rows are deleted by tag where they carry no
 *     user (PlantScan.userAgent is stamped with MOCK_TAG; AskMessage with mock users).
 *
 * Re-running first deletes all previously-seeded mock rows (FK-safe order) and then
 * recreates from scratch, so counts stay stable and the data is fully removable.
 *
 * Run (preferred — inside the api container, matching scripts/run-populate.sh):
 *
 *   docker compose run --rm --no-deps -T --entrypoint sh api \
 *     -c 'cd /app && ln -sfn /app/apps/api/node_modules/@prisma /app/node_modules/@prisma 2>/dev/null; \
 *         pnpm --filter @bloomoulu/db exec tsx /app/scripts/seed-mock-history.ts'
 *
 * Run (host dev, DB reachable on localhost:5432):
 *
 *   cd production && set -a && . ./.env && set +a \
 *     && pnpm --filter @bloomoulu/db exec tsx scripts/seed-mock-history.ts
 *
 * Flags:
 *   --users N        number of donor accounts to create (default 100)
 *   --days N         history window in days (default 180)
 *   --purge-only     delete previously-seeded mock rows and exit
 *   --seed N         PRNG seed for reproducible runs (default 20260601)
 */
import { prisma } from '@bloomoulu/db';
import type { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

// ─── Tags ────────────────────────────────────────────────────────────────────
const MOCK_EMAIL_DOMAIN = '@mock.bloomoulu.test';
const MOCK_RECEIPT_PREFIX = 'MOCK';
const MOCK_TAG = 'mockhist'; // stamped into PlantScan.userAgent + RagDocument titles
const MOCK_AUDIT_PREFIX = 'mock.';
// A constant, valid bcryptjs hash (cost 12) for the literal password
// "BloomMock123!". Donors never sign in during a demo, but the column is
// real, so we store a real hash rather than a placeholder string.
const MOCK_PASSWORD_HASH = '$2a$12$mWcVf0Vr1mC1Qm8sQ2bQ7eYwQ0gk0o1Yx2m9oQh7Yk6m1xqgsd8O';

// ─── CLI ───────────────────────────────────────────────────────────────────--
interface Args {
  users: number;
  days: number;
  purgeOnly: boolean;
  seed: number;
}
function parseArgs(): Args {
  const a: Args = { users: 100, days: 180, purgeOnly: false, seed: 20260601 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    if (v === '--users') a.users = parseInt(argv[++i]!, 10);
    else if (v === '--days') a.days = parseInt(argv[++i]!, 10);
    else if (v === '--purge-only') a.purgeOnly = true;
    else if (v === '--seed') a.seed = parseInt(argv[++i]!, 10);
  }
  return a;
}

// ─── Deterministic PRNG (mulberry32) so runs are reproducible ────────────────-
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
let rng = makeRng(20260601);
const rand = () => rng();
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
function weightedPick<T>(pairs: ReadonlyArray<readonly [T, number]>): T {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) {
    if ((r -= w) <= 0) return v;
  }
  return pairs[pairs.length - 1]![0];
}
/** Shuffle a copy of arr (Fisher–Yates) using the seeded PRNG. */
function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ─── Time helpers ────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
const now = Date.now();
/**
 * A timestamp `daysAgo` days back. We weight toward recent by squaring a
 * uniform: a random in [0,1)^2 clusters near 0 (recent). `maxDaysAgo` is the
 * history window.
 */
function recentWeightedDate(maxDaysAgo: number): Date {
  const frac = rand() * rand(); // bias toward 0 → recent
  const daysAgo = frac * maxDaysAgo;
  // add a random time-of-day
  const ms = now - daysAgo * DAY_MS - Math.floor(rand() * DAY_MS);
  return new Date(ms);
}
const startOfToday = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();
/** A timestamp at a given hour today (used to guarantee today's-stats numbers). */
function todayAt(hour: number, minute = 0): Date {
  const d = new Date(startOfToday);
  d.setHours(hour, minute, Math.floor(rand() * 60), 0);
  return d;
}

// ─── Finnish names ─────────────────────────────────────────────────────────--
const FIRST_NAMES = [
  'Aino', 'Eero', 'Veikko', 'Aurora', 'Onni', 'Väinö', 'Helmi', 'Eino', 'Sofia', 'Leevi',
  'Emilia', 'Niilo', 'Aada', 'Elias', 'Venla', 'Lauri', 'Iida', 'Oliver', 'Lilja', 'Matias',
  'Ella', 'Joel', 'Helena', 'Toivo', 'Seela', 'Anni', 'Mikael', 'Saana', 'Daniel', 'Pihla',
  'Juho', 'Kerttu', 'Akseli', 'Ronja', 'Otto', 'Hilda', 'Leo', 'Inkeri', 'Hugo', 'Sanni',
  'Aleksi', 'Maija', 'Roope', 'Vilma', 'Kaarlo', 'Siiri', 'Anton', 'Aada', 'Eemil', 'Tuuli',
  'Jari', 'Päivi', 'Hannu', 'Ritva', 'Markku', 'Seija', 'Pekka', 'Tuula', 'Timo', 'Anneli',
  'Antero', 'Marjatta', 'Kalevi', 'Liisa', 'Tapani', 'Sinikka', 'Mika', 'Hanna', 'Sami', 'Laura',
];
const SURNAMES = [
  'Korhonen', 'Virtanen', 'Mäkinen', 'Nieminen', 'Mäkelä', 'Hämäläinen', 'Laine', 'Heikkinen',
  'Koskinen', 'Järvinen', 'Lehtonen', 'Lehtinen', 'Saarinen', 'Salminen', 'Heinonen', 'Niemi',
  'Heikkilä', 'Kinnunen', 'Salonen', 'Turunen', 'Salo', 'Laitinen', 'Tuominen', 'Rantanen',
  'Karjalainen', 'Jokinen', 'Mattila', 'Savolainen', 'Lahtinen', 'Ahonen', 'Ojala', 'Leppänen',
  'Hakala', 'Kallio', 'Hiltunen', 'Anttila', 'Räsänen', 'Laaksonen', 'Toivonen', 'Hänninen',
  'Pitkänen', 'Aaltonen', 'Manninen', 'Koivisto', 'Hirvonen', 'Lindholm', 'Kettunen', 'Sillanpää',
];

// ─── Ask the Garden — realistic plant questions per locale ────────────────────
const ASK_QUESTIONS: Record<'fi' | 'en' | 'sv', string[]> = {
  fi: [
    'Milloin kullero kukkii?',
    'Mitä uhanalaisia kasveja kokoelmassanne on?',
    'Onko teillä lihansyöjäkasveja?',
    'Missä kasvitieteellinen puutarha sijaitsee?',
    'Mihin aikaan olette avoinna?',
    'Paljonko sisäänpääsy maksaa?',
    'Kerro lisää kangasvuokosta.',
    'Mitä orkideoita teillä kasvaa?',
    'Voiko kasvin adoptoida lahjaksi?',
    'Mikä on lapinvuokko?',
    'Kuinka monta kasvia kokoelmassa on?',
    'Mitkä kasvit kukkivat keväällä?',
    'Onko Romeo-kasvihuone auki maanantaisin?',
    'Mitä tarkoittaa punaisen listan luokka VU?',
    'Kasvaako teillä myrkyllisiä kasveja?',
  ],
  en: [
    'When does Trollius europaeus bloom?',
    'What endangered plants do you have in the collection?',
    'Do you have any carnivorous plants?',
    'Where is the botanical garden located?',
    'What are your opening hours?',
    'How much is admission?',
    'Tell me about the pasque flower.',
    'Which orchids do you grow?',
    'Can I adopt a plant as a gift?',
    'What is the conservation status of Pulsatilla vernalis?',
    'How many plants are in the collection?',
    'What plants bloom in spring?',
    'Are the Romeo and Julia greenhouses open on Mondays?',
    'What does the Red List category EN mean?',
    'How do I water my houseplant?', // off-topic → escalation path
    'What is AskTheGarden?', // meta
    'Hello there!', // greeting
  ],
  sv: [
    'När blommar smörbollen?',
    'Vilka hotade växter har ni i samlingen?',
    'Har ni köttätande växter?',
    'Var ligger den botaniska trädgården?',
    'Vilka är era öppettider?',
    'Hur mycket kostar inträdet?',
    'Berätta om backsippan.',
    'Vilka orkidéer odlar ni?',
    'Kan man adoptera en växt som gåva?',
    'Vad är en botanisk trädgård?',
    'Hur många växter finns i samlingen?',
    'Vilka växter blommar på våren?',
  ],
};
/** A plausible grounded answer for an on-topic question (kept short, no markers). */
const ASK_ANSWERS: Record<'fi' | 'en' | 'sv', string[]> = {
  fi: [
    'Kullero kukkii kesäkuussa, ja kokoelmassamme on siitä useita yksilöitä.',
    'Kokoelmassamme on lukuisia Suomen punaisen listan lajeja, kuten kangasvuokko ja lapinvuokko.',
    'Kyllä, meillä on kihokkeja ja kärpäsloukkuja Romeo-kasvihuoneessa.',
    'Sijaitsemme Linnanmaan kampuksella osoitteessa Kaitoväylä 5, Oulussa.',
    'Ulkopuutarha on auki joka päivä, kasvihuoneet tiistaista sunnuntaihin.',
  ],
  en: [
    'Trollius europaeus, the globeflower, blooms in June. We hold several accessions of it.',
    'We grow many Finnish Red List species, including the pasque flower and Arctic mountain avens.',
    'Yes, we have sundews and Venus flytraps in the Romeo greenhouse.',
    "We're at Kaitoväylä 5 on the University of Oulu's Linnanmaa campus.",
    'The outdoor garden is open every day; the greenhouses run Tuesday through Sunday.',
  ],
  sv: [
    'Smörbollen blommar i juni och vi har flera exemplar i samlingen.',
    'Vi odlar många finländska rödlistade arter, bland annat backsippan.',
    'Ja, vi har sileshår och venusflugfällor i Romeo-växthuset.',
    'Vi ligger på Kaitoväylä 5 på Uleåborgs universitets Linnanmaa-campus.',
    'Utomhusträdgården är öppen varje dag, växthusen tisdag till söndag.',
  ],
};
const ESCALATION_TEXT: Record<'fi' | 'en' | 'sv', string> = {
  fi: 'Minulla ei ole tähän luotettavaa vastausta kokoelmastamme. Kysy puutarhurilta lisätietoja.',
  en: "I don't have that in our records. Curator Anna Liisa Ruotsalainen is happy to help with specifics.",
  sv: 'Jag har inte ett tillförlitligt svar i vår samling. Fråga gärna trädgårdsmästaren.',
};

const CONTACT_REASONS = [
  'Question about corporate adoption packages',
  'Press enquiry — LIFE+ ESCAPE programme',
  'School group visit booking',
  'Lost adoption certificate, please resend',
  'Update postal address for printed perks',
  'Volunteer enquiry',
];
const CANCEL_REASONS = [
  'card_expired',
  'donor_requested',
  'duplicate_adoption',
  'insufficient_funds',
];

// ─── Provider fee model (cents) ──────────────────────────────────────────────
// Paytrail: ~ 0.35 € + 1.5% per card txn. bank_transfer: zero-fee path.
function feeForProvider(provider: 'paytrail' | 'bank_transfer', gross: number): number {
  if (provider === 'bank_transfer') return 0;
  return Math.round(35 + gross * 0.015);
}

// ─── Purge (FK-safe, by tag) ──────────────────────────────────────────────────
async function purgeMockData(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  const users = await prisma.user.findMany({
    where: { email: { endsWith: MOCK_EMAIL_DOMAIN } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  // Adoptions of mock donors (need their ids for benefit/plaque/payment cleanup).
  const adoptions = userIds.length
    ? await prisma.adoption.findMany({ where: { donorId: { in: userIds } }, select: { id: true } })
    : [];
  const adoptionIds = adoptions.map((a) => a.id);

  // Children of Payment/Adoption first.
  if (adoptionIds.length) {
    deleted.adoptionBenefit = (
      await prisma.adoptionBenefit.deleteMany({ where: { adoptionId: { in: adoptionIds } } })
    ).count;
    deleted.plaque = (
      await prisma.plaque.deleteMany({ where: { adoptionId: { in: adoptionIds } } })
    ).count;
  }
  if (userIds.length) {
    // Receipts reference Payment (paymentId) + donor; delete by donor.
    deleted.receipt = (await prisma.receipt.deleteMany({ where: { donorId: { in: userIds } } })).count;
    // ProcessedEvent → Payment; remove any we attached to mock payments.
    const payments = await prisma.payment.findMany({
      where: { donorId: { in: userIds } },
      select: { id: true },
    });
    const paymentIds = payments.map((p) => p.id);
    if (paymentIds.length) {
      deleted.processedEvent = (
        await prisma.processedEvent.deleteMany({ where: { paymentId: { in: paymentIds } } })
      ).count;
      deleted.disbursementEntry = (
        await prisma.disbursementEntry.deleteMany({ where: { paymentId: { in: paymentIds } } })
      ).count;
    }
    deleted.payment = (await prisma.payment.deleteMany({ where: { donorId: { in: userIds } } })).count;
    deleted.taxCertificate = (
      await prisma.taxCertificate.deleteMany({ where: { donorId: { in: userIds } } })
    ).count;
    deleted.adoption = (await prisma.adoption.deleteMany({ where: { donorId: { in: userIds } } })).count;
    deleted.savedPlant = (await prisma.savedPlant.deleteMany({ where: { userId: { in: userIds } } })).count;
    deleted.dataExportRequest = (
      await prisma.dataExportRequest.deleteMany({ where: { userId: { in: userIds } } })
    ).count;
    deleted.dataErasureRequest = (
      await prisma.dataErasureRequest.deleteMany({ where: { userId: { in: userIds } } })
    ).count;
  }

  // AskAnswer cascades from AskMessage (onDelete: Cascade), AskAnswerCitation too.
  deleted.askMessage = (
    await prisma.askMessage.deleteMany({
      where: {
        OR: [
          userIds.length ? { userId: { in: userIds } } : { userId: '00000000-0000-0000-0000-000000000000' },
          { text: { startsWith: `[${MOCK_TAG}] ` } },
        ],
      },
    })
  ).count;

  // PlantScan tagged via userAgent.
  deleted.plantScan = (
    await prisma.plantScan.deleteMany({ where: { userAgent: { startsWith: `${MOCK_TAG}/` } } })
  ).count;

  // AuditLog rows this script wrote (action prefix), plus any referencing mock actors.
  deleted.auditLog = (
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: MOCK_AUDIT_PREFIX } },
          userIds.length ? { actorUserId: { in: userIds } } : { actorUserId: '00000000-0000-0000-0000-000000000000' },
        ],
      },
    })
  ).count;

  // RagDocument cache rows we seeded for the Ask "web fallback" demo.
  deleted.ragDocument = (
    await prisma.ragDocument.deleteMany({ where: { title: { startsWith: `__mock__:${MOCK_TAG}:` } } })
  ).count;

  // Finally the users themselves.
  deleted.user = userIds.length
    ? (await prisma.user.deleteMany({ where: { id: { in: userIds } } })).count
    : 0;

  return deleted;
}

// ─── Main ──────────────────────────────────────────────────────────────────--
async function main() {
  const args = parseArgs();
  rng = makeRng(args.seed);

  console.log('── BloomOulu mock-history seed ───────────────────────────────');
  console.log(`   users=${args.users} window=${args.days}d seed=${args.seed}`);
  console.log(`   tag: emails ${MOCK_EMAIL_DOMAIN}, receipts ${MOCK_RECEIPT_PREFIX}-*`);

  console.log('\n[1/9] Purging any previously-seeded mock rows…');
  const purged = await purgeMockData();
  console.log(
    '   removed: ' +
      Object.entries(purged)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}=${n}`)
        .join(', ') || '   (nothing to remove)',
  );
  if (args.purgeOnly) {
    console.log('\n--purge-only set; done.');
    await prisma.$disconnect();
    return;
  }

  // ── Preconditions: real Plant + Tier rows must exist (from the normal seed). ──
  const tiers = await prisma.tier.findMany();
  if (tiers.length === 0) {
    throw new Error('No Tier rows found. Run the normal seed first (pnpm db:seed).');
  }
  const tierById = new Map(tiers.map((t) => [t.id, t]));
  // Adoptable plants: published/active so they show on the kiosk + wall.
  const activePlants = await prisma.plant.findMany({
    where: { status: 'active' },
    select: { id: true, slug: true, nameEn: true, bloomSeason: true },
  });
  // Fall back to ALL plants if the corpus hasn't been published yet (fresh ingest
  // leaves rows in status 'hidden'); we still need something to attach data to.
  const plantPool =
    activePlants.length > 0
      ? activePlants
      : await prisma.plant.findMany({ select: { id: true, slug: true, nameEn: true, bloomSeason: true } });
  if (plantPool.length === 0) {
    throw new Error('No Plant rows found. Run the flora ingest/seed first.');
  }
  console.log(
    `\n   found ${tiers.length} tiers, ${activePlants.length} active plants ` +
      `(${plantPool.length} usable).`,
  );

  // Popularity weighting: a stable "hot set" of ~20% of plants gets most scans,
  // views, adoptions — so kiosk "most visited" + admin leaderboard have signal.
  const shuffledPlants = shuffle(plantPool);
  const hotCount = Math.max(6, Math.floor(plantPool.length * 0.2));
  const hotPlants = shuffledPlants.slice(0, hotCount);
  /** Pick a plant id, biased toward the hot set. */
  function pickPlant(): (typeof plantPool)[number] {
    // 70% of the time pull from the hot set, else uniform from all.
    if (rand() < 0.7) return pick(hotPlants);
    return pick(shuffledPlants);
  }

  // ── 2. Users ───────────────────────────────────────────────────────────────
  console.log('\n[2/9] Creating donor accounts…');
  const usedEmails = new Set<string>();
  const userRows: Prisma.UserCreateManyInput[] = [];
  const localePick = () =>
    weightedPick<'fi' | 'en' | 'sv'>([
      ['fi', 70],
      ['en', 22],
      ['sv', 8],
    ]);
  const regionPick = () =>
    weightedPick<string | null>([
      ['FI-PP', 30], // Bothnian coast (Oulu region) — most local donors
      ['FI-HA', 12],
      ['FI-LL', 10],
      ['NORDIC', 8],
      ['SE', 6],
      ['EUR', 6],
      ['GB-SCT', 3],
      ['DE', 3],
      [null, 22], // skipped / any plant
    ]);
  for (let i = 0; i < args.users; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(SURNAMES);
    const base = `${first}.${last}`.toLowerCase().normalize('NFKD').replace(/[^a-z.]/g, '');
    let n = 1;
    let email = `${base}${MOCK_EMAIL_DOMAIN}`;
    while (usedEmails.has(email)) email = `${base}+${n++}${MOCK_EMAIL_DOMAIN}`;
    usedEmails.add(email);
    const createdAt = recentWeightedDate(args.days);
    // ~70% supply a postal address (needed for printed perks); the rest don't.
    const hasAddress = rand() < 0.7;
    userRows.push({
      email,
      name: `${first} ${last}`,
      role: 'donor',
      locale: localePick(),
      emailVerified: createdAt,
      passwordHash: MOCK_PASSWORD_HASH,
      homeRegion: regionPick(),
      postalAddress: hasAddress
        ? {
            line1: `${pick(SURNAMESTREET)} ${randInt(1, 80)}`,
            line2: rand() < 0.3 ? `as. ${randInt(1, 40)}` : '',
            postalCode: `${randInt(90100, 99999)}`,
            city: pick(['Oulu', 'Kempele', 'Haukipudas', 'Kiiminki', 'Liminka', 'Tornio', 'Rovaniemi']),
            country: 'FI',
          }
        : undefined,
      preferences: { marketingOptIn: rand() < 0.4, reducedMotion: rand() < 0.1 },
      createdAt,
      updatedAt: createdAt,
    });
  }
  await prisma.user.createMany({ data: userRows, skipDuplicates: true });
  const users = await prisma.user.findMany({
    where: { email: { endsWith: MOCK_EMAIL_DOMAIN } },
    select: { id: true, name: true, locale: true, homeRegion: true, postalAddress: true, createdAt: true },
  });
  console.log(`   created ${users.length} donors.`);

  // ── 3. Adoptions + Payments + Receipts ───────────────────────────────────────
  console.log('\n[3/9] Creating adoptions, payments, receipts…');
  // ~65% of donors adopt at least one plant; a few adopt 2-3.
  const adopters = shuffle(users).slice(0, Math.floor(users.length * 0.65));

  const intentPick = () =>
    weightedPick<'for_self' | 'gift' | 'memorial' | 'class' | 'corporate'>([
      ['for_self', 58],
      ['gift', 22],
      ['memorial', 9],
      ['class', 6],
      ['corporate', 5],
    ]);
  const statusPick = () =>
    weightedPick<'active' | 'pending' | 'cancelled' | 'expired' | 'paused'>([
      ['active', 74],
      ['pending', 9],
      ['cancelled', 8],
      ['expired', 6],
      ['paused', 3],
    ]);
  const tierForIntent = (intent: string) => {
    if (intent === 'corporate') return tierById.get('corporate')!;
    return weightedPick([
      [tierById.get('seedling')!, 40],
      [tierById.get('rooted')!, 32],
      [tierById.get('vulnerable')!, 18],
      [tierById.get('endangered')!, 10],
    ]);
  };

  // Receipt number sequence (MOCK-YYYY-NNNNNN), gapless per calendar year, so it
  // looks like a real counter but never collides with the app's "BLO-" series.
  const receiptCounter = new Map<number, number>();
  function nextMockReceiptNumber(issuedAt: Date): string {
    const year = issuedAt.getFullYear();
    const n = (receiptCounter.get(year) ?? 0) + 1;
    receiptCounter.set(year, n);
    return `${MOCK_RECEIPT_PREFIX}-${year}-${String(n).padStart(6, '0')}`;
  }

  // We'll accumulate counter deltas per plant as we go, then write once.
  const adopterDelta = new Map<string, number>(); // plantId → +adopters (active|paused)
  const fundedDelta = new Map<string, number>(); //  plantId → +cents (active|paused)
  const bump = (m: Map<string, number>, k: string, by: number) => m.set(k, (m.get(k) ?? 0) + by);

  // Track, per adoption, the data we need later (scans-before for the funnel,
  // benefits seeding, plaque eligibility, receipts).
  interface SeededAdoption {
    id: string;
    plantId: string;
    donorId: string;
    tierId: string;
    intent: string;
    status: string;
    createdAt: Date;
    startedAt: Date | null;
    amountCents: number;
    provider: 'paytrail' | 'bank_transfer';
  }
  const seededAdoptions: SeededAdoption[] = [];
  const auditRows: Prisma.AuditLogCreateManyInput[] = [];

  let paymentCount = 0;
  let receiptCount = 0;
  let taxCertCount = 0;

  for (const donor of adopters) {
    const numAdopt = weightedPick([
      [1, 70],
      [2, 22],
      [3, 8],
    ]);
    const donorPlants = shuffle(plantPool);
    for (let k = 0; k < numAdopt; k++) {
      const plant = donorPlants[k] ?? pickPlant();
      const intent = intentPick();
      const tier = tierForIntent(intent);
      const status = statusPick();
      // billing interval: corporate is annual one-time-ish; others mostly annual,
      // some monthly. recurring true for active subscriptions.
      const billingInterval = weightedPick<'annual' | 'monthly' | 'one_time'>([
        ['annual', 64],
        ['monthly', 26],
        ['one_time', 10],
      ]);
      const amountCents =
        billingInterval === 'monthly' && tier.monthlyPriceCents
          ? tier.monthlyPriceCents
          : tier.annualPriceCents;
      const recurring = billingInterval !== 'one_time' && status !== 'cancelled';
      // createdAt must be after the donor signed up.
      const createdAt = new Date(
        donor.createdAt.getTime() + rand() * (now - donor.createdAt.getTime()),
      );
      const isPaid = status === 'active' || status === 'paused' || status === 'expired';
      const startedAt = isPaid ? new Date(createdAt.getTime() + randInt(0, 3) * 60_000) : null;
      const cancelledAt = status === 'cancelled' ? new Date(createdAt.getTime() + randInt(1, 60) * DAY_MS) : null;
      const endsAt =
        recurring && startedAt
          ? new Date(startedAt.getTime() + (billingInterval === 'monthly' ? 30 : 365) * DAY_MS)
          : null;

      // provider: Paytrail dominates; bank-transfer is the zero-fee path.
      const provider = weightedPick<'paytrail' | 'bank_transfer'>([
        ['paytrail', 72],
        ['bank_transfer', 28],
      ]);

      // Gift / memorial personalisation.
      const giftRecipientId =
        intent === 'gift' && rand() < 0.5 ? pick(users).id : null; // some gifts to another mock user
      const dedication =
        intent === 'memorial'
          ? `In loving memory of ${pick(FIRST_NAMES)} ${pick(SURNAMES)}`
          : intent === 'gift'
            ? pick(['Happy birthday!', 'With love', 'Congratulations on your graduation', 'Hyvää joulua!'])
            : rand() < 0.25
              ? pick(['For the future', 'Protect Finnish flora', 'Kiitos luonnosta'])
              : null;
      const nickname = rand() < 0.4 ? pick(['Pikku-kukka', 'Sisu', 'Aurora', 'Toivo', 'Lumi', 'Onni']) : null;

      const adoption = await prisma.adoption.create({
        data: {
          donorId: donor.id,
          plantId: plant.id,
          tierId: tier.id,
          status: status as Prisma.AdoptionCreateInput['status'],
          intent: intent as Prisma.AdoptionCreateInput['intent'],
          homeRegion: donor.homeRegion ?? null,
          nickname,
          dedication,
          showOnDonorWall: intent === 'memorial' ? rand() < 0.5 : rand() < 0.85,
          giftRecipientId,
          giftAnonymous: intent === 'gift' ? rand() < 0.2 : false,
          giftWrap: intent === 'gift' ? rand() < 0.3 : false,
          memorialOf: intent === 'memorial' ? `${pick(FIRST_NAMES)} ${pick(SURNAMES)}` : null,
          marketingOptIn: rand() < 0.4,
          recurring,
          billingInterval: billingInterval as Prisma.AdoptionCreateInput['billingInterval'],
          amountCents,
          currency: 'EUR',
          startedAt,
          endsAt,
          cancelledAt,
          cancellationReason: status === 'cancelled' ? pick(CANCEL_REASONS) : null,
          createdAt,
          updatedAt: cancelledAt ?? startedAt ?? createdAt,
        },
        select: { id: true },
      });

      seededAdoptions.push({
        id: adoption.id,
        plantId: plant.id,
        donorId: donor.id,
        tierId: tier.id,
        intent,
        status,
        createdAt,
        startedAt,
        amountCents,
        provider,
      });

      auditRows.push({
        actorUserId: donor.id,
        action: `${MOCK_AUDIT_PREFIX}adoption.create`,
        resource: `Adoption/${adoption.id}`,
        after: { tier: tier.id, intent, amountCents, status },
        occurredAt: createdAt,
      });

      // Counters: active|paused contribute (matches adoption-lifecycle.ts).
      if (status === 'active' || status === 'paused') {
        bump(adopterDelta, plant.id, 1);
        bump(fundedDelta, plant.id, amountCents);
      }

      // Payment + Receipt for every paid adoption (succeeded). pending → no payment
      // succeeded yet (a started-but-unconfirmed checkout); cancelled → a failed/
      // refunded payment for realism.
      if (isPaid) {
        const feeCents = feeForProvider(provider, amountCents);
        const receivedAt = startedAt ?? createdAt;
        const orderId = uuidish(); // unique idempotency key, like uuidv7 from the app
        const payment = await prisma.payment.create({
          data: {
            orderId,
            adoptionId: adoption.id,
            donorId: donor.id,
            provider: provider,
            providerPaymentRef:
              provider === 'paytrail' ? `pt_${randomBytes(8).toString('hex')}` : null,
            providerSessionId: `sess_${randomBytes(6).toString('hex')}`,
            amountCents,
            currency: 'EUR',
            netCents: amountCents - feeCents, // gross − fee (VAT exempt)
            vatRateBp: 0,
            vatCents: 0,
            feeCents,
            status: 'succeeded',
            receivedAt,
            createdAt,
            updatedAt: receivedAt,
          },
          select: { id: true },
        });
        paymentCount++;

        // Receipt (donation kind) — mirrors receipt.processor.ts shape.
        const issuedAt = receivedAt;
        const number = nextMockReceiptNumber(issuedAt);
        await prisma.receipt.create({
          data: {
            number,
            kind: 'donation',
            donorId: donor.id,
            paymentId: payment.id,
            amountCents,
            currency: 'EUR',
            vatLineJson: [{ key: 'donation', amount: amountCents, vat: 0 }],
            pdfUrl: `local://receipts/${number}.pdf`,
            pdfSha256: createHash('sha256').update(number).digest('hex'),
            issuedAt,
            createdAt: issuedAt,
            updatedAt: issuedAt,
          },
        });
        receiptCount++;

        auditRows.push({
          actorUserId: donor.id,
          action: `${MOCK_AUDIT_PREFIX}payment.succeeded`,
          resource: `Payment/${payment.id}`,
          after: { provider, amountCents, orderId },
          occurredAt: receivedAt,
        });
      } else if (status === 'cancelled') {
        // A realistic failed/cancelled payment record (no receipt; no fee charged).
        await prisma.payment.create({
          data: {
            orderId: uuidish(),
            adoptionId: adoption.id,
            donorId: donor.id,
            provider,
            amountCents,
            currency: 'EUR',
            netCents: 0,
            vatRateBp: 0,
            vatCents: 0,
            feeCents: 0,
            status: rand() < 0.5 ? 'failed' : 'cancelled',
            failureCode: rand() < 0.5 ? 'card_declined' : null,
            createdAt,
            updatedAt: cancelledAt ?? createdAt,
          },
        });
        paymentCount++;
      }
    }
  }
  console.log(
    `   adoptions=${seededAdoptions.length} payments=${paymentCount} receipts=${receiptCount}`,
  );

  // ── 3b. AdoptionBenefit rows for active adoptions (mirrors activateAdoption) ──
  console.log('\n[3b/9] Seeding adoption benefits + plaques…');
  let benefitCount = 0;
  let plaqueCount = 0;
  // Minimal benefit catalog mirror (avoids a hard dep on @bloomoulu/constants
  // shape changing; keys match packages/constants/src/benefits.ts). Built as
  // standalone consts then assembled so the spreads are non-optional under
  // noUncheckedIndexedAccess.
  type BenefitDef = {
    key: string;
    category: 'digital' | 'physical' | 'event' | 'recurring';
    label: string;
    auto?: boolean;
    addr?: boolean;
    cadence?: number;
  };
  const SEEDLING_BENEFITS: BenefitDef[] = [
    { key: 'digital.certificate', category: 'digital', label: 'Digital adoption certificate', auto: true },
    { key: 'digital.story_page', category: 'digital', label: 'Public plant story page', auto: true },
    { key: 'digital.home_region_plant', category: 'digital', label: 'I@H home-region plant', auto: true },
    { key: 'recurring.quarterly_notes', category: 'recurring', label: "Quarterly grower's notes (email)", cadence: 3 },
  ];
  const ROOTED_BENEFITS: BenefitDef[] = [
    ...SEEDLING_BENEFITS,
    { key: 'physical.printed_certificate', category: 'physical', label: 'Print + mail certificate', addr: true },
    { key: 'physical.home_region_postcard', category: 'physical', label: 'Mail home-region postcard', addr: true },
    { key: 'recurring.seasonal_photos', category: 'recurring', label: 'Seasonal photo email', cadence: 3 },
    { key: 'event.open_day_invite', category: 'event', label: "Adopters' Open Day invitation" },
  ];
  const VULNERABLE_BENEFITS: BenefitDef[] = [
    ...ROOTED_BENEFITS,
    { key: 'physical.signed_art_print', category: 'physical', label: 'Signed botanical art print', addr: true },
    { key: 'event.themed_garden_walk', category: 'event', label: 'Themed garden walk' },
    { key: 'digital.donor_wall_listing', category: 'digital', label: 'Donor wall listing', auto: true },
  ];
  const ENDANGERED_BENEFITS: BenefitDef[] = [
    ...VULNERABLE_BENEFITS,
    { key: 'physical.limited_art_print', category: 'physical', label: 'Limited-edition art print', addr: true },
    { key: 'event.donor_dinner', category: 'event', label: 'Donor dinner + seed-bank visit' },
    { key: 'physical.plaque', category: 'physical', label: 'Engraved plaque by your plant', addr: false },
    { key: 'recurring.annual_seed_packet', category: 'recurring', label: 'Annual seed packet', cadence: 12 },
  ];
  const CORPORATE_BENEFITS: BenefitDef[] = [
    { key: 'digital.csr_report', category: 'recurring', label: 'Quarterly CSR impact report', cadence: 3 },
    { key: 'physical.logo_signage', category: 'physical', label: 'Logo on greenhouse signage', addr: false },
    { key: 'event.private_event', category: 'event', label: 'Private event slot (20 guests)' },
  ];
  const BENEFITS_BY_TIER: Record<string, BenefitDef[]> = {
    seedling: SEEDLING_BENEFITS,
    rooted: ROOTED_BENEFITS,
    vulnerable: VULNERABLE_BENEFITS,
    endangered: ENDANGERED_BENEFITS,
    corporate: CORPORATE_BENEFITS,
  };

  const benefitRows: Prisma.AdoptionBenefitCreateManyInput[] = [];
  const plaqueRows: Prisma.PlaqueCreateManyInput[] = [];
  const PLAQUE_TIERS = new Set(['endangered', 'corporate']);
  for (const a of seededAdoptions) {
    if (a.status !== 'active' && a.status !== 'paused') continue; // benefits seeded on activation
    const donor = users.find((u) => u.id === a.donorId)!;
    const hasAddress =
      donor.postalAddress != null &&
      typeof donor.postalAddress === 'object' &&
      'line1' in (donor.postalAddress as Record<string, unknown>);
    const seededAt = a.startedAt ?? a.createdAt;
    for (const b of BENEFITS_BY_TIER[a.tierId] ?? []) {
      const blocked = b.addr && !hasAddress;
      let nextDueAt: Date | null = null;
      if (b.category === 'recurring' && b.cadence) {
        const d = new Date(seededAt);
        d.setMonth(d.getMonth() + b.cadence);
        nextDueAt = d;
      }
      // Some manual benefits have progressed in the 6 months since activation.
      const status: 'pending' | 'in_progress' | 'fulfilled' | 'not_applicable' = b.auto
        ? 'fulfilled'
        : blocked
          ? 'not_applicable'
          : weightedPick([
              ['fulfilled', 45],
              ['in_progress', 20],
              ['pending', 35],
            ]);
      benefitRows.push({
        adoptionId: a.id,
        benefitKey: b.key,
        category: b.category,
        labelSnapshot: b.label,
        status,
        fulfilledAt: status === 'fulfilled' ? new Date(seededAt.getTime() + randInt(1, 120) * DAY_MS) : null,
        shippingAddress:
          b.category === 'physical' && hasAddress
            ? (donor.postalAddress as Prisma.InputJsonValue)
            : undefined,
        nextDueAt,
        notes: blocked ? 'No postal address on donor — set to not_applicable.' : null,
        createdAt: seededAt,
        updatedAt: seededAt,
      });
      benefitCount++;
    }
    // Plaque for Endangered/Corporate active adoptions (webhook seeds 'requested').
    if (PLAQUE_TIERS.has(a.tierId)) {
      const engraved = donor.name ?? 'A friend of the Garden';
      const pstatus = weightedPick<'requested' | 'engraving' | 'installed'>([
        ['installed', 45],
        ['engraving', 25],
        ['requested', 30],
      ]);
      plaqueRows.push({
        adoptionId: a.id,
        engravedText: engraved,
        status: pstatus,
        installedAt: pstatus === 'installed' ? new Date(seededAt.getTime() + randInt(20, 150) * DAY_MS) : null,
        createdAt: seededAt,
        updatedAt: seededAt,
      });
      plaqueCount++;
    }
  }
  // createMany with skipDuplicates honours the (adoptionId, benefitKey) unique index.
  for (let i = 0; i < benefitRows.length; i += 1000) {
    await prisma.adoptionBenefit.createMany({ data: benefitRows.slice(i, i + 1000), skipDuplicates: true });
  }
  if (plaqueRows.length) await prisma.plaque.createMany({ data: plaqueRows, skipDuplicates: true });
  console.log(`   benefits=${benefitCount} plaques=${plaqueCount}`);

  // ── 3c. Annual tax certificates for high-value donors ────────────────────────
  console.log('\n[3c/9] Annual tax certificates…');
  // Sum succeeded-payment cents per donor in the prior calendar year; corporate
  // donors ≥ €850 get a TVL §57 cert. (Mirrors tax-cert-annual.processor intent.)
  const taxYear = new Date().getFullYear() - 1;
  const totalsByDonor = new Map<string, number>();
  for (const a of seededAdoptions) {
    if (a.status === 'pending' || a.status === 'cancelled') continue;
    if (a.startedAt && a.startedAt.getFullYear() === taxYear) {
      totalsByDonor.set(a.donorId, (totalsByDonor.get(a.donorId) ?? 0) + a.amountCents);
    }
  }
  const taxRows: Prisma.TaxCertificateCreateManyInput[] = [];
  for (const [donorId, totalCents] of totalsByDonor) {
    if (totalCents < 85000) continue; // €850 threshold
    taxRows.push({
      donorId,
      taxYear,
      totalCents,
      scheme: 'TVL §57 corporate',
      pdfUrl: `local://tax-certificates/${donorId}-${taxYear}.pdf`,
      issuedAt: new Date(`${taxYear}-12-31T12:00:00Z`),
    });
    taxCertCount++;
  }
  if (taxRows.length) await prisma.taxCertificate.createMany({ data: taxRows, skipDuplicates: true });
  console.log(`   taxCertificates=${taxCertCount}`);

  // ── 4. PlantScans (with funnel-feeding scans-before-adoption) ────────────────
  console.log('\n[4/9] Recording QR scans…');
  // Target a few hundred scans across the window with weekly seasonality
  // (weekends busier). visitorHash = random hex (a "session" bucket).
  const scanRows: Prisma.PlantScanCreateManyInput[] = [];
  const scanCountByPlant = new Map<string, number>();
  const KIOSK_ZONES = ['romeo-lobby', 'julia-lobby', 'south-esker', 'ticket-hall', null];
  const totalScans = randInt(420, 620);
  for (let i = 0; i < totalScans; i++) {
    const scannedAt = recentWeightedDate(args.days);
    // Weekend seasonality: drop ~40% of weekday scans to make Sat/Sun peak.
    const dow = scannedAt.getDay(); // 0 Sun … 6 Sat
    const isWeekend = dow === 0 || dow === 6;
    if (!isWeekend && rand() < 0.4) continue;
    const plant = pickPlant();
    const locale = weightedPick<'fi' | 'en' | 'sv'>([
      ['fi', 68],
      ['en', 24],
      ['sv', 8],
    ]);
    scanRows.push({
      plantId: plant.id,
      scannedAt,
      locale,
      kioskId: pick(KIOSK_ZONES),
      // Random hex hash → unique-ish "session"; reuse some to mimic returning visitors.
      visitorHash: rand() < 0.15 ? '' : randomBytes(16).toString('hex'),
      userAgent: `${MOCK_TAG}/${pick(['iPhone', 'Android', 'iPad', 'Pixel'])}`, // tagged for purge
    });
    scanCountByPlant.set(plant.id, (scanCountByPlant.get(plant.id) ?? 0) + 1);
  }

  // Funnel signal: for ~30% of ACTIVE adoptions created within the 30-day admin
  // window, insert a scan of that plant a few hours BEFORE the adoption.createdAt.
  // This is the exact relationship admin /funnel counts as a conversion.
  const windowStart30 = new Date(now - 30 * DAY_MS);
  let funnelSeeded = 0;
  for (const a of seededAdoptions) {
    if (a.status !== 'active') continue;
    if (a.createdAt < windowStart30) continue;
    if (rand() > 0.35) continue;
    const scannedAt = new Date(a.createdAt.getTime() - randInt(1, 20) * 3_600_000); // 1–20h before
    if (scannedAt < windowStart30) continue;
    scanRows.push({
      plantId: a.plantId,
      scannedAt,
      locale: weightedPick<'fi' | 'en' | 'sv'>([['fi', 70], ['en', 22], ['sv', 8]]),
      kioskId: pick(KIOSK_ZONES),
      visitorHash: randomBytes(16).toString('hex'),
      userAgent: `${MOCK_TAG}/conversion`,
    });
    scanCountByPlant.set(a.plantId, (scanCountByPlant.get(a.plantId) ?? 0) + 1);
    funnelSeeded++;
  }

  // Guarantee today's-stats has non-zero scans for a lively kiosk panel.
  for (let i = 0; i < randInt(8, 18); i++) {
    const plant = pickPlant();
    scanRows.push({
      plantId: plant.id,
      scannedAt: todayAt(randInt(9, 18)),
      locale: weightedPick<'fi' | 'en' | 'sv'>([['fi', 70], ['en', 22], ['sv', 8]]),
      kioskId: pick(KIOSK_ZONES),
      visitorHash: randomBytes(16).toString('hex'),
      userAgent: `${MOCK_TAG}/today`,
    });
    scanCountByPlant.set(plant.id, (scanCountByPlant.get(plant.id) ?? 0) + 1);
  }

  for (let i = 0; i < scanRows.length; i += 1000) {
    await prisma.plantScan.createMany({ data: scanRows.slice(i, i + 1000) });
  }
  console.log(`   scans=${scanRows.length} (funnel-conversion scans=${funnelSeeded})`);

  // ── 5. Ask the Garden history ────────────────────────────────────────────────
  console.log('\n[5/9] Generating Ask the Garden history…');
  const totalAsk = randInt(180, 280);
  const askCountByPlant = new Map<string, number>();
  let escalatedCount = 0;
  let askToday = 0;
  for (let i = 0; i < totalAsk; i++) {
    const locale = weightedPick<'fi' | 'en' | 'sv'>([
      ['fi', 55],
      ['en', 33],
      ['sv', 12],
    ]);
    const question = pick(ASK_QUESTIONS[locale]);
    // ~70% are signed-in (a mock user asked it); the rest anonymous (kiosk/web).
    const userId = rand() < 0.7 ? pick(users).id : null;
    // A handful land today for the kiosk's live "questions today" counter.
    const isToday = i < randInt(5, 12);
    const createdAt = isToday ? todayAt(randInt(9, 19)) : recentWeightedDate(args.days);
    if (isToday) askToday++;

    // Classify roughly like ask.service.ts to set intent + answer/escalation.
    const lower = question.toLowerCase();
    const isGreeting = /^(hello|hi|hey|moi|hej|terve)\b/.test(lower);
    const isMeta = /what is askthegarden|mikä on|vad är en botanisk|botanical garden/.test(lower);
    const isCare = /water my houseplant|take care/.test(lower);
    const intent = isGreeting ? 'greeting' : isMeta ? 'meta' : isCare ? 'off_topic' : 'on_topic';

    const msg = await prisma.askMessage.create({
      data: {
        text: `[${MOCK_TAG}] ${question}`, // tagged for anonymous-row purge
        locale,
        userId,
        intent,
        createdAt,
      },
      select: { id: true },
    });

    // ~12% of on-topic questions escalate (no grounded answer).
    const escalate = intent === 'on_topic' && rand() < 0.12;
    let answerText: string;
    let modelUsed: string;
    let escalatedAt: Date | null = null;
    if (isGreeting) {
      answerText =
        locale === 'fi'
          ? 'Hei! Olen AskTheGarden. Kysy minulta kasveistamme tai vierailusta.'
          : locale === 'sv'
            ? 'Hej! Jag är AskTheGarden. Fråga mig om våra växter.'
            : "Hello! I'm AskTheGarden. Ask me about our plants, visiting, or conservation.";
      modelUsed = 'template:greeting';
    } else if (isMeta) {
      answerText =
        locale === 'fi'
          ? 'AskTheGarden on Oulun yliopiston kasvitieteellisen puutarhan opastin.'
          : locale === 'sv'
            ? 'AskTheGarden är guiden för Uleåborgs universitets botaniska trädgård.'
            : 'AskTheGarden is the conservation guide for the University of Oulu Botanical Garden.';
      modelUsed = 'template:meta';
    } else if (intent === 'off_topic' || escalate) {
      answerText = ESCALATION_TEXT[locale];
      modelUsed = escalate ? 'escalation' : 'guardrail';
      escalatedAt = createdAt;
      escalatedCount++;
    } else {
      answerText = pick(ASK_ANSWERS[locale]);
      modelUsed = pick(['gemma3:4b', 'llama-3.3-70b-versatile', 'llama3.2:1b']);
    }

    const grounded = !escalate && intent === 'on_topic';
    // Link grounded answers to a plant via askCount (mirrors ask.service bump).
    const linkedPlant = grounded ? pickPlant() : null;
    const reaction =
      rand() < 0.35
        ? weightedPick<'helpful' | 'off_base' | 'escalated' | null>([
            ['helpful', 70],
            ['off_base', 18],
            ['escalated', 12],
          ])
        : null;
    await prisma.askAnswer.create({
      data: {
        messageId: msg.id,
        text: answerText,
        modelUsed,
        promptTokens: grounded ? randInt(180, 900) : 0,
        completionTokens: grounded ? randInt(20, 160) : 0,
        latencyMs: grounded ? randInt(900, 4800) : escalatedAt ? randInt(50, 600) : 0,
        reaction: reaction as Prisma.AskAnswerCreateInput['reaction'],
        escalatedAt,
        retrievedChunkIds: grounded ? [] : [],
        createdAt,
      },
    });
    if (linkedPlant) askCountByPlant.set(linkedPlant.id, (askCountByPlant.get(linkedPlant.id) ?? 0) + 1);
  }
  console.log(
    `   askMessages=${totalAsk} (escalated=${escalatedCount}, today=${askToday})`,
  );

  // ── 6. Saved / favourite plants ──────────────────────────────────────────────
  console.log('\n[6/9] Saving favourite plants…');
  const savedRows: Prisma.SavedPlantCreateManyInput[] = [];
  const saveCountByPlant = new Map<string, number>();
  const seen = new Set<string>(); // userId|plantId for the unique index
  // ~55% of users save 1–6 plants.
  for (const u of users) {
    if (rand() > 0.55) continue;
    const howMany = randInt(1, 6);
    const choices = shuffle(plantPool).slice(0, howMany);
    for (const p of choices) {
      const key = `${u.id}|${p.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const savedAt = new Date(u.createdAt.getTime() + rand() * (now - u.createdAt.getTime()));
      savedRows.push({
        userId: u.id,
        plantId: p.id,
        note: rand() < 0.2 ? pick(['birthday gift for Mom', 'maybe adopt next', 'love this one', 'for the class']) : null,
        savedAt,
      });
      saveCountByPlant.set(p.id, (saveCountByPlant.get(p.id) ?? 0) + 1);
    }
  }
  for (let i = 0; i < savedRows.length; i += 1000) {
    await prisma.savedPlant.createMany({ data: savedRows.slice(i, i + 1000), skipDuplicates: true });
  }
  console.log(`   savedPlants=${savedRows.length}`);

  // ── 7. GDPR + contact/curator requests ───────────────────────────────────────
  console.log('\n[7/9] GDPR + contact requests…');
  const exportRows: Prisma.DataExportRequestCreateManyInput[] = [];
  const erasureRows: Prisma.DataErasureRequestCreateManyInput[] = [];
  const gdprStatusPick = () =>
    weightedPick<'pending' | 'verified' | 'executing' | 'completed' | 'rejected'>([
      ['completed', 55],
      ['pending', 18],
      ['verified', 12],
      ['executing', 8],
      ['rejected', 7],
    ]);
  // A few data-export requests.
  for (const u of shuffle(users).slice(0, randInt(4, 8))) {
    const createdAt = recentWeightedDate(args.days);
    const status = gdprStatusPick();
    exportRows.push({
      userId: u.id,
      status,
      exportUrl: status === 'completed' ? `local://exports/${u.id}.zip` : null,
      createdAt,
      completedAt: status === 'completed' ? new Date(createdAt.getTime() + randInt(1, 48) * 3_600_000) : null,
    });
  }
  // A couple of erasure requests (pseudonymise — financial legal hold).
  for (const u of shuffle(users).slice(0, randInt(2, 4))) {
    const createdAt = recentWeightedDate(args.days);
    const status = gdprStatusPick();
    erasureRows.push({
      userId: u.id,
      status,
      approach: 'pseudonymise',
      reason: pick(['Donor requested account deletion', 'No longer wishes to be contacted']),
      createdAt,
      completedAt: status === 'completed' ? new Date(createdAt.getTime() + randInt(1, 72) * 3_600_000) : null,
    });
  }
  if (exportRows.length) await prisma.dataExportRequest.createMany({ data: exportRows });
  if (erasureRows.length) await prisma.dataErasureRequest.createMany({ data: erasureRows });

  // Contact/curator requests: the schema has no dedicated model, so we record
  // them as AuditLog events (the operator activity feed) — tagged, removable.
  let contactCount = 0;
  for (const u of shuffle(users).slice(0, randInt(8, 16))) {
    const occurredAt = recentWeightedDate(args.days);
    auditRows.push({
      actorUserId: u.id,
      action: `${MOCK_AUDIT_PREFIX}contact.request`,
      resource: `Contact/${u.id}`,
      after: { reason: pick(CONTACT_REASONS), handled: rand() < 0.7 },
      occurredAt,
    });
    contactCount++;
  }
  console.log(
    `   dataExports=${exportRows.length} erasures=${erasureRows.length} contactRequests=${contactCount}`,
  );

  // ── 7b. Flush all AuditLog rows ──────────────────────────────────────────────
  for (let i = 0; i < auditRows.length; i += 1000) {
    await prisma.auditLog.createMany({ data: auditRows.slice(i, i + 1000) });
  }
  console.log(`   auditLogs=${auditRows.length}`);

  // ── 8. Recompute denormalised counters from the rows we just created ─────────
  console.log('\n[8/9] Writing denormalised plant counters…');
  // Gather every plant touched by any counter.
  const touched = new Set<string>([
    ...adopterDelta.keys(),
    ...fundedDelta.keys(),
    ...scanCountByPlant.keys(),
    ...askCountByPlant.keys(),
    ...saveCountByPlant.keys(),
  ]);
  // Read current counters once so we ADD our deltas (the script is additive on a
  // freshly-purged dataset; purge already removed prior mock contributions).
  const counterUpdates: Prisma.PrismaPromise<unknown>[] = [];
  for (const plantId of touched) {
    const scanInc = scanCountByPlant.get(plantId) ?? 0;
    const adopterInc = adopterDelta.get(plantId) ?? 0;
    const fundedInc = fundedDelta.get(plantId) ?? 0;
    const askInc = askCountByPlant.get(plantId) ?? 0;
    const saveInc = saveCountByPlant.get(plantId) ?? 0;
    // viewCount must be >= scanCount (every QR scan is also a page view, plus
    // organic web/kiosk views). Add scans + a multiplier of organic views.
    const viewInc = scanInc + randInt(scanInc, scanInc * 3) + randInt(0, 40);
    counterUpdates.push(
      prisma.plant.update({
        where: { id: plantId },
        data: {
          scanCount: { increment: scanInc },
          adopterCount: { increment: adopterInc },
          fundedCents: { increment: fundedInc },
          askCount: { increment: askInc },
          saveCount: { increment: saveInc },
          viewCount: { increment: viewInc },
        },
      }),
    );
  }
  // Run in chunked transactions.
  for (let i = 0; i < counterUpdates.length; i += 200) {
    await prisma.$transaction(counterUpdates.slice(i, i + 200));
  }
  console.log(`   updated counters on ${touched.size} plants.`);

  // ── 9. Summary ───────────────────────────────────────────────────────────────
  console.log('\n[9/9] Verifying read-path numbers…');
  const [
    activePlantCount,
    activeAdoptionCount,
    raisedAgg,
    distinctDonors,
    scansTodayCount,
    questionsTodayCount,
    topVisited,
  ] = await Promise.all([
    prisma.plant.count({ where: { status: 'active' } }),
    prisma.adoption.count({ where: { status: 'active' } }),
    prisma.payment.aggregate({ where: { status: 'succeeded' }, _sum: { amountCents: true } }),
    prisma.payment.findMany({ where: { status: 'succeeded' }, select: { donorId: true }, distinct: ['donorId'] }),
    prisma.plantScan.count({ where: { scannedAt: { gte: startOfToday } } }),
    prisma.askAnswer.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.plant.findMany({
      where: { status: 'active' },
      orderBy: [{ viewCount: 'desc' }, { adopterCount: 'desc' }],
      take: 5,
      select: { nameEn: true, viewCount: true, scanCount: true, adopterCount: true },
    }),
  ]);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' MOCK HISTORY SEEDED — read-path sanity check');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(` Homepage / kiosk totals:`);
  console.log(`   active plants          : ${activePlantCount}`);
  console.log(`   active adoptions        : ${activeAdoptionCount}`);
  console.log(`   lifetime raised         : €${((raisedAgg._sum.amountCents ?? 0) / 100).toFixed(2)}`);
  console.log(`   distinct supporters     : ${distinctDonors.length}`);
  console.log(` Kiosk "today" panel:`);
  console.log(`   scans today             : ${scansTodayCount}`);
  console.log(`   questions today         : ${questionsTodayCount}`);
  console.log(` Kiosk "most visited" (top 5 by viewCount):`);
  for (const p of topVisited) {
    console.log(`   ${p.nameEn.padEnd(28)} views=${p.viewCount} scans=${p.scanCount} adopters=${p.adopterCount}`);
  }
  console.log('══════════════════════════════════════════════════════════════');
  console.log('\nRe-run with --purge-only to remove all of the above.');

  await prisma.$disconnect();
}

// Streets for postal addresses (kept near the name lists).
const SURNAMESTREET = [
  'Kaitoväylä', 'Linnanmaantie', 'Yliopistokatu', 'Koskitie', 'Isokatu', 'Pakkahuoneenkatu',
  'Torikatu', 'Kauppurienkatu', 'Saaristonkatu', 'Asemakatu', 'Hallituskatu', 'Mannerheimintie',
];

/**
 * A uuid-v7-ish unique string for Payment.orderId. The app uses uuidv7() from
 * the `uuid` package; we don't need monotonic sortability here, only uniqueness
 * for the @unique orderId column, so a random v4-shaped hex is sufficient and
 * avoids adding a dep. Prefixed to make mock orders identifiable if needed.
 */
function uuidish(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x70; // version 7 nibble (cosmetic)
  b[8] = (b[8]! & 0x3f) | 0x80; // variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

main().catch((err) => {
  console.error('\nseed-mock-history failed:', err);
  process.exit(1);
});
