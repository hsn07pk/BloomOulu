-- ADR-0005 said vector(1024) for Mistral mistral-embed, but our self-hosted
-- Ollama path uses nomic-embed-text:v1.5 which emits 768-dim vectors.
-- Drop + recreate the column (no rows yet) to switch dimensions.
ALTER TABLE "RagChunk" DROP COLUMN "embedding";
ALTER TABLE "RagChunk" ADD COLUMN "embedding" vector(768);
