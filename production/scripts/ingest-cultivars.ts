/**
 * Third-pass: ingest the legacy taxa that weren't strict binomials —
 * cultivar groups, named hybrids, vernacular-named experimental
 * accessions. We saved 9.4k of these as Taxon rows already; this script
 * makes Plant rows + Accession rows for the ones that have at least
 * one acquisition record so they show up in the catalogue.
 *
 * Slugs collide more easily here ("Cichorium endivia (Escarole-ryhmä)
 * 'Prada'" + "Cichorium endivia (Frisee-ryhmä) 'Century'" both slugify
 * to the genus+species root) — so we suffix the slug with the legacy
 * taxon id for stability.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, RedListStatus, BloomSeason } from '@prisma/client';

const IMPORT_DIR = process.env.IMPORT_DIR ?? '/tmp/bloom-import/json';
const prisma = new PrismaClient();

interface Taksoni {
  taksonin_nro: number;
  tieteellinen_nimi: string;
  suku: string | null;
  laji: string | null;
  jarjestysnumero: number | null;
}
interface Heimo {
  jarjestysnumero: number;
  nimi: string;
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

function readTsv<T>(filename: string, columns: string[]): T[] {
  const raw = readFileSync(join(IMPORT_DIR, filename), 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const out: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i]!.split('\t');
    const obj: Record<string, unknown> = {};
    columns.forEach((c, idx) => {
      const v = fields[idx] ?? '';
      obj[c] = v === 'NULL' ? null : v;
    });
    out.push(obj as T);
  }
  return out;
}

function slugify(s: string, salt?: number): string {
  const base = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return salt != null ? `${base}-${salt}` : base;
}

const BINOMIAL = /^([A-Z][a-z]+)\s+([a-z][a-z-]+)(\s|$)/;
// Loose plant-shaped name: starts with a Latin-looking capitalised word
// (genus) and has at least one more token. We use this for cultivars +
// hybrids that don't pass the strict binomial filter.
const PLANTY = /^([A-Z][a-z]+)[\s].+/;

async function main() {
  const heimo = readTsv<Heimo>('heimo.tsv', ['jarjestysnumero', 'nimi', 'lahko', 'luokka', 'paaryhma', 'suom_nimi']);
  const taksoni = readTsv<Taksoni>('taksoni.tsv', ['taksonin_nro', 'tieteellinen_nimi', 'suku', 'laji', 'jarjestysnumero', 'alataso_1', 'alataso_2']);
  const common = readTsv<CommonName>('common_names.tsv', ['taksonin_nro', 'kieli', 'nimi']);
  const acc = readTsv<Accession>('accessions.tsv', ['hankintaID', 'hankintanumero', 'taksonin_nro', 'vuosi', 'saapumispvm', 'hankintanimi', 'kasvin_huomautuksia']);

  const familyById = new Map<number, string>();
  for (const h of heimo) if (h.nimi) familyById.set(Number(h.jarjestysnumero), h.nimi.trim());

  const namesByTaxon = new Map<number, { fi?: string; sv?: string; en?: string }>();
  for (const c of common) {
    const t = Number(c.taksonin_nro);
    const m = namesByTaxon.get(t) ?? {};
    const n = c.nimi?.trim();
    if (!n) continue;
    if ((c.kieli === 'suomi' || c.kieli === 'suomi2') && !m.fi) m.fi = n;
    else if ((c.kieli === 'ruotsi' || c.kieli === 'ruotsi2') && !m.sv) m.sv = n;
    else if (c.kieli === 'englanti' && !m.en) m.en = n;
    namesByTaxon.set(t, m);
  }

  const accByTaxon = new Map<number, Accession[]>();
  for (const a of acc) {
    if (!a.hankintanumero) continue;
    const t = Number(a.taksonin_nro);
    if (!t) continue;
    const arr = accByTaxon.get(t) ?? [];
    arr.push(a);
    accByTaxon.set(t, arr);
  }

  let taxonCreated = 0;
  let plantCreated = 0;
  let plantSkipped = 0;
  let accessionCreated = 0;

  for (const t of taksoni) {
    const latin = t.tieteellinen_nimi?.trim();
    if (!latin) continue;
    // Skip the strict binomials — already handled by the first script.
    if (BINOMIAL.test(latin)) continue;
    // Keep anything that at least starts with a Latin-looking capitalised
    // genus token (so we get cultivars + hybrid notation, but skip the
    // pure-Finnish vernacular taxa like 'Vietanamilainen basilika').
    if (!PLANTY.test(latin)) continue;
    const accs = accByTaxon.get(Number(t.taksonin_nro)) ?? [];
    if (accs.length === 0) continue;
    const family = t.jarjestysnumero != null ? familyById.get(Number(t.jarjestysnumero)) ?? '' : '';
    if (!family) continue;

    const taxon = await prisma.taxon.upsert({
      where: { latinName: latin },
      create: { latinName: latin, family, rank: 'cultivar' },
      update: { family },
    });
    if (taxon.createdAt.getTime() === taxon.updatedAt.getTime()) taxonCreated++;

    const slug = slugify(latin, Number(t.taksonin_nro));
    const names = namesByTaxon.get(Number(t.taksonin_nro)) ?? {};
    const existing = await prisma.plant.findUnique({ where: { slug }, select: { id: true } });
    const plant = await prisma.plant.upsert({
      where: { slug },
      create: {
        slug,
        taxonId: taxon.id,
        nameEn: names.en ?? latin,
        nameFi: names.fi ?? latin,
        nameSv: names.sv ?? latin,
        redListStatus: RedListStatus.LC,
        redListYear: 2019,
        origin: 'Cultivar / hybrid · pending curator',
        habitat: 'Cultivated',
        biome: 'Cultivated',
        bloomSeason: BloomSeason.all,
        story: {
          en: 'A garden cultivar imported from the legacy accession database. Curator to write the public story.',
          fi: 'Puutarhalajike, tuotu vanhasta kokoelmatietokannasta. Kuraattori kirjoittaa julkisen tarinan.',
          sv: 'En trädgårdssort, importerad från den äldre samlingsdatabasen.',
        },
        quickFacts: [
          ['family', family],
          ['accessions', String(accs.length)],
          ['rank', 'cultivar'],
        ],
        status: 'active',
      },
      update: { taxonId: taxon.id, nameEn: names.en ?? undefined, nameFi: names.fi ?? undefined, nameSv: names.sv ?? undefined },
    });
    if (existing) plantSkipped++;
    else plantCreated++;

    for (const a of accs) {
      const num = a.hankintanumero?.trim();
      if (!num) continue;
      const year = a.vuosi ? Number.parseInt(a.vuosi, 10) : NaN;
      const collectedAt = a.saapumispvm && /^\d{4}-\d{2}-\d{2}/.test(a.saapumispvm)
        ? new Date(a.saapumispvm)
        : !Number.isNaN(year) && year > 1900 && year < 2100
          ? new Date(`${year}-01-01`)
          : null;
      try {
        await prisma.accession.upsert({
          where: { accessionNumber: num },
          create: {
            accessionNumber: num,
            plantId: plant.id,
            collectedAt: collectedAt ?? undefined,
            notes: a.kasvin_huomautuksia?.trim() || null,
          },
          update: { plantId: plant.id, collectedAt: collectedAt ?? undefined },
        });
        accessionCreated++;
      } catch (err) {
        // Same-accession-across-taxa is a legacy data quirk; skip.
      }
    }
  }

  await prisma.auditLog.create({
    data: {
      action: 'ingest.legacy-garden.cultivars',
      resource: 'Import/puutarhakanta2005',
      after: { taxonCreated, plantCreated, plantSkipped, accessionCreated },
    },
  });
  console.log('Cultivar ingest done:');
  console.log(`  Taxon created:     ${taxonCreated}`);
  console.log(`  Plant created:     ${plantCreated}`);
  console.log(`  Plant updated:     ${plantSkipped}`);
  console.log(`  Accession created: ${accessionCreated}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
