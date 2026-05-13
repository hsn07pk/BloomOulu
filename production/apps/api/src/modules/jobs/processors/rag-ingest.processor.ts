/**
 * RAG corpus ingest job.
 *
 * For each RagDocument whose bodyHash differs from the stored hash (i.e. body
 * changed since last ingest), we:
 *   1. Delete its old RagChunk rows
 *   2. Split body into ~500-token chunks with 50-token overlap
 *   3. Embed each chunk via Ollama /api/embeddings (nomic-embed-text:v1.5)
 *   4. Insert RagChunk rows with embedding vector(1024)
 *
 * Idempotent: rerunning over an unchanged document is a no-op.
 */
import type { Job } from 'bullmq';
import { request } from 'undici';
import { prisma } from '@bloomoulu/db';
import { createHash } from 'node:crypto';

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? 'http://ollama:11434';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'nomic-embed-text:v1.5';

export interface RagIngestJob {
  documentId?: string; // omit → reindex all
}

export async function processRagIngest(job: Job<RagIngestJob>) {
  const docs = job.data.documentId
    ? await prisma.ragDocument.findMany({ where: { id: job.data.documentId } })
    : await prisma.ragDocument.findMany({ where: { isPublished: true } });

  let processed = 0;
  for (const doc of docs) {
    const fresh = createHash('sha256').update(doc.body).digest('hex');
    if (fresh === doc.bodyHash && !job.data.documentId) continue; // unchanged

    await prisma.ragChunk.deleteMany({ where: { documentId: doc.id } });
    const chunks = chunkText(doc.body, 500, 50);
    let idx = 0;
    for (const chunk of chunks) {
      const embedding = await embed(chunk);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "RagChunk" (id, "documentId", "chunkIndex", text, "tokenStart", "tokenEnd", locale, embedding, "createdAt")
         VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6::"Locale", $7::vector, now())`,
        doc.id,
        idx,
        chunk,
        idx * 450,
        (idx + 1) * 450,
        doc.locale,
        `[${embedding.join(',')}]`,
      );
      idx++;
    }
    await prisma.ragDocument.update({
      where: { id: doc.id },
      data: { bodyHash: fresh },
    });
    processed++;
  }
  return { processed };
}

function chunkText(text: string, size: number, overlap: number): string[] {
  // Token-approx chunker using whitespace. For production-grade splitting use
  // a tokenizer (tiktoken / @huggingface/tokenizers); ~4 chars-per-token is
  // a workable approximation for Finnish + English.
  const words = text.split(/\s+/);
  const out: string[] = [];
  let i = 0;
  const step = Math.max(1, size - overlap);
  while (i < words.length) {
    out.push(words.slice(i, i + size).join(' '));
    i += step;
  }
  return out;
}

async function embed(text: string): Promise<number[]> {
  const res = await request(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  const json = (await res.body.json()) as { embedding: number[] };
  return json.embedding;
}
