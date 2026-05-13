import { request } from 'undici';

const RERANKER_BASE = process.env.RERANKER_BASE_URL ?? 'http://reranker:8080';

export interface RerankResult { index: number; score: number }

export async function rerank(query: string, texts: string[]): Promise<RerankResult[]> {
  const res = await request(`${RERANKER_BASE}/rerank`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, texts, truncate: true }),
  });
  if (res.statusCode >= 300) {
    // Fall back to identity ranking so the caller can still proceed.
    return texts.map((_, i) => ({ index: i, score: 1 - i * 0.01 }));
  }
  return (await res.body.json()) as RerankResult[];
}
