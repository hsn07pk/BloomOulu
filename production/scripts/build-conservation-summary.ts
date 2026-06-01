/**
 * Conservation-status summary chunks.
 *
 * Per-plant chunks each carry one plant's Red List status, but a question
 * like "how many endangered species do you hold?" needs an aggregate.
 * This script generates a single RagDocument per IUCN status code with
 * the live count and a list of example species, so the hybrid retriever
 * surfaces it for count/aggregate queries against the conservation
 * vocabulary.
 *
 *   pnpm tsx scripts/build-conservation-summary.ts [--reset]
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { request } from 'undici';
import { chunkText } from '../packages/rag/src/chunk.js';

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'bge-m3';
const RESET = process.argv.includes('--reset');

const prisma = new PrismaClient();

const STATUS_INFO: Array<{ code: string; name: string; aliases: string[] }> = [
  { code: 'CR', name: 'Critically Endangered', aliases: ['critically endangered', 'extremely rare', 'on the brink of extinction'] },
  { code: 'EN', name: 'Endangered', aliases: ['endangered', 'rare', 'protected'] },
  { code: 'VU', name: 'Vulnerable', aliases: ['vulnerable', 'declining'] },
  { code: 'NT', name: 'Near Threatened', aliases: ['near threatened', 'almost vulnerable'] },
  { code: 'LC', name: 'Least Concern', aliases: ['least concern', 'common'] },
  { code: 'EX', name: 'Extinct', aliases: ['extinct', 'extinct in the wild', 'only in cultivation'] },
];

function sha256(s: string): string { return createHash('sha256').update(s).digest('hex'); }

async function embed(text: string): Promise<number[]> {
  const res = await request(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (res.statusCode >= 300) throw new Error(`Ollama embed ${res.statusCode}`);
  const json = (await res.body.json()) as { embedding: number[] };
  return json.embedding;
}

async function main() {
  console.log(`Building conservation-summary corpus (reset=${RESET})`);
  if (RESET) {
    const r = await prisma.ragDocument.deleteMany({
      where: { title: { startsWith: '__conservation__:' } },
    });
    console.log(`  Reset: ${r.count} conservation docs removed`);
  }

  // One overall conservation summary first.
  // Use $queryRawUnsafe so the camelCase column reference passes through
  // verbatim without Prisma's tag-template quoting mangling it.
  // `redListStatus` is a Postgres enum, so we can't compare to '' — just
  // exclude nulls.
  const totals = await prisma.$queryRawUnsafe<Array<{ status: string; n: bigint }>>(
    `SELECT "redListStatus"::text AS status, COUNT(*)::bigint AS n
     FROM "Plant"
     WHERE status = 'active' AND "redListStatus" IS NOT NULL
     GROUP BY "redListStatus" ORDER BY 2 DESC`,
  );
  const totalsMap = new Map(totals.map((r) => [(r.status ?? '').toUpperCase(), Number(r.n)]));

  const linesAll = ['# Conservation summary across the living collection'];
  linesAll.push(
    'The University of Oulu Botanical Garden tracks the IUCN / Finnish Red List status of every active accession. Below is the live count by status:',
  );
  let redListed = 0;
  for (const { code, name } of STATUS_INFO) {
    const n = totalsMap.get(code) ?? 0;
    if (n > 0) {
      linesAll.push(`- ${name} (${code}): ${n} species`);
      if (['CR', 'EN', 'VU'].includes(code)) redListed += n;
    }
  }
  linesAll.push(
    `In total, the collection holds ${redListed} red-listed species (CR + EN + VU) requiring active conservation. Common questions like "how many endangered species do you hold", "what is critically endangered", "show me vulnerable plants", or "which species are on the Red List" can be answered from this entry.`,
  );
  const bodyAll = linesAll.join('\n');

  await upsert('__conservation__:overall', bodyAll);
  console.log(`  overall: ${redListed} red-listed species`);

  // Then one doc per status with example species.
  for (const { code, name, aliases } of STATUS_INFO) {
    const rows = await prisma.plant.findMany({
      where: { redListStatus: code, status: 'active' },
      take: 20,
      orderBy: [{ adopterCount: 'desc' }, { nameEn: 'asc' }],
      include: { taxon: { select: { latinName: true, family: true } } },
    });
    if (rows.length === 0) continue;
    const species = rows.map((p) => `${p.taxon.latinName}${p.nameEn && p.nameEn.toLowerCase() !== p.taxon.latinName.toLowerCase() ? ` (${p.nameEn})` : ''}`);
    const total = totalsMap.get(code) ?? rows.length;
    const lines = [
      `# ${name} (${code}) species in the collection`,
      `The Garden holds ${total} ${name.toLowerCase()} species across its active accessions.`,
      `Also called: ${aliases.join(', ')}.`,
      `Example species: ${species.slice(0, 12).join(', ')}.`,
      `If a user asks "what plants are ${aliases[0]}", "show me ${aliases[0]} species", or "do you have any ${name.toLowerCase()} plants", answer from this entry.`,
    ];
    await upsert(`__conservation__:${code}`, lines.join('\n'));
    console.log(`  ${code}: ${total} species, ${rows.length} examples`);
  }

  console.log('Conservation-summary ingest done.');
}

async function upsert(title: string, body: string) {
  const bodyHash = sha256(body);
  const existing = await prisma.ragDocument.findFirst({
    where: { title, locale: 'en' },
    select: { id: true, bodyHash: true, _count: { select: { chunks: true } } },
  });
  if (existing && existing.bodyHash === bodyHash && existing._count.chunks > 0) return;
  const chunks = chunkText(body, { size: 400, overlap: 40 });
  const embeddings = await Promise.all(chunks.map((c) => embed(c)));
  await prisma.$transaction(async (tx) => {
    let docId: string;
    if (existing) {
      await tx.ragChunk.deleteMany({ where: { documentId: existing.id } });
      const u = await tx.ragDocument.update({ where: { id: existing.id }, data: { body, bodyHash, isPublished: true } });
      docId = u.id;
    } else {
      const c = await tx.ragDocument.create({ data: { title, locale: 'en', body, bodyHash, isPublished: true } });
      docId = c.id;
    }
    for (let i = 0; i < chunks.length; i++) {
      const vec = `[${embeddings[i]!.join(',')}]`;
      await tx.$executeRawUnsafe(
        `INSERT INTO "RagChunk" (id, "documentId", "chunkIndex", text, "tokenStart", "tokenEnd", locale, embedding)
         VALUES (gen_random_uuid(), $1::uuid, $2::int, $3, $4::int, $5::int, $6::"Locale", $7::vector)`,
        docId, i, chunks[i], 0, chunks[i]!.length, 'en', vec,
      );
    }
  });
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
