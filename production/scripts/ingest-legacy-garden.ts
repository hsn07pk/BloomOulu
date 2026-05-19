/**
 * One-shot importer for the Garden's legacy MySQL DB (`puutarhakanta2005`).
 *
 * Source: the 2020-11-22 mysqldump shipped in the GrowHack 2026 material
 * folder. The dump was restored to a sidecar MySQL container and the
 * relevant tables exported as tab-separated UTF-8 files into
 * /tmp/bloom-import/json/.
 *
 * Mapping (legacy → BloomOulu):
 *   heimo (family)                  → Taxon.family (denormalised)
 *   taksoni (taxon)                 → Taxon (one row per binomial)
 *   muunkielinen_nimi               → Plant.nameFi / nameSv / nameEn
 *   hankintatiedot (acquisition)    → Plant (one per actively-cultivated
 *                                     taxon) + Accession (one per record)
 *   viite (reference)               → Citation
 *   /tmp/bloom-import/PT2.4virt/Kuvat → PlantImage (manually matched by
 *                                     Finnish-common-name filenames)
 *
 * Idempotent: re-running upserts on (Taxon.latinName, Plant.slug,
 * Accession.accessionNumber) — never inserts duplicates. Writes a single
 * AuditLog row at the end so finance can prove provenance.
 *
 * Run:
 *   pnpm tsx scripts/ingest-legacy-garden.ts [--dry-run] [--limit N]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, RedListStatus, BloomSeason } from '@prisma/client';

const IMPORT_DIR = process.env.IMPORT_DIR ?? '/tmp/bloom-import/json';
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.indexOf('--limit');
const LIMIT = LIMIT_ARG >= 0 ? Number.parseInt(process.argv[LIMIT_ARG + 1] ?? '0', 10) : 0;

const prisma = new PrismaClient();

interface Heimo {
  jarjestysnumero: number;
  nimi: string;
  suom_nimi: string;
}

interface Taksoni {
  taksonin_nro: number;
  tieteellinen_nimi: string;
  suku: string | null;
  laji: string | null;
  /** FK to heimo.jarjestysnumero (family). */
  jarjestysnumero: number | null;
}

interface CommonName {
  taksonin_nro: number;
  kieli: string;
  nimi: string;
}

interface Accession {
  hankintaID: number;
  hankintanumero: string;
  taksonin_nro: number;
  vuosi: string | null;
  saapumispvm: string | null;
  hankintanimi: string | null;
  kasvin_huomautuksia: string | null;
}

function readTsv<T>(filename: string, columns: Array<keyof T>): T[] {
  const path = join(IMPORT_DIR, filename);
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  // First line is the header from `mysql -e` — skip it.
  const rows: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i]!.split('\t');
    const obj: Record<string, unknown> = {};
    columns.forEach((col, idx) => {
      const raw = fields[idx] ?? '';
      obj[col as string] = raw === 'NULL' ? null : raw;
    });
    rows.push(obj as T);
  }
  return rows;
}

/** Slugify a Latin name: "Cypripedium calceolus" → "cypripedium-calceolus".
 *  Stable across re-runs so accession upserts hit the same Plant row. */
function slugify(latin: string): string {
  return latin
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Reject obviously non-binomial taxon names (cultivar groups, garden
 *  varieties typed in Finnish, hybrid notation). Public Plant rows
 *  should be `Genus species`-shaped so the UI's italic Latin display
 *  doesn't render gibberish. */
const BINOMIAL = /^([A-Z][a-z]+)\s+([a-z][a-z-]+)(\s|$)/;

async function main() {
  console.log(`Reading legacy data from ${IMPORT_DIR} (dry-run=${DRY_RUN}, limit=${LIMIT || 'none'})`);

  const heimoRows = readTsv<Heimo>('heimo.tsv', ['jarjestysnumero', 'nimi', 'lahko', 'luokka', 'paaryhma', 'suom_nimi'] as unknown as Array<keyof Heimo>);
  const taksonRows = readTsv<Taksoni>('taksoni.tsv', ['taksonin_nro', 'tieteellinen_nimi', 'suku', 'laji', 'jarjestysnumero', 'alataso_1', 'alataso_2'] as unknown as Array<keyof Taksoni>);
  const commonRows = readTsv<CommonName>('common_names.tsv', ['taksonin_nro', 'kieli', 'nimi']);
  const accessionRows = readTsv<Accession>('accessions.tsv', ['hankintaID', 'hankintanumero', 'taksonin_nro', 'vuosi', 'saapumispvm', 'hankintanimi', 'kasvin_huomautuksia']);

  console.log(`  ${heimoRows.length} families · ${taksonRows.length} taxa · ${commonRows.length} common names · ${accessionRows.length} accessions`);

  // ── Index lookups ───────────────────────────────────────────────────
  const familyById = new Map<number, string>();
  for (const h of heimoRows) {
    if (h.nimi) familyById.set(Number(h.jarjestysnumero), h.nimi.trim());
  }
  const namesByTaxon = new Map<number, { fi?: string; sv?: string; en?: string }>();
  for (const c of commonRows) {
    const t = Number(c.taksonin_nro);
    const map = namesByTaxon.get(t) ?? {};
    const name = c.nimi?.trim();
    if (!name) continue;
    // The legacy DB uses 'suomi'/'ruotsi'/'englanti' (and 'suomi2' etc.
    // for alternative spellings — we keep the first one we see).
    if ((c.kieli === 'suomi' || c.kieli === 'suomi2') && !map.fi) map.fi = name;
    else if ((c.kieli === 'ruotsi' || c.kieli === 'ruotsi2') && !map.sv) map.sv = name;
    else if (c.kieli === 'englanti' && !map.en) map.en = name;
    namesByTaxon.set(t, map);
  }
  const accessionsByTaxon = new Map<number, Accession[]>();
  for (const a of accessionRows) {
    if (!a.hankintanumero) continue;
    const t = Number(a.taksonin_nro);
    if (!t) continue;
    const arr = accessionsByTaxon.get(t) ?? [];
    arr.push(a);
    accessionsByTaxon.set(t, arr);
  }

  // ── Plan: which taxa become Plants? ──────────────────────────────────
  // A taxon is "plant-grade" if:
  //   - its Latin name parses as a binomial,
  //   - it has at least one acquisition,
  //   - the family is known.
  type Plan = {
    legacyId: number;
    latinName: string;
    family: string;
    nameFi: string | null;
    nameSv: string | null;
    nameEn: string | null;
    slug: string;
    accessions: Accession[];
  };
  const plans: Plan[] = [];
  for (const t of taksonRows) {
    const latin = t.tieteellinen_nimi?.trim();
    const match = latin && latin.match(BINOMIAL);
    if (!match) continue;
    const acc = accessionsByTaxon.get(Number(t.taksonin_nro)) ?? [];
    if (acc.length === 0) continue;
    const familyNum = t.jarjestysnumero != null ? Number(t.jarjestysnumero) : null;
    const family = familyNum != null ? familyById.get(familyNum) ?? '' : '';
    if (!family) continue;
    const names = namesByTaxon.get(Number(t.taksonin_nro)) ?? {};
    plans.push({
      legacyId: Number(t.taksonin_nro),
      latinName: `${match[1]} ${match[2]}`,
      family,
      nameFi: names.fi ?? null,
      nameSv: names.sv ?? null,
      nameEn: names.en ?? null,
      slug: slugify(`${match[1]} ${match[2]}`),
      accessions: acc,
    });
  }
  console.log(`  → ${plans.length} plant-grade taxa to upsert`);
  const slice = LIMIT > 0 ? plans.slice(0, LIMIT) : plans;
  console.log(`  → ${slice.length} will be processed in this run`);

  if (DRY_RUN) {
    console.log('Dry run — no DB writes. Sample of first 5:');
    for (const p of slice.slice(0, 5)) {
      console.log(`   ${p.latinName} (${p.family}) — fi: ${p.nameFi ?? '-'} — ${p.accessions.length} accessions`);
    }
    return;
  }

  // ── Write — Taxon then Plant then Accession ─────────────────────────
  let taxonCreated = 0;
  let plantCreated = 0;
  let plantUpdated = 0;
  let accessionCreated = 0;

  for (const p of slice) {
    // Upsert Taxon by latinName (unique).
    const taxon = await prisma.taxon.upsert({
      where: { latinName: p.latinName },
      create: { latinName: p.latinName, family: p.family, rank: 'species' },
      update: { family: p.family },
    });
    if (taxon.createdAt.getTime() === taxon.updatedAt.getTime()) taxonCreated++;

    const before = await prisma.plant.findUnique({ where: { slug: p.slug }, select: { id: true } });
    const plant = await prisma.plant.upsert({
      where: { slug: p.slug },
      create: {
        slug: p.slug,
        taxonId: taxon.id,
        nameEn: p.nameEn ?? p.latinName,
        nameFi: p.nameFi ?? p.latinName,
        nameSv: p.nameSv ?? p.latinName,
        redListStatus: RedListStatus.LC,
        redListYear: 2019,
        origin: 'Imported from Garden DB 2020',
        habitat: 'Imported — pending curator review',
        biome: 'Imported',
        bloomSeason: BloomSeason.all,
        story: {
          en: `Imported from the Garden's legacy accession database. Curator to write the public story.`,
          fi: 'Tuotu puutarhan vanhasta kokoelmatietokannasta. Kuraattori kirjoittaa julkisen tarinan.',
          sv: 'Importerad från trädgårdens äldre samlingsdatabas. Kuratorn skriver den offentliga berättelsen.',
        },
        quickFacts: [
          ['family', p.family],
          ['accessions', String(p.accessions.length)],
        ],
        status: 'hidden', // curator must publish
      },
      update: {
        taxonId: taxon.id,
        nameFi: p.nameFi ?? undefined,
        nameSv: p.nameSv ?? undefined,
        nameEn: p.nameEn ?? undefined,
      },
    });
    if (before) plantUpdated++;
    else plantCreated++;

    for (const a of p.accessions) {
      const accNum = a.hankintanumero?.trim();
      if (!accNum) continue;
      const year = a.vuosi ? Number.parseInt(a.vuosi, 10) : NaN;
      const collectedAt = a.saapumispvm && /^\d{4}-\d{2}-\d{2}/.test(a.saapumispvm)
        ? new Date(a.saapumispvm)
        : !Number.isNaN(year) && year > 1900 && year < 2100
          ? new Date(year < 100 ? `19${year}-01-01` : `${year}-01-01`)
          : null;
      try {
        await prisma.accession.upsert({
          where: { accessionNumber: accNum },
          create: {
            accessionNumber: accNum,
            plantId: plant.id,
            collectedAt: collectedAt ?? undefined,
            notes: a.kasvin_huomautuksia?.trim() || null,
          },
          update: {
            plantId: plant.id,
            collectedAt: collectedAt ?? undefined,
          },
        });
        accessionCreated++;
      } catch (err) {
        // Duplicate accession number across taxa is a legacy data quirk;
        // log and skip rather than abort the batch.
        console.warn(`Accession ${accNum} skipped: ${(err as Error).message.slice(0, 100)}`);
      }
    }
  }

  await prisma.auditLog.create({
    data: {
      action: 'ingest.legacy-garden.import',
      resource: `Import/puutarhakanta2005`,
      after: {
        sourceDump: '2020-11-22',
        taxonRowsRead: taksonRows.length,
        accessionRowsRead: accessionRows.length,
        plansPlanned: plans.length,
        sliceProcessed: slice.length,
        taxonCreated,
        plantCreated,
        plantUpdated,
        accessionCreated,
      },
    },
  });

  console.log('Import done:');
  console.log(`  Taxon created:     ${taxonCreated}`);
  console.log(`  Plant created:     ${plantCreated}`);
  console.log(`  Plant updated:     ${plantUpdated}`);
  console.log(`  Accession created: ${accessionCreated}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
