-- CreateTable
CREATE TABLE "ObservabilityEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "traceId" TEXT,
    "userId" TEXT,
    "durationMs" INTEGER,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ObservabilityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ObservabilityEvent_ts_idx" ON "ObservabilityEvent"("ts" DESC);
CREATE INDEX "ObservabilityEvent_severity_ts_idx" ON "ObservabilityEvent"("severity", "ts" DESC);
CREATE INDEX "ObservabilityEvent_source_ts_idx" ON "ObservabilityEvent"("source", "ts" DESC);
CREATE INDEX "ObservabilityEvent_traceId_idx" ON "ObservabilityEvent"("traceId");
