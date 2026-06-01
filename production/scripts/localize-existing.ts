#!/usr/bin/env tsx
/**
 * Migrate already-stored external plant photos to the source+local model.
 *
 *   pnpm tsx scripts/localize-existing.ts [--limit N] [--dry-run]
 *
 * For every PlantImage whose `url` is still an external http(s) host
 * (Wikimedia Commons, iNaturalist) and has no `sourceUrl` yet, we:
 *   1. record the upstream URL in `sourceUrl` (kept forever — the file
 *      server falls back to it whenever the local copy is absent, so the
 *      front end is never image-less),
 *   2. download the bytes into local storage via hostPlantImage(),
 *   3. point `url` at the stable local key `/v1/files/plant-images/<id>.<ext>`.
 *
 * If the download fails the row still gets `sourceUrl` + a stable `url`,
 * so the /v1/files route 302s to source and a re-run retries the cache.
 *
 * Dead hosts (the retired localhost:9000 MinIO dev backend) are skipped:
 * their bytes are gone and there's no recoverable source — those rows are
 * deleted + re-fetched from upstream by enrich-images.ts instead.
 *
 * Idempotent + resumable: a row with `sourceUrl` already set is excluded,
 * so re-runs only touch the stragglers. Reuses hostPlantImage so it can't
 * drift from the live hosting path.
 */
import { PrismaClient } from '@prisma/client';
import { setTimeout as sleep } from 'node:timers/promises';
import { hostPlantImage } from '../apps/api/src/modules/enrichment/image-store.js';

const prisma = new PrismaClient();

function guessExt(url: string): string {
  const m = url.toLowerCase().match(/\.(jpe?g|png|webp|gif)(?:[?#]|$)/);
  return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]!) : 'jpg';
}

interface CliArgs {
  limit: number;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const out: CliArgs = { limit: Infinity, dryRun: false };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i]!;
    if (v === '--limit') out.limit = parseInt(process.argv[++i]!, 10);
    else if (v === '--dry-run') out.dryRun = true;
  }
  if (Number.isNaN(out.limit)) out.limit = Infinity;
  return out;
}

async function main() {
  const args = parseArgs();
  // Un-migrated external rows: an http(s) host that isn't the dead dev
  // MinIO, with no sourceUrl recorded yet.
  const rows = await prisma.plantImage.findMany({
    where: {
      sourceUrl: null,
      url: { startsWith: 'http' },
      NOT: [{ url: { contains: 'localhost:9000' } }],
    },
    select: { id: true, url: true },
    orderBy: { id: 'asc' },
  });
  const target = rows.slice(0, args.limit);
  console.log(
    `${rows.length} external rows to migrate · processing ${target.length}` +
      `${args.dryRun ? ' (DRY RUN — no writes)' : ''}.\n`,
  );
  if (target.length === 0) {
    console.log('Nothing to do — every image already has sourceUrl + a local key.');
    return;
  }

  let migrated = 0;
  let cached = 0;
  let fallback = 0;
  for (let i = 0; i < target.length; i++) {
    const row = target[i]!;
    const n = i + 1;
    const source = row.url;
    if (args.dryRun) {
      console.log(`[${n}/${target.length}] DRY ${row.id} ${source.slice(0, 90)}`);
      continue;
    }
    try {
      const hosted = await hostPlantImage(source, row.id);
      const serveUrl = hosted ?? `/v1/files/plant-images/${row.id}.${guessExt(source)}`;
      await prisma.plantImage.update({
        where: { id: row.id },
        data: { sourceUrl: source, url: serveUrl },
      });
      migrated++;
      if (hosted) cached++;
      else fallback++;
      if (n % 50 === 0 || n === target.length) {
        console.log(
          `[${n}/${target.length}] migrated=${migrated} (cached=${cached} source-fallback=${fallback})`,
        );
      }
    } catch (err) {
      console.error(`[${n}/${target.length}] ! ${row.id} — ${(err as Error)?.message ?? String(err)}`);
    }
    await sleep(Number(process.env.IMG_DELAY_MS ?? 800));
  }

  console.log(
    `\nDone. processed=${target.length} migrated=${migrated} cached-locally=${cached} source-fallback=${fallback}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
