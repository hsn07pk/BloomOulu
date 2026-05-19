-- Migrate the RAG embedding column to vector(1024) to fit BGE-M3
-- (multilingual, 100+ languages incl. Finnish/Swedish). Wipe the
-- existing 768-dim corpus first — the embeddings are not transferable
-- between models. The `build-plant-rag-corpus.ts` script repopulates.
TRUNCATE TABLE "RagChunk";
ALTER TABLE "RagChunk" DROP COLUMN "embedding";
ALTER TABLE "RagChunk" ADD COLUMN "embedding" vector(1024);
