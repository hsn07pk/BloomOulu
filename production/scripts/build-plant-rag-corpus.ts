/**
 * Builds the RAG corpus from the imported Plant catalogue.
 *
 * For every active Plant we synthesize a short markdown document covering
 * its names, family, Red-List status, origin, habitat, accessions, and
 * any curator story. The document is chunked + embedded + upserted into
 * `RagDocument` / `RagChunk` so the AskTheGarden retriever can ground
 * answers in real catalogue data.
 *
 * Idempotent: each Plant's RagDocument is keyed by `title = plant.slug`
 * + locale. We hash the body; if it's unchanged we skip re-embedding.
 *
 * Re-runnable:
 *   pnpm tsx scripts/build-plant-rag-corpus.ts [--limit N] [--locale en|fi|sv|all] [--reset]
 */
import { createHash } from 'node:crypto';
import { PrismaClient, Locale } from '@prisma/client';
import { request } from 'undici';
import { chunkText } from '../packages/rag/src/chunk.js';

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'nomic-embed-text:v1.5';

const LIMIT_ARG = process.argv.indexOf('--limit');
const LIMIT = LIMIT_ARG >= 0 ? Number.parseInt(process.argv[LIMIT_ARG + 1] ?? '0', 10) : 0;
const LOCALE_ARG = process.argv.indexOf('--locale');
const LOCALE_FILTER = LOCALE_ARG >= 0 ? process.argv[LOCALE_ARG + 1] : 'en';
const RESET = process.argv.includes('--reset');

const prisma = new PrismaClient();

async function embed(text: string): Promise<number[]> {
  const res = await request(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (res.statusCode >= 300) {
    throw new Error(`Ollama embed ${res.statusCode}: ${(await res.body.text()).slice(0, 200)}`);
  }
  const json = (await res.body.json()) as { embedding: number[] };
  return json.embedding;
}

interface DocBody {
  title: string;
  locale: Locale;
  body: string;
}

/**
 * Family-level biology enrichment. The raw catalogue only has Latin name +
 * family + status; without this, a user query like "Venus flytrap" or
 * "carnivorous plants" scores ~0.0002 against a Dionaea muscipula chunk
 * because the chunk text contains neither phrase. Adding a short, factual
 * description keyed by family lets the embedding + reranker match common
 * vocabulary back to the right plants without changing the structured data.
 *
 * Keep entries factual and brief (one to two sentences). Synonyms and
 * popular common names go in the description so a single broad query like
 * "carnivorous plants" or "evergreen conifers" lands on the right chunks.
 */
const FAMILY_BIOLOGY: Record<string, string> = {
  DROSERACEAE:
    'Carnivorous plant family (sundews, Venus flytrap). These plants eat insects, trapping prey on sticky tentacles or in snap-trap leaves; insectivorous.',
  SARRACENIACEAE:
    'Carnivorous plant family (North American pitcher plants). Insect-eating; prey is captured inside tubular pitcher leaves; insectivorous.',
  NEPENTHACEAE:
    'Carnivorous plant family (tropical pitcher plants, monkey cups). Insect-eating; insectivorous.',
  CEPHALOTACEAE:
    'Carnivorous plant family (Australian pitcher plant). Insect-eating; insectivorous.',
  LENTIBULARIACEAE:
    'Carnivorous plant family (bladderworts, butterworts). Insect-eating; insectivorous; aquatic suction traps or sticky leaves.',
  BYBLIDACEAE:
    'Carnivorous plant family (rainbow plants). Sticky-leaf flypaper trap; insectivorous.',
  DROSOPHYLLACEAE:
    'Carnivorous plant family (dewy pines). Insect-eating; insectivorous.',
  PINACEAE: 'Conifer family (pines, spruces, firs). Evergreen, cone-bearing trees; gymnosperms.',
  CUPRESSACEAE: 'Conifer family (cypresses, junipers, redwoods). Evergreen, often scale-leaved.',
  TAXACEAE: 'Conifer family (yews). Evergreen, with fleshy red arils instead of woody cones.',
  ARAUCARIACEAE: 'Ancient conifer family (monkey puzzle, kauri). Large evergreen trees.',
  GINKGOACEAE: 'Living-fossil gymnosperm (Ginkgo). Deciduous tree with fan-shaped leaves.',
  ORCHIDACEAE: 'Orchid family. Highly diverse flowering plants; many are epiphytic and ornamental.',
  CACTACEAE:
    'Cactus family. Succulent, drought-adapted, often spiny; native to the Americas; xerophyte.',
  AIZOACEAE: 'Ice plant family. Leaf succulents; many are South African and drought-tolerant.',
  CRASSULACEAE:
    'Stonecrop family (Sedum, Echeveria, jade). Leaf succulents; CAM photosynthesis; drought-tolerant.',
  EUPHORBIACEAE:
    'Spurge family. Includes succulent and tropical species; many have milky toxic latex; some look cactus-like.',
  APOCYNACEAE: 'Dogbane family. Often toxic; includes oleander and milkweeds; some succulents.',
  ASTERACEAE: 'Daisy / composite family. One of the largest plant families; daisies, sunflowers, asters.',
  ROSACEAE: 'Rose family. Includes roses, apples, cherries, strawberries; many ornamental and edible.',
  FABACEAE: 'Legume / pea family. Nitrogen-fixing; includes beans, clovers, acacias.',
  POACEAE: 'Grass family. True grasses, cereals (wheat, rice, oats), bamboo, lawn grasses; monocot.',
  CYPERACEAE: 'Sedge family. Grass-like wetland plants; monocot; "sedges have edges".',
  JUNCACEAE: 'Rush family. Grass-like wetland plants; monocot.',
  RANUNCULACEAE:
    'Buttercup family. Includes globeflowers, anemones, hellebores, larkspurs; many are spring-blooming meadow species.',
  BRASSICACEAE: 'Mustard / cabbage family. Cruciferous vegetables; four-petalled flowers.',
  CARYOPHYLLACEAE: 'Pink / carnation family. Often with notched petals.',
  SCROPHULARIACEAE: 'Figwort family. Includes mulleins and figworts.',
  PLANTAGINACEAE: 'Plantain family. Includes plantains, foxgloves, snapdragons.',
  ERICACEAE:
    'Heath family. Heathers, blueberries, rhododendrons; acid-loving; many evergreen shrubs.',
  LAMIACEAE: 'Mint family. Aromatic herbs (mint, sage, lavender, basil); square stems.',
  PRIMULACEAE: 'Primrose family. Early-spring meadow flowers.',
  LILIACEAE: 'Lily family. True lilies; bulb-forming monocot; ornamental.',
  AMARYLLIDACEAE: 'Amaryllis family. Bulbs (daffodils, onions, garlic); monocot.',
  IRIDACEAE: 'Iris family. Rhizomatous or bulbous monocots; irises, crocuses.',
  ASPARAGACEAE: 'Asparagus family. Includes agaves, hostas, hyacinths; many are succulent.',
  APIACEAE: 'Carrot / parsley family. Aromatic; umbel-shaped flower clusters.',
  SOLANACEAE: 'Nightshade family. Tomato, potato, pepper, datura; many contain alkaloids.',
  SAXIFRAGACEAE: 'Saxifrage family. Rock-garden perennials; many alpine species.',
  SALICACEAE: 'Willow family. Willows, poplars, aspens; deciduous trees and shrubs.',
  CAPRIFOLIACEAE: 'Honeysuckle family. Often climbing or shrubs; fragrant flowers.',
  CAMPANULACEAE: 'Bellflower family. Often blue or violet bell-shaped flowers.',
  GENTIANACEAE: 'Gentian family. Many alpine species with vivid blue flowers.',
  PAPAVERACEAE: 'Poppy family. Includes poppies, bleeding hearts.',
  BEGONIACEAE: 'Begonia family. Tropical understory plants; many ornamental.',
  GESNERIACEAE: 'Gesneriad family (African violets, gloxinias). Tropical ornamentals.',
  VIOLACEAE: 'Violet family. Small spring meadow and woodland flowers.',
  POLEMONIACEAE: 'Phlox family. Often alpine or meadow species.',
  POLYGONACEAE: 'Knotweed family. Includes buckwheat, rhubarb, sorrels.',
  POLYPODIOPHYTA: 'Fern. Spore-bearing vascular plant; non-flowering.',
  POLYPODIACEAE: 'Polypody fern family. Spore-bearing; non-flowering; epiphytic to terrestrial.',
  DRYOPTERIDACEAE: 'Wood-fern family. Spore-bearing; non-flowering.',
  PTERIDACEAE: 'Maidenhair fern family. Spore-bearing; non-flowering.',
  ASPLENIACEAE: 'Spleenwort fern family. Spore-bearing; non-flowering.',
  OSMUNDACEAE: 'Royal-fern family. Spore-bearing; non-flowering.',
  EQUISETACEAE: 'Horsetail family. Ancient spore-bearing plants; jointed stems.',
  LYCOPODIACEAE: 'Club-moss family. Ancient non-flowering vascular plants.',
};

function inferEnglishCommonName(plant: { nameEn: string; taxon: { latinName: string } }): string | null {
  // The legacy DB often copies the Latin name into nameEn when no real
  // English common name is known. Return the curated name only when it
  // differs from the Latin binomial.
  const en = (plant.nameEn ?? '').trim();
  if (!en) return null;
  if (en.toLowerCase() === plant.taxon.latinName.toLowerCase()) return null;
  return en;
}

/**
 * Genus-to-common-name lookup. Most legacy nameEn rows are just the Latin
 * name copied over, so we infer English vocabulary from the genus. Users
 * asking "do you have ivy?" or "show me birches" then match Hedera and
 * Betula chunks through the reranker + tsvector full-text path.
 *
 * Cover the top ~120 genera in the corpus (trees, shrubs, common
 * wildflowers, carnivorous plants, ferns, orchids, succulents, conifers).
 */
const GENUS_COMMON_NAMES: Record<string, string> = {
  // Trees
  Pinus: 'pine, Scots pine, mountain pine',
  Picea: 'spruce',
  Abies: 'fir, silver fir',
  Larix: 'larch, tamarack',
  Pseudotsuga: 'Douglas fir',
  Tsuga: 'hemlock',
  Cedrus: 'cedar',
  Juniperus: 'juniper',
  Taxus: 'yew',
  Thuja: 'thuja, arborvitae, white cedar',
  Cupressus: 'cypress',
  Chamaecyparis: 'cypress, false cypress',
  Ginkgo: 'ginkgo, maidenhair tree',
  Betula: 'birch',
  Quercus: 'oak',
  Acer: 'maple',
  Fagus: 'beech',
  Salix: 'willow, sallow',
  Populus: 'poplar, aspen, cottonwood',
  Fraxinus: 'ash',
  Ulmus: 'elm',
  Tilia: 'linden, lime tree',
  Alnus: 'alder',
  Sorbus: 'rowan, mountain ash, whitebeam',
  Carpinus: 'hornbeam',
  Castanea: 'chestnut',
  Aesculus: 'horse chestnut, buckeye',
  Magnolia: 'magnolia',
  Prunus: 'cherry, plum, almond, peach, apricot',
  Malus: 'apple, crabapple',
  Pyrus: 'pear',
  Crataegus: 'hawthorn',
  Cornus: 'dogwood, cornel',
  // Shrubs & berries
  Vaccinium: 'blueberry, lingonberry, cranberry, bilberry, whortleberry',
  Rubus: 'raspberry, cloudberry, blackberry, bramble, dewberry',
  Ribes: 'currant, gooseberry',
  Fragaria: 'strawberry',
  Calluna: 'heather, ling',
  Erica: 'heath',
  Andromeda: 'bog rosemary',
  Empetrum: 'crowberry',
  Arctostaphylos: 'bearberry, kinnikinnick',
  Ledum: 'Labrador tea, marsh tea',
  Rhododendron: 'rhododendron, azalea',
  Daphne: 'daphne, mezereon',
  Rosa: 'rose',
  Lonicera: 'honeysuckle',
  Viburnum: 'viburnum, guelder rose, snowball',
  Sambucus: 'elder, elderberry',
  Hedera: 'ivy, English ivy',
  Berberis: 'barberry',
  Mahonia: 'Oregon grape',
  Hydrangea: 'hydrangea',
  Spiraea: 'spirea, meadowsweet',
  Forsythia: 'forsythia',
  Syringa: 'lilac',
  Buddleja: 'butterfly bush',
  Cotoneaster: 'cotoneaster',
  // Wildflowers and perennials
  Trollius: 'globeflower',
  Pulsatilla: 'pasqueflower, anemone',
  Caltha: 'marsh marigold, kingcup',
  Anemone: 'anemone, windflower',
  Ranunculus: 'buttercup, crowfoot',
  Aconitum: 'monkshood, wolfsbane, aconite',
  Helleborus: 'hellebore, Christmas rose, Lenten rose',
  Aquilegia: 'columbine',
  Delphinium: 'larkspur, delphinium',
  Primula: 'primrose, cowslip',
  Cyclamen: 'cyclamen',
  Soldanella: 'snowbell',
  Saxifraga: 'saxifrage, rockfoil',
  Sedum: 'stonecrop',
  Sempervivum: 'houseleek, hens and chicks',
  Galanthus: 'snowdrop',
  Crocus: 'crocus',
  Narcissus: 'daffodil, narcissus, jonquil',
  Tulipa: 'tulip',
  Lilium: 'lily, true lily',
  Iris: 'iris, flag',
  Hyacinthus: 'hyacinth',
  Convallaria: 'lily of the valley, May lily',
  Polygonatum: "Solomon's seal",
  Hosta: 'plantain lily, hosta',
  Hemerocallis: 'daylily',
  Astrantia: 'masterwort',
  Geranium: 'cranesbill, hardy geranium',
  Pelargonium: 'pelargonium, storksbill',
  Lavandula: 'lavender',
  Salvia: 'sage, salvia',
  Thymus: 'thyme',
  Mentha: 'mint',
  Origanum: 'oregano, marjoram',
  Rosmarinus: 'rosemary',
  Helianthus: 'sunflower',
  Achillea: 'yarrow, milfoil',
  Centaurea: 'cornflower, knapweed',
  Echinacea: 'coneflower',
  Rudbeckia: 'black-eyed Susan, coneflower',
  Tagetes: 'marigold',
  Solidago: 'goldenrod',
  Aster: 'aster, Michaelmas daisy',
  Bellis: 'daisy, English daisy',
  Leucanthemum: 'ox-eye daisy, Shasta daisy',
  Papaver: 'poppy',
  Eschscholzia: 'California poppy',
  // Carnivorous
  Drosera: 'sundew',
  Dionaea: 'Venus flytrap, flytrap',
  Sarracenia: 'pitcher plant, trumpet pitcher, North American pitcher plant',
  Nepenthes: 'tropical pitcher plant, monkey cups',
  Cephalotus: 'Albany pitcher plant',
  Pinguicula: 'butterwort',
  Utricularia: 'bladderwort',
  Aldrovanda: 'waterwheel plant',
  Byblis: 'rainbow plant',
  Drosophyllum: 'dewy pine, Portuguese sundew',
  Genlisea: 'corkscrew plant',
  // Orchids
  Cypripedium: "lady's slipper orchid",
  Dactylorhiza: 'marsh orchid, spotted orchid',
  Epipactis: 'helleborine',
  Ophrys: 'bee orchid',
  Orchis: 'orchid',
  Phalaenopsis: 'moth orchid',
  Cattleya: 'cattleya orchid',
  Dendrobium: 'dendrobium orchid',
  Vanda: 'vanda orchid',
  Paphiopedilum: 'slipper orchid',
  // Ferns
  Polypodium: 'polypody fern',
  Dryopteris: 'wood fern, male fern',
  Athyrium: 'lady fern',
  Asplenium: 'spleenwort',
  Polystichum: 'shield fern, sword fern',
  Pteridium: 'bracken',
  Osmunda: 'royal fern',
  Adiantum: 'maidenhair fern',
  Matteuccia: 'ostrich fern',
  Cyathea: 'tree fern',
  Equisetum: 'horsetail, scouring rush',
  Lycopodium: 'club moss',
  // Aquatic
  Nymphaea: 'water lily',
  Nuphar: 'spatterdock, pond lily',
  Pontederia: 'pickerel weed',
  Sagittaria: 'arrowhead',
  // Grasses & sedges
  Carex: 'sedge',
  Festuca: 'fescue',
  Poa: 'bluegrass, meadow grass',
  Phragmites: 'reed, common reed',
  Briza: 'quaking grass',
  Stipa: 'feather grass',
  Miscanthus: 'silver grass, miscanthus',
  // Climbers
  Clematis: "clematis, old man's beard",
  Vitis: 'grape vine',
  Wisteria: 'wisteria',
  Parthenocissus: 'Virginia creeper, Boston ivy',
  Humulus: 'hops',
  // Cacti & succulents
  Aloe: 'aloe',
  Echeveria: 'echeveria',
  Crassula: 'jade plant, crassula',
  Kalanchoe: 'kalanchoe',
  Opuntia: 'prickly pear cactus',
  Cereus: 'cereus cactus',
  Mammillaria: 'pincushion cactus',
  Echinocactus: 'barrel cactus',
  Yucca: 'yucca',
  Agave: 'agave, century plant',
  Lithops: 'living stones',
  Haworthia: 'haworthia',
  // Mosses (a few)
  Sphagnum: 'peat moss, sphagnum moss',
  Polytrichum: 'haircap moss',
  // Tropical and ornamental
  Musa: 'banana',
  Strelitzia: 'bird of paradise',
  Heliconia: 'lobster claw, heliconia',
  Anthurium: 'flamingo flower, anthurium',
};

/** Canonical English names for the IUCN Red List codes, used in chunks so
 *  queries like "show me critically endangered species" or "what's
 *  vulnerable" match plants tagged CR or VU. */
const RED_LIST_NAMES: Record<string, string> = {
  EX: 'Extinct',
  EW: 'Extinct in the Wild',
  CR: 'Critically Endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  NT: 'Near Threatened',
  LC: 'Least Concern',
  DD: 'Data Deficient',
  NE: 'Not Evaluated',
};

function genusOf(latinName: string): string {
  return (latinName.split(/\s+/)[0] ?? '').trim();
}

function docForPlant(plant: {
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  origin: string;
  habitat: string;
  biome: string;
  bloomSeason: string;
  bloomWindow: string | null;
  story: unknown;
  taxon: { latinName: string; family: string };
  _count: { accessions: number };
}, locale: Locale): DocBody {
  const localName =
    locale === 'fi' ? plant.nameFi : locale === 'sv' ? plant.nameSv : plant.nameEn;
  const storyObj = (plant.story as Record<string, string> | null) ?? {};
  const storyText = storyObj[locale] ?? storyObj.en ?? '';
  const bloom = plant.bloomWindow || plant.bloomSeason;
  const familyKey = (plant.taxon.family ?? '').toUpperCase().trim();
  const biology = FAMILY_BIOLOGY[familyKey];
  const enCommon = inferEnglishCommonName(plant);
  // Locale common names from the catalogue, deduped, Latin-name removed.
  const aliases = [plant.nameEn, plant.nameFi, plant.nameSv]
    .map((s) => (s ?? '').trim())
    .filter((s) => s && s.toLowerCase() !== plant.taxon.latinName.toLowerCase())
    .filter((s, i, a) => a.indexOf(s) === i);
  // Genus-derived English common names — covers the 80% case where the
  // catalogue stored the Latin name in nameEn and there's no real English
  // common name on the row.
  const genus = genusOf(plant.taxon.latinName);
  const genusCommon = GENUS_COMMON_NAMES[genus];
  // Resolve the Red List code to its plain-English name so a question
  // like "what's endangered" or "show me vulnerable species" can match.
  const statusCode = (plant.redListStatus ?? '').toUpperCase().trim();
  const statusName = RED_LIST_NAMES[statusCode];
  const isRedListed = statusCode && !['', '-', 'LC', 'NE', 'DD'].includes(statusCode);
  const redListLine = statusName
    ? isRedListed
      ? `Conservation status: ${statusCode} (${statusName}) on Finland's Red List, a protected and at-risk species.`
      : `Conservation status: ${statusCode} (${statusName}).`
    : `Conservation status: ${plant.redListStatus || 'unknown'}.`;
  const lines = [
    `# ${plant.taxon.latinName}${localName && localName !== plant.taxon.latinName ? ` (${localName})` : ''}`,
    `Family: ${plant.taxon.family}.`,
    biology ? `About the family: ${biology}` : '',
    genusCommon ? `Common name for the genus ${genus}: ${genusCommon}.` : '',
    aliases.length > 0 ? `Also known as: ${aliases.join(', ')}.` : '',
    enCommon ? `English common name: ${enCommon}.` : '',
    redListLine,
    plant.origin && plant.origin !== '-' ? `Origin: ${plant.origin}.` : '',
    plant.habitat && plant.habitat !== '-' ? `Habitat: ${plant.habitat}${plant.biome && plant.biome !== '-' ? `, ${plant.biome}` : ''}.` : '',
    bloom && bloom !== '-' ? `Bloom season: ${bloom}.` : '',
    `The University of Oulu Botanical Garden holds ${plant._count.accessions} accession${plant._count.accessions === 1 ? '' : 's'} of this plant in its living collection.`,
    '',
    storyText,
  ];
  return { title: plant.slug, locale, body: lines.filter(Boolean).join('\n') };
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function main() {
  console.log(`Building RAG corpus (locale=${LOCALE_FILTER}, limit=${LIMIT || 'none'}, reset=${RESET})`);
  if (RESET) {
    const r1 = await prisma.ragChunk.deleteMany({});
    const r2 = await prisma.ragDocument.deleteMany({ where: { title: { not: { startsWith: '__protect__' } } } });
    console.log(`  Reset: ${r2.count} documents · ${r1.count} chunks removed`);
  }

  const where = { status: 'active' };
  const totalPlants = await prisma.plant.count({ where });
  const take = LIMIT > 0 ? Math.min(LIMIT, totalPlants) : totalPlants;
  console.log(`  ${totalPlants} active plants · processing ${take}`);

  const locales: Locale[] =
    LOCALE_FILTER === 'all' ? (['en', 'fi', 'sv'] as Locale[]) : [LOCALE_FILTER as Locale];

  let docsCreated = 0;
  let docsSkipped = 0;
  let chunksCreated = 0;
  let plantsProcessed = 0;

  // Stream through plants in batches so memory doesn't balloon at 8k+ rows.
  const BATCH = 50;
  for (let offset = 0; offset < take; offset += BATCH) {
    const plants = await prisma.plant.findMany({
      where,
      orderBy: [{ adopterCount: 'desc' }, { nameEn: 'asc' }],
      take: Math.min(BATCH, take - offset),
      skip: offset,
      include: {
        taxon: { select: { latinName: true, family: true } },
        _count: { select: { accessions: true } },
      },
    });
    // Worker pool — N plants embed+insert in parallel inside the batch.
    // Embedding is the slow step (~300ms each); running 8 in parallel
    // takes per-plant wall-time from ~600ms to ~80ms.
    const CONCURRENCY = 8;
    let cursor = 0;
    const processOne = async (plant: (typeof plants)[number]) => {
      for (const locale of locales) {
        try {
          const doc = docForPlant(plant as never, locale);
          const bodyHash = sha256(doc.body);
          const existing = await prisma.ragDocument.findFirst({
            where: { title: doc.title, locale },
            select: { id: true, bodyHash: true, _count: { select: { chunks: true } } },
          });
          // Skip only if body unchanged AND chunks are present (a
          // wrong-dim re-ingest can leave 0 chunks behind).
          if (existing && existing.bodyHash === bodyHash && existing._count.chunks > 0) {
            docsSkipped++;
            continue;
          }
          const chunks = chunkText(doc.body, { size: 400, overlap: 40 });
          if (chunks.length === 0) continue;
          const embeddings = await Promise.all(chunks.map((c) => embed(c)));

          await prisma.$transaction(async (tx) => {
            let docId: string;
            if (existing) {
              await tx.ragChunk.deleteMany({ where: { documentId: existing.id } });
              const updated = await tx.ragDocument.update({
                where: { id: existing.id },
                data: { body: doc.body, bodyHash, isPublished: true },
              });
              docId = updated.id;
            } else {
              const created = await tx.ragDocument.create({
                data: {
                  title: doc.title,
                  locale,
                  body: doc.body,
                  bodyHash,
                  isPublished: true,
                },
              });
              docId = created.id;
              docsCreated++;
            }
            for (let i = 0; i < chunks.length; i++) {
              const vec = `[${embeddings[i]!.join(',')}]`;
              await tx.$executeRawUnsafe(
                `INSERT INTO "RagChunk" (id, "documentId", "chunkIndex", text, "tokenStart", "tokenEnd", locale, embedding, "plantId")
                 VALUES (gen_random_uuid(), $1::uuid, $2::int, $3, $4::int, $5::int, $6::"Locale", $7::vector, $8::uuid)`,
                docId,
                i,
                chunks[i],
                0,
                chunks[i]!.length,
                locale,
                vec,
                plant.id,
              );
              chunksCreated++;
            }
          });
        } catch (err) {
          console.warn(`  ${plant.slug} (${locale}) failed: ${(err as Error).message.slice(0, 100)}`);
        }
      }
      plantsProcessed++;
      if (plantsProcessed % 100 === 0) {
        console.log(`  processed ${plantsProcessed}/${take} · ${chunksCreated} chunks`);
      }
    };
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (cursor < plants.length) {
          const i = cursor++;
          await processOne(plants[i]!);
        }
      }),
    );
  }

  await prisma.auditLog.create({
    data: {
      action: 'rag.corpus.rebuild',
      resource: 'RagDocument/plants',
      after: { plantsProcessed, docsCreated, docsSkipped, chunksCreated, locales, reset: RESET },
    },
  });

  console.log('RAG ingest done:');
  console.log(`  Plants processed:    ${plantsProcessed}`);
  console.log(`  Documents created:   ${docsCreated}`);
  console.log(`  Documents unchanged: ${docsSkipped}`);
  console.log(`  Chunks created:      ${chunksCreated}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
