/**
 * Auto-ingest a plant into the AskTheGarden RAG corpus.
 *
 * Called every time a Plant row is created via the assistant / bulk-add
 * flow, or whenever an enrichment suggestion is approved. Builds a
 * single RagDocument body from the plant's structured fields + story +
 * images, upserts it, and enqueues a rag-ingest BullMQ job for the API
 * worker to chunk + embed. BullMQ's defaultJobOpts already give us
 * 5 retries with exponential back-off so transient embed failures self-
 * heal without operator intervention.
 *
 * The RagDocument title is namespaced as `__plant__:<slug>` so it never
 * collides with the per-plant catalogue chunks the build scripts create
 * (those use other prefixes), with manual ingests (`__manual__:...`), or
 * with family/conservation summaries (`__family__:...`, `__conservation__:...`).
 */
import { Queue } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { obs } from './observability.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const QUEUE_NAME = 'rag-ingest';

let queue: Queue | null = null;
function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: { url: REDIS_URL } });
  }
  return queue;
}

/**
 * Build the searchable body text for one plant. Concatenates the
 * locale-aware story with the structured fields a curator might ask
 * the chatbot about: native origin, Red List status, family, habitat,
 * primary photo attribution. Keeps the format stable so re-ingesting
 * the same plant produces the same hash when nothing changed (the
 * rag-ingest job skips unchanged docs).
 */
function buildPlantRagBody(plant: {
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  redListYear: number;
  origin: string;
  habitat: string;
  biome: string;
  bloomSeason: string;
  bloomWindow: string | null;
  story: unknown;
  quickFacts: unknown;
  gardenZone: string | null;
  taxon: { latinName: string; family: string } | null;
  primaryImage: { url: string; attribution: string; licenseSpdx: string } | null;
}): string {
  const lines: string[] = [];
  if (plant.taxon?.latinName) lines.push(`Latin name: ${plant.taxon.latinName}`);
  if (plant.taxon?.family) lines.push(`Family: ${plant.taxon.family}`);
  lines.push(`Common names — English: ${plant.nameEn}; Finnish: ${plant.nameFi}; Swedish: ${plant.nameSv}.`);
  if (plant.redListStatus) {
    lines.push(`IUCN / Finnish Red List ${plant.redListYear}: ${plant.redListStatus}.`);
  }
  if (plant.origin) lines.push(`Native origin: ${plant.origin}.`);
  if (plant.habitat) lines.push(`Habitat: ${plant.habitat}.`);
  if (plant.biome) lines.push(`Biome: ${plant.biome}.`);
  if (plant.bloomSeason) lines.push(`Bloom season: ${plant.bloomSeason}${plant.bloomWindow ? ` (${plant.bloomWindow})` : ''}.`);
  if (plant.gardenZone) lines.push(`Garden zone: ${plant.gardenZone}.`);
  const story = plant.story as { en?: string; fi?: string; sv?: string } | null;
  if (story?.en) lines.push(`Story (English): ${story.en}`);
  if (story?.fi) lines.push(`Tarina (Finnish): ${story.fi}`);
  if (story?.sv) lines.push(`Berättelse (Swedish): ${story.sv}`);
  const facts = plant.quickFacts as Array<{ labelKey?: string; value?: string }> | null;
  if (facts && Array.isArray(facts) && facts.length > 0) {
    lines.push(
      `Quick facts: ${facts
        .map((f) => `${f.labelKey ?? '?'} = ${f.value ?? '?'}`)
        .join('; ')}.`,
    );
  }
  if (plant.primaryImage?.url) {
    lines.push(
      `Primary photo: ${plant.primaryImage.url} (${plant.primaryImage.attribution}, ${plant.primaryImage.licenseSpdx}).`,
    );
  }
  lines.push(`Plant page: /plants/${plant.slug}`);
  return lines.join('\n\n');
}

/**
 * Upsert the per-plant RagDocument and enqueue an ingest job. Safe to
 * call multiple times — the rag-ingest processor detects an unchanged
 * body hash and skips re-embedding.
 */
export async function ingestPlantIntoRag(
  prisma: PrismaClient,
  plantId: string,
): Promise<void> {
  const plant = await prisma.plant.findUnique({
    where: { id: plantId },
    include: {
      taxon: { select: { latinName: true, family: true } },
      primaryImage: { select: { url: true, attribution: true, licenseSpdx: true } },
      accessions: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          accessionNumber: true,
          sourcePopulation: true,
          collectedAt: true,
          collectedBy: true,
          notes: true,
        },
      },
      narrations: {
        take: 5,
        select: { locale: true, transcript: true },
      },
      citations: {
        take: 10,
        include: {
          citation: {
            select: {
              displayTitle: true,
              authors: true,
              year: true,
              identifier: true,
            },
          },
        },
      },
    },
  });
  if (!plant) return;
  const baseBody = buildPlantRagBody({
    slug: plant.slug,
    nameEn: plant.nameEn,
    nameFi: plant.nameFi,
    nameSv: plant.nameSv,
    redListStatus: plant.redListStatus as unknown as string,
    redListYear: plant.redListYear,
    origin: plant.origin,
    habitat: plant.habitat,
    biome: plant.biome,
    bloomSeason: plant.bloomSeason as unknown as string,
    bloomWindow: plant.bloomWindow,
    story: plant.story,
    quickFacts: plant.quickFacts,
    gardenZone: plant.gardenZone,
    taxon: plant.taxon,
    primaryImage: plant.primaryImage,
  });
  // Tack on related-row context that the donor might ask about. Every
  // piece is short and structured so the embedder picks up the keywords
  // without overwhelming the per-plant doc.
  const extras: string[] = [];
  if (plant.accessions.length > 0) {
    extras.push(
      `Accessions in our collection:\n` +
        plant.accessions
          .map(
            (a) =>
              `  • ${a.accessionNumber}${a.sourcePopulation ? ` — wild source: ${a.sourcePopulation}` : ''}${a.collectedBy ? ` — collected by ${a.collectedBy}` : ''}${a.collectedAt ? ` — collected ${a.collectedAt.toISOString().slice(0, 10)}` : ''}${a.notes ? ` — ${a.notes}` : ''}`,
          )
          .join('\n'),
    );
  }
  if (plant.narrations.length > 0) {
    for (const n of plant.narrations) {
      if (n.transcript) {
        extras.push(`Audio narration (${n.locale}):\n${n.transcript}`);
      }
    }
  }
  if (plant.citations.length > 0) {
    extras.push(
      `Cited research:\n` +
        plant.citations
          .map(
            (c) =>
              `  • ${c.citation.displayTitle}${c.citation.authors ? ` — ${c.citation.authors}` : ''}${c.citation.year ? ` (${c.citation.year})` : ''}${c.citation.identifier ? ` — id: ${c.citation.identifier}` : ''}`,
          )
          .join('\n'),
    );
  }
  const body = extras.length > 0 ? `${baseBody}\n\n${extras.join('\n\n')}` : baseBody;
  const title = `__plant__:${plant.slug}`;
  const hash = createHash('sha256').update(body).digest('hex');
  // Upsert against the (title, locale) unique. Locale defaults to EN —
  // the body itself contains the FI/SV translations inline so the
  // multilingual embedding model can index all three from one row.
  const doc = await prisma.ragDocument.upsert({
    where: { title_locale: { title, locale: 'en' as any } },
    create: {
      title,
      locale: 'en' as any,
      body,
      bodyHash: hash,
      isPublished: true,
      sourceUrl: `/plants/${plant.slug}`,
    },
    update: {
      body,
      bodyHash: hash,
      isPublished: true,
      sourceUrl: `/plants/${plant.slug}`,
    },
  });
  // Enqueue the BullMQ job — the API worker picks it up and runs the
  // chunker + embedder. defaultJobOpts in the API gives 5 retries with
  // exponential back-off so a transient Ollama failure self-heals.
  await getQueue().add(
    'ingest',
    { documentId: doc.id },
    {
      // 10 attempts with 5-second base back-off → ~25 minutes total
      // retry budget. Enough to ride out a flaky Ollama restart
      // without forever-pinning the queue.
      attempts: 10,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 1000,
    },
  );
  await prisma.auditLog.create({
    data: {
      actorUserId: null,
      action: 'admin.rag.ingest-plant.enqueued',
      resource: `Plant/${plantId}`,
    },
  });
  obs.info('rag', `enqueued ingest for plant ${plant.slug}`, {
    plantId,
    slug: plant.slug,
    documentId: doc.id,
    bodyLength: body.length,
  });
}

/**
 * Ingest a ContentBlock into RAG. Garden-wide CMS copy (hero, callout,
 * policy, etc.) that donors might paraphrase in a question. Body is the
 * concatenation of the three locale variants so the multilingual
 * embedder indexes all three at once.
 */
export async function ingestContentBlockIntoRag(
  prisma: PrismaClient,
  contentBlockId: string,
): Promise<void> {
  const cb = await prisma.contentBlock.findUnique({ where: { id: contentBlockId } });
  if (!cb || !cb.isPublished) return;
  const lines: string[] = [];
  lines.push(`Garden content block: ${cb.slug} (${cb.kind})`);
  if (cb.bodyEn) lines.push(`English:\n${cb.bodyEn}`);
  if (cb.bodyFi) lines.push(`Finnish:\n${cb.bodyFi}`);
  if (cb.bodySv) lines.push(`Swedish:\n${cb.bodySv}`);
  if (cb.ctaText) lines.push(`Call-to-action: ${JSON.stringify(cb.ctaText)}${cb.ctaHref ? ` → ${cb.ctaHref}` : ''}`);
  const body = lines.join('\n\n');
  const title = `__content__:${cb.slug}`;
  const hash = createHash('sha256').update(body).digest('hex');
  const doc = await prisma.ragDocument.upsert({
    where: { title_locale: { title, locale: 'en' as any } },
    create: { title, locale: 'en' as any, body, bodyHash: hash, isPublished: true },
    update: { body, bodyHash: hash, isPublished: true },
  });
  await getQueue().add(
    'ingest',
    { documentId: doc.id },
    {
      attempts: 10,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 1000,
    },
  );
  obs.info('rag', `enqueued ingest for content block ${cb.slug}`, {
    contentBlockId,
    documentId: doc.id,
  });
}

/**
 * Ingest the donor-facing SystemSetting bundle (garden name, address,
 * hours, contact email, IBAN — anything a donor could ask about). We
 * gather them into one doc rather than one-per-key so the embedder sees
 * the related context together.
 */
export async function ingestGardenSettingsIntoRag(prisma: PrismaClient): Promise<void> {
  const settings = await prisma.systemSetting.findMany({
    where: {
      OR: [
        { key: { startsWith: 'garden.' } },
        { key: { startsWith: 'bankTransfer.' } },
        { key: { startsWith: 'ask.' } },
        { key: { startsWith: 'adoption.' } },
      ],
    },
  });
  if (settings.length === 0) return;
  const lines: string[] = ['Garden facts (for donor questions):'];
  for (const s of settings) {
    const v = typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value);
    lines.push(`  • ${s.key}${s.description ? ` — ${s.description}` : ''}: ${v}`);
  }
  const body = lines.join('\n');
  const title = `__settings__:garden`;
  const hash = createHash('sha256').update(body).digest('hex');
  const doc = await prisma.ragDocument.upsert({
    where: { title_locale: { title, locale: 'en' as any } },
    create: { title, locale: 'en' as any, body, bodyHash: hash, isPublished: true },
    update: { body, bodyHash: hash, isPublished: true },
  });
  await getQueue().add(
    'ingest',
    { documentId: doc.id },
    {
      attempts: 10,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 1000,
    },
  );
  obs.info('rag', 'enqueued ingest for garden settings bundle', {
    documentId: doc.id,
    settingCount: settings.length,
  });
}

/**
 * Hook called from the Prisma client extension whenever a Plant row OR
 * its PlantImage rows are written. Resolves the plantId from the
 * mutation args + reuses ingestPlantIntoRagAsync so the helper is the
 * single canonical re-ingest path.
 */
export async function ragHookOnPlantWrite(
  prisma: PrismaClient,
  model: string,
  operation: string,
  args: any,
  result: any,
): Promise<void> {
  try {
    // Resolve the plantId. For Plant writes the id is on the result/args.
    // For PlantImage writes (the foreign key is plantId) we either read
    // it from args.data or look it up via the image id.
    let plantId: string | null = null;
    if (model === 'Plant') {
      plantId = result?.id ?? args?.where?.id ?? null;
    } else if (model === 'PlantImage') {
      plantId =
        args?.data?.plantId ??
        result?.plantId ??
        (args?.where?.id
          ? (await prisma.plantImage
              .findUnique({ where: { id: args.where.id }, select: { plantId: true } })
              .catch(() => null))?.plantId ?? null
          : null);
    } else if (model === 'Taxon') {
      // Taxon changes (family rename) affect every plant under that
      // taxon. Re-ingest the lot.
      const taxonId = result?.id ?? args?.where?.id;
      if (taxonId) {
        const plants = await prisma.plant.findMany({
          where: { taxonId },
          select: { id: true },
        });
        for (const p of plants) ingestPlantIntoRagAsync(prisma, p.id);
      }
      return;
    } else if (model === 'Accession' || model === 'AudioNarration' || model === 'PlantCitation') {
      // These are per-plant secondary records whose content is included
      // verbatim in the per-plant RAG body. A change to any of them
      // means the plant's RAG body is out of date.
      const linkedPlantId = args?.data?.plantId ?? result?.plantId ?? null;
      if (linkedPlantId) ingestPlantIntoRagAsync(prisma, linkedPlantId);
      return;
    } else if (model === 'ContentBlock') {
      // CMS copy: re-embed just this block, keyed by slug.
      const slug = args?.data?.slug ?? args?.where?.slug ?? result?.slug ?? null;
      if (slug) {
        void ingestContentBlockIntoRag(prisma, slug).catch((err) =>
          obs.error('rag', `ingestContentBlockIntoRag failed`, err, { slug }),
        );
      }
      return;
    } else if (model === 'SystemSetting') {
      // SystemSetting changes can affect the chatbot's idea of the
      // garden (opening hours, curator email, adoption tiers, etc.).
      // Re-bundle the whole "garden settings" doc — there's only one,
      // so this is cheap and avoids tracking which keys matter.
      void ingestGardenSettingsIntoRag(prisma).catch((err) =>
        obs.error('rag', `ingestGardenSettingsIntoRag failed`, err),
      );
      return;
    }
    if (!plantId) return;
    ingestPlantIntoRagAsync(prisma, plantId);
  } catch (err) {
    obs.error('rag', `ragHookOnPlantWrite failed`, err, { model, operation });
  }
}

/**
 * Fire-and-forget wrapper that catches errors so a RAG ingest failure
 * never blocks the foreground create flow. The audit log records the
 * failure with the plantId so the curator can manually retry.
 */
export function ingestPlantIntoRagAsync(prisma: PrismaClient, plantId: string): void {
  void ingestPlantIntoRag(prisma, plantId).catch(async (err) => {
    try {
      await prisma.auditLog.create({
        data: {
          actorUserId: null,
          action: 'admin.rag.ingest-plant.failed',
          resource: `Plant/${plantId}`,
        },
      });
    } catch {
      /* ignore */
    }
    console.warn(
      `[rag-ingest] failed for plant ${plantId}: ${(err as Error).message}`,
    );
  });
}

/**
 * Catch-up reconcile: scan for plants whose RagDocument is older than
 * the plant's own updatedAt and re-ingest just those. Runs once at
 * admin bootstrap (after a restart while writes were happening) and on
 * a 6-hour timer thereafter as a belt-and-braces guard against hook
 * misses (direct DB edits, failed extension calls, …).
 *
 * Idempotent: ingestPlantIntoRag hashes the body before re-embedding,
 * so even an over-eager reconcile costs only a few DB reads.
 */
export async function reconcilePlantRagDocuments(
  prisma: PrismaClient,
): Promise<{ scanned: number; reingested: number }> {
  const PAGE = 200;
  let scanned = 0;
  let reingested = 0;
  let cursor: string | undefined = undefined;
  for (;;) {
    const batch: Array<{ id: string; slug: string; updatedAt: Date }> =
      await prisma.plant.findMany({
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        select: { id: true, slug: true, updatedAt: true },
      });
    if (batch.length === 0) break;
    scanned += batch.length;
    const titles = batch.map((p) => `__plant__:${p.slug}`);
    // One round-trip per page to fetch existing RagDocument timestamps.
    const docs = await prisma.ragDocument.findMany({
      where: { title: { in: titles }, locale: 'en' as any },
      select: { title: true, updatedAt: true },
    });
    const docByTitle = new Map(docs.map((d) => [d.title, d.updatedAt]));
    for (const p of batch) {
      const docTs = docByTitle.get(`__plant__:${p.slug}`);
      // No doc OR doc older than the plant row → re-ingest. Give the
      // hook a tiny tolerance so a same-second update doesn't churn.
      if (!docTs || docTs.getTime() < p.updatedAt.getTime() - 1000) {
        ingestPlantIntoRagAsync(prisma, p.id);
        reingested++;
      }
    }
    if (batch.length < PAGE) break;
    cursor = batch[batch.length - 1]!.id;
  }
  obs.info('rag', `reconcile pass: scanned ${scanned}, re-ingested ${reingested}`);
  return { scanned, reingested };
}
