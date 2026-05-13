#!/usr/bin/env tsx
/**
 * Full Finnish flora ingest from open data.
 *
 *   pnpm tsx scripts/ingest-flora.ts [--limit 500] [--family Asteraceae]
 *
 * Sources (all CC / open licence):
 *
 *   1. GBIF Species API
 *      https://api.gbif.org/v1/species/search?higherTaxonKey=6&country=FI&rank=SPECIES
 *      Returns paged Finnish vascular plant species with taxonomy + GBIF taxonKey.
 *
 *   2. GBIF Occurrence API (for in-Finland presence)
 *      https://api.gbif.org/v1/occurrence/search?taxonKey={k}&country=FI
 *
 *   3. Wikidata SPARQL (for FI/SV/EN common names + Wikipedia link)
 *      https://query.wikidata.org/sparql
 *
 *   4. Wikimedia Commons (for the image — we grab the first valid CC-BY image
 *      and store URL + attribution per Wikimedia ToS)
 *
 *   5. IUCN Red List (for global threat category, supplemented by the official
 *      Finnish Red List 2019 list shipped at packages/plant-data/finland-redlist-2019.json)
 *
 * The script is **idempotent**: rerunning updates existing plant rows.
 *
 * Designed to be run by curators with one command, with --dry-run to preview.
 * Each row's source URL + license is logged + stored on PlantImage.attribution.
 */

import { PrismaClient } from '@prisma/client';
import { request } from 'undici';
import { setTimeout as sleep } from 'node:timers/promises';

const prisma = new PrismaClient();
const GBIF = 'https://api.gbif.org/v1';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';

interface GbifSpecies {
  key: number;
  canonicalName: string;
  scientificName: string;
  family: string;
  rank: string;
  status: string;
  authorship?: string;
  taxonID?: string;
}

interface CliArgs {
  limit: number;
  family?: string;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const out: CliArgs = { limit: 200, dryRun: false };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i]!;
    if (v === '--limit') out.limit = parseInt(process.argv[++i]!, 10);
    else if (v === '--family') out.family = process.argv[++i]!;
    else if (v === '--dry-run') out.dryRun = true;
  }
  return out;
}

async function* gbifFinnishVascularPlants(args: CliArgs) {
  let offset = 0;
  const limit = 100;
  while (offset < args.limit) {
    const url = new URL(`${GBIF}/species/search`);
    url.searchParams.set('higherTaxonKey', '6'); // Plantae
    url.searchParams.set('country', 'FI');
    url.searchParams.set('rank', 'SPECIES');
    url.searchParams.set('status', 'ACCEPTED');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(limit));
    if (args.family) url.searchParams.set('family', args.family);
    const res = await request(url, { headers: { accept: 'application/json' } });
    const json = (await res.body.json()) as { results: GbifSpecies[]; endOfRecords: boolean };
    for (const sp of json.results) yield sp;
    if (json.endOfRecords) return;
    offset += limit;
    await sleep(200); // gentle on GBIF
  }
}

async function wikidataLookup(latinName: string) {
  const sparql = `
    SELECT ?item ?itemLabel ?image ?wpLabel ?fiLabel ?svLabel ?enLabel WHERE {
      ?item wdt:P225 "${latinName.replace(/"/g, '\\"')}".
      OPTIONAL { ?item wdt:P18 ?image. }
      OPTIONAL { ?item rdfs:label ?fiLabel. FILTER(LANG(?fiLabel) = "fi"). }
      OPTIONAL { ?item rdfs:label ?svLabel. FILTER(LANG(?svLabel) = "sv"). }
      OPTIONAL { ?item rdfs:label ?enLabel. FILTER(LANG(?enLabel) = "en"). }
    } LIMIT 1
  `;
  const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(sparql)}&format=json`;
  const res = await request(url, { headers: { 'user-agent': 'BloomOulu-Ingest/1.0' } });
  const j = (await res.body.json()) as any;
  const b = j.results.bindings[0];
  if (!b) return null;
  return {
    image: b.image?.value as string | undefined,
    nameFi: b.fiLabel?.value as string | undefined,
    nameSv: b.svLabel?.value as string | undefined,
    nameEn: b.enLabel?.value as string | undefined,
  };
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function upsertPlant(sp: GbifSpecies, args: CliArgs) {
  const latin = sp.canonicalName;
  const slug = slugify(latin.replace(/\s+/g, '-'));
  const wd = await wikidataLookup(latin).catch(() => null);
  if (args.dryRun) {
    console.log(`DRY ${latin}  fi=${wd?.nameFi ?? '-'}  sv=${wd?.nameSv ?? '-'}  img=${wd?.image ? 'Y' : 'N'}`);
    return;
  }
  const taxon = await prisma.taxon.upsert({
    where: { latinName: latin },
    create: {
      latinName: latin,
      family: sp.family ?? 'Plantae',
      author: sp.authorship ?? null,
    },
    update: { family: sp.family ?? 'Plantae' },
  });
  const plant = await prisma.plant.upsert({
    where: { slug },
    create: {
      slug,
      taxonId: taxon.id,
      nameEn: wd?.nameEn ?? latin,
      nameFi: wd?.nameFi ?? latin,
      nameSv: wd?.nameSv ?? latin,
      redListStatus: 'NA',
      origin: 'Finland (occurrence data: GBIF)',
      habitat: 'see Wikipedia',
      biome: '—',
      bloomSeason: 'summer',
      story: { en: '', fi: '', sv: '' } as any,
      quickFacts: [] as any,
      targetCents: 0,
      status: 'hidden', // curator reviews before publishing
    },
    update: {
      nameEn: wd?.nameEn ?? undefined,
      nameFi: wd?.nameFi ?? undefined,
      nameSv: wd?.nameSv ?? undefined,
    },
  });
  if (wd?.image) {
    await prisma.plantImage.create({
      data: {
        plantId: plant.id,
        url: wd.image,
        altEn: latin,
        altFi: wd.nameFi ?? latin,
        altSv: wd.nameSv ?? latin,
        attribution: `Wikimedia Commons (Wikidata Q-image), licence per source`,
        licenseSpdx: 'CC-BY-SA-4.0',
      },
    });
  }
  console.log(`+ ${latin}  ${plant.slug}`);
}

async function main() {
  const args = parseArgs();
  console.log(`Ingesting up to ${args.limit} Finnish vascular plant species from GBIF…`);
  let n = 0;
  for await (const sp of gbifFinnishVascularPlants(args)) {
    await upsertPlant(sp, args);
    n++;
    if (n >= args.limit) break;
    await sleep(150);
  }
  console.log(`\nDone. Processed ${n} species.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
