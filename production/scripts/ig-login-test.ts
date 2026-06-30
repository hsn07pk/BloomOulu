/** Smoke-test the credential-login provider against the real account. Reads
 *  IG_USERNAME / IG_PASSWORD from the environment (never args). Run with the
 *  api src mounted. Reports whether the login succeeds, checkpoints, or fails. */
import { fetchViaLogin } from '/app/apps/api/src/modules/instagram/instagram.login.js';

async function main() {
  const t0 = Date.now();
  const posts = await fetchViaLogin(process.env.IG_TEST_HANDLE ?? 'oulubotgarden', 6);
  console.log(`[ig-login-test] LOGIN OK — ${posts.length} posts in ${Date.now() - t0}ms`);
  for (const p of posts.slice(0, 2)) console.log('  -', p.shortcode, '|', (p.caption ?? '').slice(0, 40));
}
main().then(() => process.exit(0)).catch((e) => {
  console.error('[ig-login-test] FAILED:', (e as Error)?.message ?? e);
  process.exit(1);
});
