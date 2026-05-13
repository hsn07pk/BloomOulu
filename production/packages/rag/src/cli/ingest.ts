#!/usr/bin/env tsx
/**
 * Corpus ingest CLI.
 *
 *   pnpm rag:ingest [--path corpus/] [--reset]
 *
 * Walks a directory of Markdown files (curator notes, the phenology log, the
 * LIFE+ ESCAPE report, peer-reviewed papers in extracted text form) and:
 *
 *   1. Computes a sha256 of each file's body.
 *   2. Upserts a RagDocument row.
 *   3. If the body changed, splits → embeds → inserts RagChunk rows.
 *   4. --reset wipes the corpus first (use with care).
 *
 * Idempotent: re-running with no changes is a no-op.
 */
import { prisma } from '@bloomoulu/db';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { chunkText } from '../chunk.js';
import { embed } from '../embed.js';

interface Args {
  path: string;
  reset: boolean;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args: Args = { path: 'corpus', reset: false, dryRun: false };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i]!;
    if (v === '--path') args.path = process.argv[++i]!;
    else if (v === '--reset') args.reset = true;
    else if (v === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (p.endsWith('.md')) yield p;
  }
}

function localeFromPath(p: string): 'en' | 'fi' | 'sv' {
  if (p.includes('/fi/') || p.endsWith('.fi.md')) return 'fi';
  if (p.includes('/sv/') || p.endsWith('.sv.md')) return 'sv';
  return 'en';
}

async function main() {
  const args = parseArgs();
  if (args.reset) {
    console.log('Wiping existing RagDocument + RagChunk rows…');
    if (!args.dryRun) {
      await prisma.ragChunk.deleteMany();
      await prisma.ragDocument.deleteMany();
    }
  }
  let docsTouched = 0, chunksInserted = 0;
  for await (const path of walk(args.path)) {
    const body = await readFile(path, 'utf-8');
    const title = path.split('/').pop()!.replace(/\.md$/, '');
    const locale = localeFromPath(path);
    const bodyHash = createHash('sha256').update(body).digest('hex');

    const existing = await prisma.ragDocument.findFirst({ where: { title, locale } });
    if (existing?.bodyHash === bodyHash) continue;

    if (args.dryRun) {
      console.log(`DRY [${locale}] ${title} (${(body.length / 1024).toFixed(1)} KB)`);
      continue;
    }

    const doc = await prisma.ragDocument.upsert({
      where: { title_locale: { title, locale } },
      create: { title, locale, body, bodyHash, isPublished: true },
      update: { body, bodyHash, isPublished: true },
    });
    await prisma.ragChunk.deleteMany({ where: { documentId: doc.id } });
    const chunks = chunkText(body);
    let idx = 0;
    for (const c of chunks) {
      const e = await embed(c);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "RagChunk" (id, "documentId", "chunkIndex", text, "tokenStart", "tokenEnd", locale, embedding, "createdAt")
         VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6::"Locale", $7::vector, now())`,
        doc.id,
        idx,
        c,
        idx * 450,
        (idx + 1) * 450,
        locale,
        `[${e.join(',')}]`,
      );
      idx++;
      chunksInserted++;
    }
    docsTouched++;
    console.log(`  ${title} (${locale}) → ${chunks.length} chunks`);
  }
  console.log(`Done. Touched ${docsTouched} document(s), inserted ${chunksInserted} chunk(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
