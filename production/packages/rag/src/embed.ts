import { request } from 'undici';

const OLLAMA_BASE = process.env.OLLAMA_URL ?? process.env.OLLAMA_BASE_URL ?? 'http://ollama:11434';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? process.env.EMBED_MODEL ?? 'nomic-embed-text:v1.5';

export async function embed(text: string): Promise<number[]> {
  const res = await request(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (res.statusCode >= 300) {
    throw new Error(`Ollama embed ${res.statusCode}: ${await res.body.text()}`);
  }
  const json = (await res.body.json()) as { embedding: number[] };
  return json.embedding;
}
