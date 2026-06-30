/**
 * One-off trigger: push an immediate job onto the live `instagram-sync` queue
 * so the running worker fetches + caches the public feed now (instead of waiting
 * for the next 6-hourly cron tick). Run inside the api-worker container.
 */
import { Queue } from 'bullmq';

async function main() {
  const q = new Queue('instagram-sync', {
    connection: { url: process.env.REDIS_URL ?? 'redis://redis:6379' },
  });
  const job = await q.add('manual', {}, { removeOnComplete: true, removeOnFail: 20 });
  console.log('[ig-enqueue] enqueued job', job.id);
  await q.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('[ig-enqueue] error', e);
  process.exit(1);
});
