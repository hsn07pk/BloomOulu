/**
 * Second-pass enrichment for the legacy-Garden import.
 *
 * Adds onto every previously-imported Plant:
 *   - origin       ← maailman_levinneisyysalue (joined, comma-sep)
 *   - habitat      ← alkuperainen_kasvupaikka (joined)
 *   - redListStatus← taksonin_viljelytiedot.uhanalaisuusluokka_suomessa
 *   - story        ← muita_viljelytietoja (curator-grade text)
 *   - quickFacts   ← extended with kasvumuoto + korkeus + accession count
 *   - status       ← 'active' so the public catalogue surfaces them
 *
 * Idempotent. Re-running re-derives every value from the source TSVs and
 * overwrites the Plant row. A curator who has hand-edited a description
 * in /admin should make their edits in the legacy MySQL or in our
 * Plant table directly — re-running this script with --skip-existing
 * leaves rows with hand-edits in place.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, RedListStatus, BloomSeason } from '@prisma/client';

const IMPORT_DIR = process.env.IMPORT_DIR ?? '/tmp/bloom-import/json';
const SKIP_EXISTING = process.argv.includes('--skip-existing');

const prisma = new PrismaClient();

// Finnish red-list class strings → ADR-0002 RedListStatus enum.
const REDLIST_MAP: Record<string, RedListStatus> = {
  'Erittäin uhanalainen': RedListStatus.CR,
  Uhanalainen: RedListStatus.EN,
  Vaarantunut: RedListStatus.VU,
  'Silmälläpidettävä, taantunut': RedListStatus.NT,
  'Silmälläpidettävä, harvinainen': RedListStatus.NT,
  'Silmälläpidettävä, puutteellisesti tunnettu': RedListStatus.NT,
  Hävinnyt: RedListStatus.EX,
  'K Insufficiently known': RedListStatus.DD,
  'I Interminate': RedListStatus.DD,
  'Erityisesti suojeltava laji': RedListStatus.EN,
  'Muuttunut arviointi': RedListStatus.DD,
};

interface DistRow {
  taksonin_nro: number;
  levinneisyysalue: string;
  levinneisyysalueen_tarkenne: string | null;
  alkuperainen_vai_tulokas: string | null;
}
interface HabRow {
  taksonin_nro: number;
  alkuperainen_kasvupaikka: string;
  kasvupaikan_tarkenne: string | null;
}
interface ViljelyRow {
  taksonin_nro: number;
  uhanalaisuusluokka_suomessa: string | null;
  uhanalaisuusluokka_maailmalla: string | null;
  rauhoitus: string | null;
  muita_viljelytietoja: string | null;
  kasvumuoto: string | null;
  korkeus: string | null;
}

function readTsv<T>(filename: string, columns: string[]): T[] {
  const raw = readFileSync(join(IMPORT_DIR, filename), 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const out: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i]!.split('\t');
    const obj: Record<string, unknown> = {};
    columns.forEach((col, idx) => {
      const v = fields[idx] ?? '';
      obj[col] = v === 'NULL' ? null : v;
    });
    out.push(obj as T);
  }
  return out;
}

/** Title-case + dehyphenate Finnish all-caps strings ("ITÄINEN POHJOIS-AMERIKKA" → "Itäinen Pohjois-Amerikka"). */
function tidy(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
    .trim();
}

async function main() {
  console.log(`Enriching plants from ${IMPORT_DIR} (skip-existing=${SKIP_EXISTING})`);

  const dist = readTsv<DistRow>('world_distribution.tsv', [
    'taksonin_nro',
    'levinneisyysalue',
    'levinneisyysalueen_tarkenne',
    'alkuperainen_vai_tulokas',
  ]);
  const hab = readTsv<HabRow>('habitat.tsv', [
    'taksonin_nro',
    'alkuperainen_kasvupaikka',
    'kasvupaikan_tarkenne',
  ]);
  const viljely = readTsv<ViljelyRow>('viljelytiedot.tsv', [
    'taksonin_nro',
    'uhanalaisuusluokka_suomessa',
    'uhanalaisuusluokka_maailmalla',
    'rauhoitus',
    'muita_viljelytietoja',
    'kasvumuoto',
    'korkeus',
  ]);

  // ── Aggregations by taksonin_nro ───────────────────────────────────
  const originByTaxon = new Map<number, string[]>();
  for (const d of dist) {
    const k = Number(d.taksonin_nro);
    const arr = originByTaxon.get(k) ?? [];
    arr.push(tidy(d.levinneisyysalue));
    originByTaxon.set(k, arr);
  }
  const habitatByTaxon = new Map<number, string[]>();
  for (const h of hab) {
    const k = Number(h.taksonin_nro);
    const arr = habitatByTaxon.get(k) ?? [];
    arr.push(tidy(h.alkuperainen_kasvupaikka));
    habitatByTaxon.set(k, arr);
  }
  const viljelyByTaxon = new Map<number, ViljelyRow>();
  for (const v of viljely) viljelyByTaxon.set(Number(v.taksonin_nro), v);

  // ── Walk every imported Plant. The legacy taksonin_nro isn't stored
  //    on Plant directly — we re-derive via Plant.slug = slug(Taxon.latinName)
  //    and look up the legacy taksonin_nro from the taksoni TSV. ────────
  const taksoni = readTsv<{ taksonin_nro: number; tieteellinen_nimi: string }>(
    'taksoni.tsv',
    ['taksonin_nro', 'tieteellinen_nimi'],
  );
  const slugOf = (latin: string) =>
    latin
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  const BINOMIAL = /^([A-Z][a-z]+)\s+([a-z][a-z-]+)/;
  const legacyByTaxonId = new Map<number, { slug: string; latinName: string }>();
  for (const t of taksoni) {
    const m = t.tieteellinen_nimi?.match(BINOMIAL);
    if (!m) continue;
    const latin = `${m[1]} ${m[2]}`;
    legacyByTaxonId.set(Number(t.taksonin_nro), { slug: slugOf(latin), latinName: latin });
  }
  console.log(`  ${legacyByTaxonId.size} taxa with stable slugs`);

  let enriched = 0;
  let activated = 0;
  let redListed = 0;
  for (const [taxonId, info] of legacyByTaxonId.entries()) {
    const plant = await prisma.plant.findUnique({ where: { slug: info.slug }, select: { id: true, status: true, story: true } });
    if (!plant) continue;
    // If the curator already published this row and we're in conservative
    // mode, skip — never clobber hand-edits.
    if (SKIP_EXISTING && plant.status === 'active') continue;

    const originList = (originByTaxon.get(taxonId) ?? []).slice(0, 5);
    const habList = (habitatByTaxon.get(taxonId) ?? []).slice(0, 3);
    const v = viljelyByTaxon.get(taxonId);
    const redListLabel = v?.uhanalaisuusluokka_suomessa?.trim() ?? '';
    const newRedList = REDLIST_MAP[redListLabel] ?? RedListStatus.LC;
    if (newRedList !== RedListStatus.LC) redListed++;

    const longText = v?.muita_viljelytietoja?.trim() ?? '';
    const story = longText
      ? {
          en: longText,
          fi: longText,
          sv: longText,
        }
      : (plant.story as Record<string, string> | null) ?? {
          en: 'Curator description pending.',
          fi: 'Kuvaus tulossa.',
          sv: 'Beskrivning kommer.',
        };

    const accessionCount = await prisma.accession.count({ where: { plantId: plant.id } });

    // Only overwrite each field when we actually have source data for
    // it. Otherwise leave whatever's already on the Plant row (seed
    // copy, or the previous ingest's "Imported from Garden DB 2020"
    // placeholder, or a curator's hand-edit).
    const update: Record<string, unknown> = {
      status: 'active',
      quickFacts: [
        ['family', '(see taxon)'],
        ['accessions', String(accessionCount)],
        ...(v?.kasvumuoto ? ([['growthForm', tidy(v.kasvumuoto)]] as Array<[string, string]>) : []),
        ...(v?.korkeus ? ([['height', v.korkeus.trim()]] as Array<[string, string]>) : []),
        ...(redListLabel ? ([['redListLabel', redListLabel]] as Array<[string, string]>) : []),
      ],
    };
    if (originList.length > 0) {
      update.origin = originList.join(' · ');
    }
    if (habList.length > 0) {
      update.habitat = habList.join(' · ');
      update.biome = habList[0];
    }
    if (newRedList !== RedListStatus.LC) {
      update.redListStatus = newRedList;
    }
    if (longText) {
      update.story = story as never;
    }
    await prisma.plant.update({ where: { id: plant.id }, data: update });
    enriched++;
    if (plant.status !== 'active') activated++;
  }

  await prisma.auditLog.create({
    data: {
      action: 'ingest.legacy-garden.enrich',
      resource: 'Import/puutarhakanta2005',
      after: {
        enriched,
        activated,
        redListed,
        skipExisting: SKIP_EXISTING,
      },
    },
  });

  console.log('Enrichment done:');
  console.log(`  Plants enriched:        ${enriched}`);
  console.log(`  Plants activated:       ${activated}`);
  console.log(`  Plants with red-list:   ${redListed}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
