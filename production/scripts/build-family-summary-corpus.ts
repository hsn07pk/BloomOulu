/**
 * Family-level summary chunks for the RAG corpus.
 *
 * Per-plant chunks alone can't answer aggregate questions like "How many
 * orchids does the garden have?" or "What ferns are in the collection?" —
 * no single chunk says "the Orchidaceae collection has 158 species".
 * This script generates one document per plant family containing that
 * aggregate count plus the family's biological category. Inserted into
 * the same RagDocument / RagChunk tables as the per-plant entries so the
 * hybrid retriever picks them up alongside individual plants.
 *
 * Idempotent: keyed by `title = '__family__:<FAMILY>'`. Re-runnable.
 *
 *   pnpm tsx scripts/build-family-summary-corpus.ts [--reset]
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { request } from 'undici';
import { chunkText } from '../packages/rag/src/chunk.js';

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'bge-m3';
const RESET = process.argv.includes('--reset');

const prisma = new PrismaClient();

// Reuse the per-plant FAMILY_BIOLOGY map shape. Defined here independently
// to keep this script standalone — keep them in sync if you edit one.
const FAMILY_BIOLOGY: Record<string, string> = {
  DROSERACEAE: 'Carnivorous plant family (sundews, Venus flytrap). These plants eat insects, trapping prey on sticky tentacles or in snap-trap leaves; insectivorous.',
  SARRACENIACEAE: 'Carnivorous plant family (North American pitcher plants). Insect-eating; prey is captured inside tubular pitcher leaves.',
  NEPENTHACEAE: 'Carnivorous plant family (tropical pitcher plants, monkey cups). Insect-eating.',
  CEPHALOTACEAE: 'Carnivorous plant family (Australian pitcher plant). Insect-eating.',
  LENTIBULARIACEAE: 'Carnivorous plant family (bladderworts, butterworts). Insect-eating.',
  BYBLIDACEAE: 'Carnivorous plant family (rainbow plants). Sticky-leaf flypaper trap.',
  PINACEAE: 'Conifer family (pines, spruces, firs). Evergreen, cone-bearing trees; gymnosperms.',
  CUPRESSACEAE: 'Conifer family (cypresses, junipers). Evergreen.',
  TAXACEAE: 'Conifer family (yews). Evergreen, with fleshy red arils.',
  ARAUCARIACEAE: 'Ancient conifer family (monkey puzzle, kauri).',
  GINKGOACEAE: 'Living-fossil gymnosperm (Ginkgo).',
  ORCHIDACEAE: 'Orchid family. Highly diverse flowering plants; many are epiphytic and ornamental.',
  CACTACEAE: 'Cactus family. Succulent, drought-adapted, often spiny; xerophyte.',
  AIZOACEAE: 'Ice plant family. Leaf succulents; many South African.',
  CRASSULACEAE: 'Stonecrop family (Sedum, Echeveria, jade). Leaf succulents; CAM photosynthesis.',
  EUPHORBIACEAE: 'Spurge family. Includes succulent and tropical species; many cactus-like.',
  ASPARAGACEAE: 'Asparagus family. Includes agaves, hostas, hyacinths; many succulent.',
  ASTERACEAE: 'Daisy / composite family. One of the largest plant families; daisies, sunflowers, asters.',
  ROSACEAE: 'Rose family. Includes roses, apples, cherries, strawberries.',
  FABACEAE: 'Legume / pea family. Nitrogen-fixing; beans, clovers, acacias.',
  POACEAE: 'Grass family. True grasses, cereals, bamboo; monocot.',
  CYPERACEAE: 'Sedge family. Grass-like wetland plants.',
  RANUNCULACEAE: 'Buttercup family. Includes globeflowers, anemones, hellebores.',
  POLYPODIACEAE: 'Polypody fern family. Spore-bearing; ferns; non-flowering vascular plants.',
  DRYOPTERIDACEAE: 'Wood-fern family. Ferns; spore-bearing; non-flowering.',
  PTERIDACEAE: 'Maidenhair fern family. Ferns; spore-bearing.',
  ASPLENIACEAE: 'Spleenwort fern family. Ferns; spore-bearing.',
  OSMUNDACEAE: 'Royal-fern family. Ferns; spore-bearing.',
  EQUISETACEAE: 'Horsetail family. Ancient spore-bearing plants; jointed stems.',
  LYCOPODIACEAE: 'Club-moss family. Ancient non-flowering vascular plants.',
};

// English plain-language descriptors for category-style search terms.
// "carnivorous", "orchid", "fern" etc. — these go into the chunk body
// so a user query containing any of them retrieves the right summary.
function categoryWords(family: string): string[] {
  const f = family.toUpperCase();
  if (['DROSERACEAE','SARRACENIACEAE','NEPENTHACEAE','CEPHALOTACEAE','BYBLIDACEAE','DROSOPHYLLACEAE'].includes(f)) {
    return ['carnivorous plant', 'insect-eating plant', 'insectivorous plant'];
  }
  if (f === 'LENTIBULARIACEAE') {
    return ['carnivorous plant', 'insectivorous plant', 'aquatic plant', 'water plant', 'bladderwort'];
  }
  if (['PINACEAE','CUPRESSACEAE','TAXACEAE','ARAUCARIACEAE'].includes(f)) {
    return ['conifer', 'evergreen tree', 'cone-bearing tree', 'gymnosperm'];
  }
  if (f === 'ORCHIDACEAE') return ['orchid'];
  if (f === 'CACTACEAE') return ['cactus', 'succulent', 'desert plant'];
  if (['CRASSULACEAE','AIZOACEAE','ASPARAGACEAE'].includes(f)) return ['succulent'];
  if (['POLYPODIACEAE','DRYOPTERIDACEAE','PTERIDACEAE','ASPLENIACEAE','OSMUNDACEAE','EQUISETACEAE','LYCOPODIACEAE','ATHYRIACEAE','BLECHNACEAE','THELYPTERIDACEAE','CYATHEACEAE','DENNSTAEDTIACEAE'].includes(f)) {
    return ['fern', 'spore-bearing plant', 'non-flowering plant'];
  }
  if (['NYMPHAEACEAE','POTAMOGETONACEAE','PONTEDERIACEAE','HYDROCHARITACEAE','HALORAGACEAE','MENYANTHACEAE','BUTOMACEAE','TYPHACEAE','ALISMATACEAE','CABOMBACEAE'].includes(f)) {
    return ['aquatic plant', 'water plant', 'pond plant'];
  }
  if (['SPHAGNACEAE','POLYTRICHACEAE','DICRANACEAE','BRYACEAE','HYPNACEAE','MNIACEAE','ENCALYPTACEAE'].includes(f)) {
    return ['moss', 'bryophyte', 'non-vascular plant'];
  }
  if (['CLADONIACEAE','PARMELIACEAE','LECANORACEAE','RAMALINACEAE'].includes(f)) {
    return ['lichen', 'symbiotic fungus-alga'];
  }
  if (f === 'ROSACEAE') return ['rose family member', 'fruit tree'];
  if (f === 'POACEAE') return ['grass', 'cereal'];
  if (f === 'BAMBUSOIDEAE' || f === 'BAMBUSACEAE') return ['bamboo'];
  if (['ALSTROEMERIACEAE','AMARYLLIDACEAE','LILIACEAE','IRIDACEAE'].includes(f)) {
    return ['bulb plant', 'flowering bulb'];
  }
  if (['SAXIFRAGACEAE','PRIMULACEAE','CAMPANULACEAE','GENTIANACEAE','POLEMONIACEAE'].includes(f)) {
    return ['alpine plant', 'mountain plant', 'rock garden plant'];
  }
  if (['VITACEAE','MENISPERMACEAE','APOCYNACEAE','CONVOLVULACEAE'].includes(f)) {
    return ['climbing plant', 'vine', 'liana'];
  }
  return [];
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function embed(text: string): Promise<number[]> {
  const res = await request(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (res.statusCode >= 300) {
    throw new Error(`Ollama embed ${res.statusCode}`);
  }
  const json = (await res.body.json()) as { embedding: number[] };
  return json.embedding;
}

async function main() {
  console.log(`Building family-summary RAG corpus (reset=${RESET})`);
  if (RESET) {
    const r = await prisma.ragDocument.deleteMany({ where: { title: { startsWith: '__family__:' } } });
    console.log(`  Reset: ${r.count} family-summary documents removed`);
  }

  // Aggregate accessions + species per family.
  const rows = await prisma.$queryRaw<
    Array<{ family: string; species: bigint; accessions: bigint }>
  >`
    SELECT
      t.family AS family,
      COUNT(DISTINCT p.id)::bigint AS species,
      COALESCE(SUM(acc.cnt), 0)::bigint AS accessions
    FROM "Taxon" t
    JOIN "Plant" p ON p."taxonId" = t.id AND p.status = 'active'
    LEFT JOIN (
      SELECT "plantId", COUNT(*)::bigint AS cnt FROM "Accession" GROUP BY "plantId"
    ) acc ON acc."plantId" = p.id
    WHERE t.family IS NOT NULL AND t.family <> ''
    GROUP BY t.family
    HAVING COUNT(DISTINCT p.id) >= 1
    ORDER BY species DESC
  `;
  console.log(`  ${rows.length} plant families found`);

  let created = 0;
  let skipped = 0;

  for (const r of rows) {
    const family = r.family.toUpperCase();
    const species = Number(r.species);
    const accessions = Number(r.accessions);
    const biology = FAMILY_BIOLOGY[family];
    const cats = categoryWords(family);
    const altLines = cats.length > 0
      ? `This family is also commonly called: ${cats.join(', ')}.\nAsk about "${cats[0]}s" or "${cats[cats.length - 1]}s" to find plants in this family.`
      : '';
    const body = [
      `# Family ${family} (collection summary)`,
      `The University of Oulu Botanical Garden holds ${species} species of family ${family} in its living collection${accessions > 0 ? `, totaling ${accessions} accessions` : ''}.`,
      biology ? `About the family: ${biology}` : '',
      altLines,
      `Common questions like "how many ${family.toLowerCase()}", "do you have ${cats[0] ?? 'these'}", or "show me ${cats[0] ?? family.toLowerCase()}" can be answered from this entry.`,
    ].filter(Boolean).join('\n');

    const title = `__family__:${family}`;
    const bodyHash = sha256(body);

    const existing = await prisma.ragDocument.findFirst({
      where: { title, locale: 'en' },
      select: { id: true, bodyHash: true, _count: { select: { chunks: true } } },
    });
    if (existing && existing.bodyHash === bodyHash && existing._count.chunks > 0) {
      skipped++;
      continue;
    }
    const chunks = chunkText(body, { size: 400, overlap: 40 });
    const embeddings = await Promise.all(chunks.map((c) => embed(c)));

    await prisma.$transaction(async (tx) => {
      let docId: string;
      if (existing) {
        await tx.ragChunk.deleteMany({ where: { documentId: existing.id } });
        const updated = await tx.ragDocument.update({
          where: { id: existing.id },
          data: { body, bodyHash, isPublished: true },
        });
        docId = updated.id;
      } else {
        const c = await tx.ragDocument.create({
          data: { title, locale: 'en', body, bodyHash, isPublished: true },
        });
        docId = c.id;
        created++;
      }
      for (let i = 0; i < chunks.length; i++) {
        const vec = `[${embeddings[i]!.join(',')}]`;
        await tx.$executeRawUnsafe(
          `INSERT INTO "RagChunk" (id, "documentId", "chunkIndex", text, "tokenStart", "tokenEnd", locale, embedding)
           VALUES (gen_random_uuid(), $1::uuid, $2::int, $3, $4::int, $5::int, $6::"Locale", $7::vector)`,
          docId,
          i,
          chunks[i],
          0,
          chunks[i]!.length,
          'en',
          vec,
        );
      }
    });
    if (created % 25 === 0 && created > 0) {
      console.log(`  ${created} family summaries generated...`);
    }
  }

  console.log('Family-summary ingest done:');
  console.log(`  Created:   ${created}`);
  console.log(`  Unchanged: ${skipped}`);
  console.log(`  Total families: ${rows.length}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
