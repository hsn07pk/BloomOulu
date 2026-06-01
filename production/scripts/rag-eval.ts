#!/usr/bin/env tsx
/**
 * RAG accuracy eval — AskTheGarden vs the DB as ground truth.
 *
 *   pnpm tsx scripts/rag-eval.ts [--n 100] [--api http://api:4000] [--out /data/storage/rag-eval.jsonl]
 *
 * Samples plants that are actually in the RAG corpus (have a published
 * RagDocument), asks /v1/ask a factual question whose answer is a known DB
 * value, and checks the model's answer against that value. Three fact
 * families, each with documented matching rules:
 *
 *   • family        — Taxon.family (high precision: exact family token,
 *                     with the handful of botanical synonyms accepted)
 *   • conservation  — Plant.redListStatus (code word OR the spelled-out
 *                     IUCN category)
 *   • commonName    — Plant.nameEn (lenient: any significant name token)
 *
 * Reports overall + per-category accuracy and answer latency, prints a few
 * example misses, and writes a full JSONL transcript for inspection. Read
 * only — never writes to the catalogue.
 */
import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'node:fs';

const prisma = new PrismaClient();

function argVal(flag: string, def: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? def) : def;
}
const N = Number.parseInt(argVal('--n', '100'), 10);
const API = argVal('--api', 'http://api:4000').replace(/\/$/, '');
const OUT = argVal('--out', '/data/storage/rag-eval.jsonl');

type Category = 'family' | 'conservation' | 'commonName';
interface Q {
  category: Category;
  plantId: string;
  latin: string;
  slug: string;
  question: string;
  truth: string; // human-readable ground truth
  match: (answer: string) => boolean;
}

// Botanical family synonyms — accept either name so a corpus that stores
// "Asteraceae" isn't marked wrong when the model says "Compositae".
const FAMILY_SYNONYMS: Record<string, string[]> = {
  asteraceae: ['compositae'],
  compositae: ['asteraceae'],
  fabaceae: ['leguminosae', 'papilionaceae'],
  leguminosae: ['fabaceae'],
  poaceae: ['gramineae'],
  gramineae: ['poaceae'],
  apiaceae: ['umbelliferae'],
  umbelliferae: ['apiaceae'],
  brassicaceae: ['cruciferae'],
  cruciferae: ['brassicaceae'],
  lamiaceae: ['labiatae'],
  labiatae: ['lamiaceae'],
  clusiaceae: ['guttiferae'],
  arecaceae: ['palmae'],
};

const RED_LIST_WORDS: Record<string, RegExp> = {
  LC: /least concern|\bLC\b/i,
  NT: /near[- ]threatened|\bNT\b/i,
  VU: /vulnerable|\bVU\b/i,
  EN: /endangered|\bEN\b/i,
  CR: /critically endangered|\bCR\b/i,
  EX: /extinct|\bEX\b/i,
  DD: /data deficient|\bDD\b/i,
  NA: /not applicable|not evaluated|\bNA\b/i,
};

const STOPWORDS = new Set([
  'the', 'and', 'common', 'plant', 'tree', 'flower', 'grass', 'wild', 'true',
  'false', 'garden', 'great', 'lesser', 'european', 'finnish',
]);

function familyMatch(family: string) {
  const fam = family.toLowerCase();
  const accepted = [fam, ...(FAMILY_SYNONYMS[fam] ?? [])];
  return (answer: string) => {
    const a = answer.toLowerCase();
    return accepted.some((f) => a.includes(f));
  };
}

function commonNameMatch(nameEn: string) {
  const tokens = nameEn
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  // If the name is all stopwords/short (e.g. "Yew"), fall back to the
  // whole lowercased name.
  const needles = tokens.length > 0 ? tokens : [nameEn.toLowerCase()];
  return (answer: string) => {
    const a = answer.toLowerCase();
    return needles.some((t) => a.includes(t));
  };
}

/** Plants present in the published corpus, with the fields we need. */
async function corpusPlants(limit: number) {
  // RagDocument.title is either the bare slug or `__plant__:<slug>`.
  return prisma.$queryRawUnsafe<
    Array<{
      id: string;
      slug: string;
      nameEn: string;
      redListStatus: string;
      latinName: string;
      family: string;
    }>
  >(
    `SELECT p.id, p.slug, p."nameEn", p."redListStatus"::text AS "redListStatus",
            t."latinName", t.family
       FROM "Plant" p
       JOIN "Taxon" t ON t.id = p."taxonId"
      WHERE p.status = 'active'
        AND t.family IS NOT NULL AND t.family <> ''
        AND EXISTS (
          SELECT 1 FROM "RagDocument" d
           WHERE d."isPublished" = true
             AND (d.title = p.slug OR d.title = '__plant__:' || p.slug)
        )
      ORDER BY random()
      LIMIT ${limit}`,
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function askOnce(
  question: string,
): Promise<{ text: string; intent: string; escalated: boolean; model: string; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${API}/v1/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, locale: 'en' }),
  });
  const ms = Date.now() - t0;
  if (!res.ok)
    return { text: `__HTTP_${res.status}__`, intent: 'error', escalated: false, model: 'http_error', ms };
  const j = (await res.json()) as {
    text?: string;
    intent?: string;
    escalated?: boolean;
    modelUsed?: string;
  };
  return {
    text: j.text ?? '',
    intent: j.intent ?? '',
    escalated: Boolean(j.escalated),
    model: j.modelUsed ?? '',
    ms,
  };
}

// Groq free tier caps tokens-per-minute (8b-instant: 6k TPM); a burst 429s
// with modelUsed `escalation:llm_unavailable`. That's an infra limit, not a
// RAG miss — so when we see it, wait out the minute and retry once so the
// recall number reflects retrieval quality, not rate-limiting noise.
const DELAY_MS = Number(argVal('--delay', '13000'));
async function ask(question: string) {
  let r = await askOnce(question);
  if (r.model.includes('llm_unavailable')) {
    await sleep(30_000);
    r = await askOnce(question);
  }
  return r;
}

function noAnswer(text: string): boolean {
  const a = text.toLowerCase();
  return (
    text.startsWith('__HTTP_') ||
    /don't have|do not have|no information|not have (that|any) info|couldn't find|cannot find|unable to/.test(a)
  );
}

async function main() {
  console.log(`RAG eval — n=${N}, api=${API}`);
  const pool = await corpusPlants(Math.max(N, 60));
  if (pool.length === 0) {
    console.log('No corpus-backed plants found — is the RAG corpus ingested?');
    return;
  }

  // Split N across the three categories. Conservation only uses plants with
  // a meaningful (non NA/DD) status; commonName only where nameEn looks like
  // a real common name (not just the Latin binomial).
  const nFamily = Math.round(N * 0.5);
  const nConsv = Math.round(N * 0.3);
  const nName = N - nFamily - nConsv;

  const qs: Q[] = [];
  const used = new Set<string>();
  const take = (pred: (p: (typeof pool)[number]) => boolean, count: number, make: (p: (typeof pool)[number]) => Q) => {
    let added = 0;
    for (const p of pool) {
      if (added >= count) break;
      if (used.has(p.id) || !pred(p)) continue;
      used.add(p.id);
      qs.push(make(p));
      added++;
    }
    return added;
  };

  take(() => true, nFamily, (p) => ({
    category: 'family',
    plantId: p.id,
    latin: p.latinName,
    slug: p.slug,
    question: `What plant family does ${p.latinName} belong to? Reply with the scientific family name.`,
    truth: p.family,
    match: familyMatch(p.family),
  }));

  take((p) => !['NA', 'DD'].includes(p.redListStatus), nConsv, (p) => ({
    category: 'conservation',
    plantId: p.id,
    latin: p.latinName,
    slug: p.slug,
    question: `What is the IUCN / Finnish Red List conservation category of ${p.latinName}?`,
    truth: p.redListStatus,
    match: (a) => (RED_LIST_WORDS[p.redListStatus] ?? /$^/).test(a),
  }));

  take(
    (p) => p.nameEn.toLowerCase() !== p.latinName.toLowerCase() && /[a-z]/.test(p.nameEn),
    nName,
    (p) => ({
      category: 'commonName',
      plantId: p.id,
      latin: p.latinName,
      slug: p.slug,
      question: `What is the common English name of the plant ${p.latinName}?`,
      truth: p.nameEn,
      match: commonNameMatch(p.nameEn),
    }),
  );

  console.log(`Prepared ${qs.length} questions (family/conservation/commonName).\n`);

  const results: any[] = [];
  type Cell = { correct: number; wrong: number; noans: number; infra: number; total: number };
  const tally: Record<Category, Cell> = {
    family: { correct: 0, wrong: 0, noans: 0, infra: 0, total: 0 },
    conservation: { correct: 0, wrong: 0, noans: 0, infra: 0, total: 0 },
    commonName: { correct: 0, wrong: 0, noans: 0, infra: 0, total: 0 },
  };
  const latencies: number[] = [];
  const misses: any[] = [];

  for (let i = 0; i < qs.length; i++) {
    const q = qs[i]!;
    const { text, intent, escalated, model, ms } = await ask(q.question);
    latencies.push(ms);
    // Persistent llm_unavailable = Groq rate limit, not a retrieval miss;
    // bucket it separately so it doesn't distort recall.
    const infra = model.includes('llm_unavailable') || text.startsWith('__HTTP_');
    const isNo = !infra && (noAnswer(text) || escalated);
    const ok = !infra && !isNo && q.match(text);
    const verdict = infra ? 'infra' : isNo ? 'noans' : ok ? 'correct' : 'wrong';
    tally[q.category][verdict]++;
    tally[q.category].total++;
    results.push({ ...q, match: undefined, answer: text, intent, escalated, model, ms, verdict });
    if (verdict !== 'correct' && verdict !== 'infra' && misses.length < 15) {
      misses.push({ category: q.category, latin: q.latin, truth: q.truth, verdict, answer: text.slice(0, 160) });
    }
    if ((i + 1) % 5 === 0 || i === qs.length - 1) {
      console.log(`  [${i + 1}/${qs.length}] ${q.category} · ${q.latin} → ${verdict} (${ms}ms)`);
    }
    if (i < qs.length - 1) await sleep(DELAY_MS);
  }

  await fs.writeFile(OUT, results.map((r) => JSON.stringify(r)).join('\n') + '\n').catch(() => {});

  const pct = (a: number, b: number) => (b === 0 ? '—' : `${((100 * a) / b).toFixed(1)}%`);
  let totC = 0, totW = 0, totN = 0, totI = 0, tot = 0;
  console.log('\n=== Accuracy by category (recall = correct / answerable, excluding infra) ===');
  for (const cat of ['family', 'conservation', 'commonName'] as Category[]) {
    const t = tally[cat];
    totC += t.correct; totW += t.wrong; totN += t.noans; totI += t.infra; tot += t.total;
    const answerable = t.total - t.infra;
    console.log(
      `  ${cat.padEnd(13)} recall ${t.correct}/${answerable} (${pct(t.correct, answerable)})` +
        `  wrong ${t.wrong}  escalated ${t.noans}  infra ${t.infra}`,
    );
  }
  const ans = tot - totI;
  console.log(
    `  ${'OVERALL'.padEnd(13)} recall ${totC}/${ans} (${pct(totC, ans)})  wrong ${totW}  escalated ${totN}  infra ${totI}`,
  );

  latencies.sort((a, b) => a - b);
  const p = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] ?? 0;
  const avg = Math.round(latencies.reduce((s, x) => s + x, 0) / Math.max(1, latencies.length));
  console.log(`\n=== Latency === avg ${avg}ms · p50 ${p(0.5)}ms · p90 ${p(0.9)}ms · p99 ${p(0.99)}ms · max ${latencies[latencies.length - 1]}ms`);
  console.log(`  under 5s: ${pct(latencies.filter((x) => x <= 5000).length, latencies.length)}`);

  if (misses.length > 0) {
    console.log('\n=== Example misses ===');
    for (const m of misses) {
      console.log(`  [${m.category}] ${m.latin} — truth=${m.truth} verdict=${m.verdict}\n      "${m.answer}"`);
    }
  }
  console.log(`\nFull transcript: ${OUT}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
