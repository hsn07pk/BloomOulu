import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { fetchInstagramProfile } from '../../instagram/instagram.source.js';
import { cacheThumbnail } from '../../instagram/instagram-cache.js';
import { getInstagramConfig, setLastSynced } from '../../instagram/instagram.config.js';

/**
 * Refresh the cached live Instagram posts. Best-effort: on any failure we
 * log + return { ok:false } and leave the existing rows intact so the public
 * band keeps showing last-good content. Never throws.
 */
export async function processInstagramSync(
  _job: Job,
): Promise<{ ok: boolean; synced: number; pruned: number; skipped?: boolean }> {
  const { handle, enabled } = await getInstagramConfig();
  if (!enabled) return { ok: true, synced: 0, pruned: 0, skipped: true };

  let posts;
  try {
    posts = await fetchInstagramProfile(handle, { max: 12 });
  } catch (err) {
    console.warn(`[instagram-sync] fetch failed for @${handle}: ${(err as Error).message}`);
    return { ok: false, synced: 0, pruned: 0 };
  }

  const fetchedShortcodes = posts.map((p) => p.shortcode);
  let synced = 0;
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i]!;
    const imageUrl = await cacheThumbnail(p.displayUrl, p.shortcode);
    if (!imageUrl) continue; // keep any prior row for this shortcode
    await prisma.instagramPost.upsert({
      where: { shortcode: p.shortcode },
      create: {
        shortcode: p.shortcode,
        caption: p.caption,
        takenAt: new Date(p.takenAt),
        mediaType: p.mediaType,
        imageUrl,
        permalink: p.permalink,
        displayOrder: i,
        isFallback: false,
      },
      update: {
        caption: p.caption,
        takenAt: new Date(p.takenAt),
        mediaType: p.mediaType,
        imageUrl,
        permalink: p.permalink,
        displayOrder: i,
      },
    });
    synced++;
  }

  // Prune live rows that disappeared from the profile (guard: only if fetch returned posts).
  let pruned = 0;
  if (posts.length > 0) {
    const res = await prisma.instagramPost.deleteMany({
      where: { isFallback: false, shortcode: { notIn: fetchedShortcodes } },
    });
    pruned = res.count;
  }

  await setLastSynced(new Date().toISOString());
  return { ok: true, synced, pruned };
}
