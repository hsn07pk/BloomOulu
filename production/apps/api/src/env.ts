/**
 * Loads .env BEFORE any other module runs (so module-level `const X =
 * process.env.Y ?? default` evaluations see the right values).
 *
 * Search order:
 *   1. ./.env                                — current working directory
 *   2. ../../.env                            — monorepo root from apps/api/
 *   3. $BLOOMOULU_REPO_ROOT/.env             — explicit override
 *
 * The first file that exists wins. Existing process.env values take
 * precedence over .env so docker/k8s injection still works.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile(path: string): void {
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      // Strip matched surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    /* ignore */
  }
}

const candidates = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '..', '..', '.env'),
  process.env.BLOOMOULU_REPO_ROOT ? resolve(process.env.BLOOMOULU_REPO_ROOT, '.env') : '',
].filter(Boolean);

for (const p of candidates) {
  if (existsSync(p)) {
    loadEnvFile(p);
    break;
  }
}
