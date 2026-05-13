# ADR-0005: RAG Pipeline + Citation Contract

**Status:** Accepted
**Date:** 2026-05-13

## Context

"AskTheGarden" must answer in FI / SV / EN and **must** cite. The pitch promised "grounded, cited, never hallucinated" — that's not a marketing line, it's a contract. We enforce it in code:

> **If retrieval returns zero chunks with similarity ≥ 0.72, the LLM is not called. Instead we emit the `escalate_to_curator` template, ask the visitor to leave their question, and route to the curator queue.**

## Decision

### Corpus

Three document types, all stored as Markdown:

1. **Accession care notes** — exported from the University DB, one per accession.
2. **LIFE+ ESCAPE final report** + peer-reviewed papers — PDFs converted with `pdfminer` + manual cleanup, attributed to a `Citation` row.
3. **Phenology log** — a weekly markdown file the curator maintains.

### Ingest

`packages/rag/ingest/` is a job:

1. Walks the corpus.
2. Splits into ~500-token chunks with 50-token overlap (semantic-aware splitter from `llama-index-core` ports, not raw character count).
3. Calls Mistral `mistral-embed` → 1024-dim vectors.
4. Upserts to `RagChunk` keyed by `(documentId, chunkIndex)`.

The job is idempotent and runs nightly + on-demand on `git push` to a `corpus/` branch.

### Retrieval

For a question Q in locale L:

1. Translate Q to canonical English if L≠EN (keeping the original for response generation).
2. Embed canonical-EN Q with `mistral-embed`.
3. `SELECT id, document_id, text, 1 - (embedding <=> $1) AS score FROM rag_chunk WHERE locale IN (L, 'en') ORDER BY embedding <=> $1 LIMIT 12`.
4. Re-rank top-12 with a cross-encoder (Cohere Rerank EU) → top-5.
5. If `top1.score < 0.72`: short-circuit to escalation path.

### Generation

System prompt template (`packages/rag/prompts/system.fi.md` + en + sv):

```
You are AskTheGarden, the conservation assistant of the University of Oulu
Botanical Garden. You answer ONLY using the provided context. Every claim
MUST be followed by an inline citation marker [c1], [c2], ... that maps to
the numbered context entries below. If the context does not contain enough
to answer, say so plainly and offer to forward the question to a curator.
Respond in {LOCALE}. Keep answers under 120 words unless explicitly asked.
```

The generated answer is post-validated:

- Every `[cN]` marker must reference a chunk that was in the retrieved set.
- Markers must appear; an unmarked answer is rejected and regenerated once with `temperature=0.2`.
- We never expose raw chunk text — only the public document's `displayTitle + page` for the citation chip.

### Off-topic guardrail

A lightweight intent classifier (small Mistral with a few-shot prompt + zod-validated JSON) tags each question as `{ on_topic, off_topic, harmful }`. Off-topic → polite redirect. Harmful (rare) → audit-logged + escalated.

### Telemetry

Every Q/A persists `AskMessage` + `AskAnswer` rows including retrieved chunk IDs, scores, latency, and the donor reaction emoji. This is our ground truth for the **monthly RAG eval**: a curator labels the previous month's bottom-50-score answers; the labels feed back into the ingest job's chunking heuristics.

## Consequences

**Positive**

- The citation contract is enforced *in code*, not by hope.
- Latency budget: embed (60ms) + retrieve (30ms) + rerank (180ms) + generate (1.1s streamed) = first-token in ~1.4s, well under our 2s P95 target.
- The whole pipeline is observable per-question; we can replay any failed answer.

**Negative**

- Cross-encoder reranking adds ~180ms; we cache rerank results by `(q_normalised, locale)` for 24h in Redis.
- Mistral La Plateforme has no UK region; if the Garden later wants a UK partner, we'd need a regional fallback. The `LLMClient` port covers it.
