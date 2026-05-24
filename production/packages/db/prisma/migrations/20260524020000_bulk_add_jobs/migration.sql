-- CreateTable
CREATE TABLE "BulkAddJob" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "createdByUser" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "phase" TEXT NOT NULL DEFAULT 'enrich',
    "items" JSONB NOT NULL,
    "totals" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkAddJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkAddJob_createdAt_idx" ON "BulkAddJob"("createdAt" DESC);
CREATE INDEX "BulkAddJob_status_createdAt_idx" ON "BulkAddJob"("status", "createdAt" DESC);
