-- HNSW vector index for fast approximate-nearest-neighbour retrieval on
-- RagChunk.embedding (cosine distance, the `<=>` operator used by the
-- AskTheGarden hybrid retriever). Without it the vector CTE sequential-scans
-- every chunk; on the ~26k-chunk corpus that alone was seconds per /ask.
--
-- Built single-threaded (max_parallel_maintenance_workers = 0) so the index
-- build doesn't need a large shared-memory segment — the Postgres container's
-- default /dev/shm is only 64MB and a parallel build fails to resize it.
-- IF NOT EXISTS keeps this idempotent on environments where the index was
-- already created out-of-band.
SET maintenance_work_mem = '256MB';
SET max_parallel_maintenance_workers = 0;
CREATE INDEX IF NOT EXISTS "RagChunk_embedding_hnsw"
  ON "RagChunk" USING hnsw (embedding vector_cosine_ops);
