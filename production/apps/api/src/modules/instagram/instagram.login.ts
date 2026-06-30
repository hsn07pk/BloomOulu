/**
 * Credential-based Instagram provider. Logs in with IG_USERNAME / IG_PASSWORD
 * to obtain a session cookie, caches it (SystemSetting `instagram.session`) so
 * we don't re-login every sync — repeated logins trip Instagram's "suspicious
 * login" checkpoint — and reads the user's media via the authenticated
 * web_profile_info endpoint. curl-based (undici is TLS-fingerprinted + 429'd).
 *
 * This drives Instagram's PRIVATE web endpoints with a real login, which is
 * outside Instagram's official API terms — prefer the Graph API (token) when
 * available. The first login from a new server IP may require confirming a
 * "suspicious login attempt" email on the account. Any failure throws, so the
 * source chain falls back to the public scraper.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@bloomoulu/db';
import {
  igCurlGet,
  parseProfileJson,
  IG_APP_ID,
  IG_BROWSER_UA,
  type ParsedPost,
} from './instagram.source.js';

const execFileAsync = promisify(execFile);
const SESSION_KEY = 'instagram.session';

async function curl(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('curl', args, { timeout: 25_000, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

/** Read a cookie value out of a curl Netscape cookie jar (tab-separated). */
function jarValue(jar: string, name: string): string | null {
  for (const raw of jar.split('\n')) {
    if (!raw || (raw.startsWith('#') && !raw.startsWith('#HttpOnly_'))) continue;
    const p = raw.replace(/^#HttpOnly_/, '').split('\t');
    if (p.length >= 7 && p[5] === name) return p[6]!;
  }
  return null;
}

async function readSession(): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ value: unknown }>>`
    SELECT value FROM "SystemSetting" WHERE key = ${SESSION_KEY} LIMIT 1`;
  const v = rows[0]?.value;
  return typeof v === 'string' ? v : null;
}
async function writeSession(jar: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "SystemSetting" (key, value) VALUES (${SESSION_KEY}, ${JSON.stringify(jar)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`;
}

function profileApiUrl(handle: string): string {
  return `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
}

/** Fetch the profile with whatever session the jar currently holds. */
async function authedFetch(jarFile: string, handle: string, max: number): Promise<ParsedPost[] | null> {
  const jar = await readFile(jarFile, 'utf8').catch(() => '');
  const sessionid = jarValue(jar, 'sessionid');
  if (!sessionid) return null;
  const csrf = jarValue(jar, 'csrftoken') ?? '';
  const { status, body } = await igCurlGet(profileApiUrl(handle), [
    `cookie: sessionid=${sessionid}; csrftoken=${csrf}`,
  ]);
  if (status !== 200) return null;
  try {
    return parseProfileJson(JSON.parse(body), max);
  } catch {
    return null;
  }
}

/** Perform a fresh web login, leaving the session cookies in `jarFile`. */
async function login(jarFile: string, username: string, password: string): Promise<void> {
  // 1. Prime csrftoken / mid / ig_did cookies.
  await curl([
    '-sS', '--max-time', '20', '-o', '/dev/null',
    '-c', jarFile, '-b', jarFile,
    '-H', `user-agent: ${IG_BROWSER_UA}`,
    'https://www.instagram.com/accounts/login/',
  ]);
  const csrf = jarValue(await readFile(jarFile, 'utf8').catch(() => ''), 'csrftoken') ?? 'missing';

  // 2. Login POST. enc_password version 0 = time-tagged plaintext over TLS.
  const ts = Math.floor(Date.now() / 1000);
  const encPassword = `#PWD_INSTAGRAM_BROWSER:0:${ts}:${password}`;
  const form =
    `username=${encodeURIComponent(username)}` +
    `&enc_password=${encodeURIComponent(encPassword)}` +
    `&queryParams=%7B%7D&optIntoOneTap=false`;
  const out = await curl([
    '-sS', '--max-time', '25',
    '-c', jarFile, '-b', jarFile, '-X', 'POST',
    '-H', `user-agent: ${IG_BROWSER_UA}`,
    '-H', `x-csrftoken: ${csrf}`,
    '-H', `x-ig-app-id: ${IG_APP_ID}`,
    '-H', 'x-requested-with: XMLHttpRequest',
    '-H', 'content-type: application/x-www-form-urlencoded',
    '-H', 'referer: https://www.instagram.com/accounts/login/',
    '--data-raw', form,
    'https://www.instagram.com/api/v1/web/accounts/login/ajax/',
  ]);
  let res: any = {};
  try {
    res = JSON.parse(out);
  } catch {
    /* non-JSON body → treated as failure below */
  }
  if (!res.authenticated) {
    const reason = res.checkpoint_url
      ? 'checkpoint_required (confirm the login on the account, then retry)'
      : res.two_factor_required
        ? 'two_factor_required'
        : res.message || res.error_type || 'invalid_credentials_or_blocked';
    throw new Error(reason);
  }
}

export async function fetchViaLogin(handle: string, max: number): Promise<ParsedPost[]> {
  const username = process.env.IG_USERNAME!.trim();
  const password = process.env.IG_PASSWORD!;
  const jarFile = join(tmpdir(), `ig-${randomUUID()}.jar`);
  try {
    // 1. Reuse a cached session if it still works (avoids re-login per sync).
    const cached = await readSession();
    if (cached) {
      await writeFile(jarFile, cached, 'utf8').catch(() => {});
      const viaCache = await authedFetch(jarFile, handle, max);
      if (viaCache && viaCache.length) return viaCache;
    }
    // 2. Otherwise (re)login, cache the fresh session, then fetch.
    await login(jarFile, username, password);
    const fresh = await readFile(jarFile, 'utf8').catch(() => '');
    if (fresh) await writeSession(fresh);
    const posts = await authedFetch(jarFile, handle, max);
    if (posts && posts.length) return posts;
    throw new Error('authed fetch returned no posts');
  } finally {
    await unlink(jarFile).catch(() => {});
  }
}
