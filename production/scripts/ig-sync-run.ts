/** Run the real Instagram sync processor once, synchronously (fetch → cache
 *  thumbnails → upsert InstagramPost). Run with the api src + storage volume
 *  mounted so it writes the same rows/files the 6h cron would. */
import { processInstagramSync } from '/app/apps/api/src/modules/jobs/processors/instagram-sync.processor.js';

async function main() {
  const res = await processInstagramSync({ data: {}, id: 'manual', name: 'sync' } as never);
  console.log('[ig-sync-run]', JSON.stringify(res));
}
main().then(() => process.exit(0)).catch((e) => {
  console.error('[ig-sync-run] ERR', (e as Error)?.message ?? e);
  process.exit(1);
});
