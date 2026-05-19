/**
 * Real-world Oulu Botanical Garden information as RagDocuments.
 *
 * Up to this point the corpus only knew plants. Visitors also ask about
 * hours, admission, location, the Romeo / Julia greenhouses, parking,
 * history, contact, research programs, and so on. This script ingests
 * a curated info pack drawn from the official sources:
 *   - https://www.oulu.fi/en/university/botanical-garden
 *   - https://www.oulu.fi/en/university/botanical-garden/visit-garden
 *   - https://www.oulu.fi/en/university/botanical-garden/greenhouses-romeo-and-julia
 *   - https://visitoulu.fi/en/product/oulun-yliopiston-kasvitieteellinen-puutarha/
 *   - https://en.wikipedia.org/wiki/University_of_Oulu_Botanical_Gardens
 *
 * Each doc is keyed by `__about__:<topic>` so they're easy to refresh
 * without touching plant chunks. Idempotent (hash-skipped).
 *
 *   pnpm tsx scripts/build-garden-info-corpus.ts [--reset]
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { request } from 'undici';
import { chunkText } from '../packages/rag/src/chunk.js';

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'bge-m3';
const RESET = process.argv.includes('--reset');
const prisma = new PrismaClient();

/** Info pack. Edit any entry here; re-run the script and only changed
 *  ones get re-embedded. Keep each chunk under ~600 chars of body so
 *  the chunker emits one or two chunks per topic. */
const INFO: Array<{ topic: string; title: string; body: string }> = [
  {
    topic: 'overview',
    title: 'About the Oulu Botanical Garden',
    body:
      `The University of Oulu Botanical Garden is one of the northernmost scientific gardens in the world, located on the Linnanmaa campus of the University of Oulu in northern Finland. It maintains over 4,000 plant species in its outdoor garden and roughly 1,200 exotic species in its two pyramid-shaped greenhouses, Romeo and Julia. The garden serves as a research and teaching resource for the University, a public attraction, and a conservation seed bank for Finnish and circumpolar flora.`,
  },
  {
    topic: 'hours',
    title: 'Opening hours',
    body:
      `Opening hours at the Oulu Botanical Garden.\n` +
      `Outdoor garden: open every day from 8:00 to 20:00. There is no winter maintenance, so paths can be snowy or icy from late autumn to early spring.\n` +
      `Greenhouses (Romeo and Julia): open Tuesday to Sunday from 10:00 to 16:00. Closed Mondays.\n` +
      `The garden is open year round. For questions about closure dates and exhibitions, see https://www.oulu.fi/en/university/botanical-garden.`,
  },
  {
    topic: 'admission',
    title: 'Admission and entry fees',
    body:
      `Admission at the Oulu Botanical Garden is by voluntary fee.\n` +
      `The suggested voluntary admission fee is 5 € and covers both the outdoor garden and the Romeo and Julia greenhouses.\n` +
      `Payment methods: MobilePay number 12657, or bank transfer to IBAN FI66 8919 9710 0010 29.\n` +
      `Commercial or professional photography is charged at 160 € per hour. Personal photography is free.`,
  },
  {
    topic: 'location',
    title: 'Location and how to get there',
    body:
      `The Oulu Botanical Garden sits in the northern corner of the Linnanmaa campus of the University of Oulu, on the shore of Lake Kuivasjärvi.\n` +
      `Street address: Kaitoväylä 5, Oulu.\n` +
      `Postal address: P.O. Box 3000, FI-90014 University of Oulu, Finland.\n` +
      `Coordinates: 65.06306 N, 25.46528 E.\n` +
      `The Linnanmaa campus is reachable by Oulu city buses; check journey planners for the latest routes. The garden is in the same building cluster as the University's Botanical and Zoological Museums.`,
  },
  {
    topic: 'parking',
    title: 'Parking',
    body:
      `Parking at the Oulu Botanical Garden.\n` +
      `Parking is free from June 1 to July 31 (summer season).\n` +
      `Outside that window, parking is paid on weekdays from 8:00 to 16:00 at 1.20 € per hour, capped at 6 € per day. Outside the paid hours and on weekends parking is free.\n` +
      `Three bus parking spaces are available free of charge.\n` +
      `Electric vehicle charging is available at the guest charging spots for 0.20 € per kWh.\n` +
      `Payments are handled through the eParking, EasyPark, or Parkman apps.`,
  },
  {
    topic: 'greenhouses',
    title: 'Romeo and Julia greenhouses',
    body:
      `Romeo and Julia are the garden's two pyramid-shaped greenhouses and its visual landmark. Together they hold about 1,200 exotic plant species.\n` +
      `Romeo greenhouse: tropical and subtropical vegetation. Visitors see tropical fruits, orchids, carnivorous plants (Drosera, Dionaea, Nepenthes, Sarracenia, Cephalotus), lianas, aquatic plants, and familiar food and fodder plants.\n` +
      `Julia greenhouse: Mediterranean climate, desert, and temperate vegetation. Olives (Olea europaea), pelargoniums, grape vines (Vitis vinifera), hummingbird flowers, and Araucaria conifers create a Mediterranean atmosphere.\n` +
      `Open Tuesday to Sunday 10:00 to 16:00. Plant labels show scientific name, geographic range, and Finnish common name. Information boards provide context.`,
  },
  {
    topic: 'outdoor',
    title: 'Outdoor garden',
    body:
      `The outdoor garden covers extensive grounds and presents over 4,000 plant species arranged by origin, habitat, and conservation theme. Visitors see Finnish native flora, alpine and boreal species, ornamental perennials, woody trees and shrubs, and themed rock and meadow sections.\n` +
      `The outdoor garden is open every day from 8:00 to 20:00. Entry is by the same voluntary 5 € fee that covers the greenhouses.\n` +
      `There is no winter maintenance, so the outdoor paths can be snowy or icy outside the growing season.`,
  },
  {
    topic: 'tours',
    title: 'Guided tours and group visits',
    body:
      `Guided tours of the Oulu Botanical Garden must be booked in advance through the online reservation form on https://www.oulu.fi/en/university/botanical-garden.\n` +
      `Pricing: regular group tour 90 € per hour for up to 20 people, school group 70 € per group, evening tour 100 € per hour.\n` +
      `Maximum 20 people per guided tour group.\n` +
      `No guided tours are offered in July. Schools, families, and visitor groups should book several weeks ahead, especially in the peak May to September season.`,
  },
  {
    topic: 'history',
    title: 'History',
    body:
      `The University of Oulu Botanical Garden was relocated to the Linnanmaa campus in the summer of 1983. Before that, the garden's collections were maintained at the Hupisaaret Islands park near central Oulu.\n` +
      `Today it is one of the northernmost scientific botanical gardens in the world. It operates under the University of Oulu's Biodiversity Unit and shares its premises with the Botanical Museum and the Zoological Museum.`,
  },
  {
    topic: 'mission-and-research',
    title: 'Research, education, and seed exchange',
    body:
      `The Oulu Botanical Garden's roles include research, university teaching, public outreach, and conservation.\n` +
      `It functions as a testing ground for new and rare plant specimens, supports biology coursework and student projects, and contributes to taxonomy, systematics, biogeography, evolutionary biology, and conservation biology research through the University of Oulu's Biodiversity Unit.\n` +
      `The garden runs an Index Seminum seed exchange programme, distributing seeds of wild northern flora to other scientific gardens worldwide. This is part of the global botanical garden network that conserves plant diversity ex situ.`,
  },
  {
    topic: 'contact',
    title: 'Contact and staff',
    body:
      `Contact details for the Oulu Botanical Garden.\n` +
      `Director: Jouni Aspi, phone 0294 481214.\n` +
      `Curator: Anna Liisa Ruotsalainen, phone 0294 481559. The curator handles plant identification questions, donor enquiries, and conservation collaborations.\n` +
      `For general visitor questions, see https://www.oulu.fi/en/university/botanical-garden. Group bookings go through the online reservation form on that page.`,
  },
  {
    topic: 'museums',
    title: 'Botanical and Zoological Museums on site',
    body:
      `The Oulu Botanical Garden shares its premises with two University of Oulu museums.\n` +
      `The Botanical Museum holds preserved specimens and provides species information for the flora of northern Finland. It coordinates with Finland's Central Museum of Natural History.\n` +
      `The Zoological Museum conducts research in taxonomy, systematics, biogeography, evolutionary biology, and conservation biology, with a focus on endangered species. Its collections are not open to the public, but its research feeds Finnish red list assessments.`,
  },
  {
    topic: 'accessibility-photography',
    title: 'Accessibility, photography, and visitor conduct',
    body:
      `Personal photography is permitted free of charge inside the Oulu Botanical Garden and its greenhouses. Commercial or professional photography costs 160 € per hour and must be arranged in advance.\n` +
      `Visitors are asked to stay on the paths, not pick or touch plants, and keep voices low inside the greenhouses where conditions are kept constant for plant health.\n` +
      `For specific accessibility questions, including wheelchair routes and step-free access to Romeo and Julia, please contact the garden directly via the curator's phone number or the official website, since accessibility details change with seasonal maintenance.`,
  },
  {
    topic: 'climate-zone',
    title: 'Climate and northern significance',
    body:
      `The Oulu Botanical Garden sits at roughly 65 degrees north latitude, just south of the Arctic Circle. The local climate is subarctic, with long cold winters, snow cover typically from November to April, and short cool summers with extended daylight in June and July.\n` +
      `This makes Oulu one of the northernmost scientific botanical gardens in the world, and the outdoor collection emphasises cold-hardy circumpolar species and Finnish native flora. The Romeo and Julia greenhouses give visitors access to tropical and Mediterranean vegetation that cannot survive the outdoor conditions.`,
  },
  {
    topic: 'visitor-conduct',
    title: 'What to do and not do as a visitor',
    body:
      `When visiting the Oulu Botanical Garden, please do not pick flowers, fruits, leaves, or any plant material. Do not step into planting beds or off the marked paths. Keep voices low and refrain from running inside the Romeo and Julia greenhouses, where high humidity and warm temperatures are maintained for the plants.\n` +
      `Dogs and other pets are not allowed in the greenhouses for plant-health reasons.\n` +
      `Food and drink should be enjoyed outside the greenhouses. Trash should be carried out or placed in bins by the entrances.`,
  },
  {
    topic: 'collection-overview',
    title: 'Our plant collection at a glance',
    body:
      `The Oulu Botanical Garden's living collection is one of the largest in northern Europe.\n` +
      `In total we hold around 4,000 plant species in the outdoor garden and roughly 1,200 exotic species in the Romeo and Julia greenhouses, with more than 57,000 individual accessions across the catalogue.\n` +
      `The strengths of the collection include Finnish and circumpolar native flora, carnivorous plants (Drosera, Dionaea, Sarracenia, Nepenthes, Cephalotus), conifers (pines, spruces, firs, junipers, yews), orchids (158 species including lady's slipper orchids), succulents and cacti, ferns, and Mediterranean and tropical species in the greenhouses.\n` +
      `When a visitor asks "what plants do you have", "how big is the collection", or "what can I see", this is the high-level answer.`,
  },
  {
    topic: 'adoption',
    title: 'Plant adoption programme',
    body:
      `BloomOulu offers a plant adoption programme on the bloomoulu.fi website: a visitor sponsors a specific plant in the living collection, the funds support the Garden's conservation and care work, and the adopter gets a digital tax-deductible certificate plus, for higher tiers, a physical thank-you (a postcard, an art print, or a hand-bound seed-bank book).\n` +
      `Endangered species cost more to adopt than common cultivars; the tier price scales with the plant's conservation status and rarity. Endangered-tier adoptions also unlock the option of a tribute plaque next to the plant.\n` +
      `The adoption flow lives at https://bloomoulu.fi/en/adopt: pick a plant, choose a tier, optionally co-adopt with a friend or dedicate the adoption in someone's name, and pay via Paytrail or SEPA.\n` +
      `When a visitor asks "can I adopt", "how does adoption work", "what does it cost", or "can I adopt an endangered plant", this is the answer. Specific tier prices and the live adopter count for each plant are visible on the per-plant page.`,
  },
  {
    topic: 'plant-care-redirect',
    title: 'Plant care advice (we redirect)',
    body:
      `The Oulu Botanical Garden is a research and conservation collection, not a horticultural advice service, so we do not maintain plant-care guides for houseplants or home gardens. Visitors asking "how do I water my orchid?", "what soil for a cactus?", or "why are the leaves turning yellow?" should be redirected.\n` +
      `Good free alternatives: the RHS plant care guides at rhs.org.uk, the Chicago Botanic Garden Plant Information Service, the New York Botanical Garden Plant Information Service, or the U.S. Botanic Garden Plant Hotline.\n` +
      `For specific questions about plants in our collection, Curator Anna Liisa Ruotsalainen is happy to help.`,
  },
  {
    topic: 'life-escape',
    title: 'LIFE+ ESCAPE and seed bank programmes',
    body:
      `The Oulu Botanical Garden contributes to circumpolar plant conservation through its Index Seminum seed exchange and through partnership with international LIFE programme projects. The Garden does not maintain a public marketing page for the LIFE+ ESCAPE seed bank project on this website, so detailed scope, partner list, and project timeline are not available in our catalogue.\n` +
      `For up-to-date project information, Curator Anna Liisa Ruotsalainen or the University of Oulu Biodiversity Unit can provide the latest details.\n` +
      `The Garden's own Index Seminum exchange distributes seeds of wild northern flora to other scientific gardens worldwide as part of the global botanical garden network conserving plant diversity ex situ.`,
  },
  {
    topic: 'platform-adoption-flow',
    title: 'How plant adoption works on bloomoulu.fi',
    body:
      `The plant adoption flow on bloomoulu.fi has four steps. First, the visitor picks a tier (Seedling, Rooted, Vulnerable, Endangered, or Corporate). Second, they browse plants matching that tier and pick one (filter by family, conservation status, or origin, including a "match me to my home region" option). Third, they optionally personalise the adoption: add a nickname, dedicate it in someone's name, co-adopt with friends (up to ten co-adopters), opt into gift wrap (4 €). Fourth, they pay via Paytrail (cards), MobilePay, or SEPA bank transfer.\n` +
      `After payment, the donor gets a digital certificate by email, the plant appears in their "My Garden" page, and the receipt with VAT split is filed for tax purposes. Endangered-tier adoptions trigger curator review for any plaque-engraving requests.`,
  },
  {
    topic: 'platform-adoption-tiers',
    title: 'Adoption tier prices and what each unlocks',
    body:
      `BloomOulu has five adoption tiers. Annual and monthly prices in euros, plus the main perks:\n` +
      `Seedling: 25 €/year or 3 €/month. Nickname your plant, regional match, digital certificate, quarterly notes.\n` +
      `Rooted: 75 €/year or 8 €/month. Printed certificate mailed to you, "I@H" postcard from the plant's region, seasonal photos of your specific plant.\n` +
      `Vulnerable: 250 €/year or 25 €/month. Funds an actively threatened species. Includes signed botanical art, themed garden walk, and an Adopters' Open Day + guest.\n` +
      `Endangered: 750 €/year or 75 €/month. Limited-edition signed art print, donor dinner with seed-bank visit, an engraved plaque next to your specific plant, and an annual seed packet.\n` +
      `Corporate: 2500 €/year. CSR-ready quarterly impact reports, logo placement on greenhouse signage, private event slot for up to 20 guests. Tax-deductible under Finnish TVL §57.`,
  },
  {
    topic: 'platform-payments',
    title: 'Payment methods, currencies, and refunds',
    body:
      `BloomOulu accepts three payment methods. Paytrail handles credit and debit cards (Visa, Mastercard, American Express) through its Finnish gateway with full 3-D Secure. MobilePay accepts payments from Finnish and Danish MobilePay accounts; the platform's MobilePay code is 12657. SEPA bank transfers are supported with an RF reference code that auto-matches the donation; the receiving IBAN is shown on the adopt-pay page.\n` +
      `Currency is euros. The platform splits each donation into a donation portion and a perks portion based on Finnish VAT rules (currently 72% donation, 28% perks for VAT purposes); both portions appear on the receipt PDF.\n` +
      `Refunds within the first 14 days are handled by the curator via the contact form. After 14 days, an adoption is generally non-refundable but can be paused for up to three months from My Garden -> Pause for 3 months.`,
  },
  {
    topic: 'platform-account',
    title: 'Account, sign-in, and user roles',
    body:
      `Visitors can browse and adopt anonymously. To save adoptions and revisit AskTheGarden conversations across devices, the visitor signs in. Sign-in options: magic-link email (no password needed) and University of Oulu single sign-on for staff and students.\n` +
      `Signed-in donors see "My Garden": their adoptions, payment history, receipts, tax certificates, and saved AskTheGarden chats. From My Garden a donor can update their profile, pause an adoption for three months, cancel an adoption, export their data (GDPR), or request deletion of their account.\n` +
      `Staff and curators get an additional /admin interface for plant catalogue editing, donor support, and approving curator-escalation responses. Roles are donor (default), staff, curator, and admin.`,
  },
  {
    topic: 'platform-gdpr',
    title: 'GDPR: data export, deletion, and privacy',
    body:
      `BloomOulu is GDPR-compliant. From My Garden -> Privacy & GDPR, a signed-in donor can: 1) request a copy of their data, which arrives as a JSON export by email within seven days, including their profile, adoptions, payments, AskTheGarden messages, and reactions; and 2) request erasure of their account, which redacts personally-identifying fields and deletes private data, while preserving anonymised donation records for accounting and audit purposes (Finnish bookkeeping law requires seven years' retention of receipts).\n` +
      `Data is stored on EU servers (Hetzner Helsinki). The privacy policy is at /legal/privacy.`,
  },
  {
    topic: 'platform-receipts-taxes',
    title: 'Receipts and Finnish tax deduction',
    body:
      `Every adoption produces a PDF receipt emailed to the donor. The receipt shows: the gross donation, the donation portion (eligible for Finnish income-tax deduction in certain cases), the perks portion (subject to VAT), the plant adopted, and the reference number.\n` +
      `For Finnish individual donors, gifts to certain accredited entities are tax-deductible if total annual gifts exceed €850 and stay under €500,000. The Oulu Botanical Garden's University status may make Corporate-tier donations deductible under TVL §57. Individual eligibility depends on the donor's tax circumstances; consult Vero.fi.\n` +
      `Annual tax certificates for the previous calendar year are available from My Garden -> Tax certificates in February each year.`,
  },
  {
    topic: 'platform-my-garden',
    title: 'My Garden page features',
    body:
      `My Garden, available at bloomoulu.fi/my-garden after signing in, is the donor's hub. It shows: every plant the donor has adopted with photos and current status, payment history with downloadable receipts, the annual tax certificate, AskTheGarden conversation history with the option to delete or share, saved plants for future adoption, and account-management actions (profile edit, pause adoption, cancel, export data, delete account).\n` +
      `Donors can also see the live adopter count and co-adopters on each of their plants.`,
  },
  {
    topic: 'platform-curator-escalations',
    title: 'How curator escalations work',
    body:
      `When AskTheGarden cannot find a reliable answer in its corpus, or when a donor presses "Forward to a curator" on an answer they think is off-base, the question gets queued for Curator Anna Liisa Ruotsalainen. The curator typically responds within two working days, by email if the donor was signed in or provided a contact email.\n` +
      `Curators reply via the admin queue at /admin/curator-escalations and the response is sent through the platform so it's logged for quality auditing. The donor sees the curator reply both by email and in their AskTheGarden history.`,
  },
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

async function upsert(title: string, body: string) {
  const bodyHash = sha256(body);
  const existing = await prisma.ragDocument.findFirst({
    where: { title, locale: 'en' },
    select: { id: true, bodyHash: true, _count: { select: { chunks: true } } },
  });
  if (existing && existing.bodyHash === bodyHash && existing._count.chunks > 0) {
    return 'skipped';
  }
  const chunks = chunkText(body, { size: 500, overlap: 50 });
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
  return existing ? 'updated' : 'created';
}

async function main() {
  console.log(`Building garden-info corpus (reset=${RESET}, ${INFO.length} topics)`);
  if (RESET) {
    const r = await prisma.ragDocument.deleteMany({
      where: { title: { startsWith: '__about__:' } },
    });
    console.log(`  Reset: ${r.count} info docs removed`);
  }
  let created = 0, updated = 0, skipped = 0;
  for (const item of INFO) {
    const result = await upsert(`__about__:${item.topic}`, `# ${item.title}\n\n${item.body}`);
    if (result === 'created') created++;
    else if (result === 'updated') updated++;
    else skipped++;
    console.log(`  ${item.topic}: ${result}`);
  }
  console.log(`Done. created=${created} updated=${updated} skipped=${skipped}`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
