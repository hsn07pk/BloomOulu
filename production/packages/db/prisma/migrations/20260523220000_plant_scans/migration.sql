-- PlantScan event table + Plant.scanCount counter. Visitors landing on
-- /[locale]/plants/[slug]?qr=1 (from a physical label) trigger an insert
-- here so the admin dashboard can show top-scanned plants, the
-- scan→adoption funnel, and per-kiosk activity. scanCount is a denorm
-- counter the API bumps in the same transaction so list views can sort
-- by popularity without an extra aggregate query.

ALTER TABLE "Plant"
  ADD COLUMN IF NOT EXISTS "scanCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "PlantScan" (
  "id"           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "plantId"      UUID         NOT NULL REFERENCES "Plant"("id") ON DELETE CASCADE,
  "scannedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locale"       TEXT         NOT NULL DEFAULT 'fi',
  "kioskId"      TEXT,
  "visitorHash"  TEXT         NOT NULL DEFAULT '',
  "userAgent"    TEXT
);

CREATE INDEX IF NOT EXISTS "PlantScan_plantId_scannedAt_idx"
  ON "PlantScan" ("plantId", "scannedAt" DESC);
CREATE INDEX IF NOT EXISTS "PlantScan_scannedAt_idx"
  ON "PlantScan" ("scannedAt" DESC);
CREATE INDEX IF NOT EXISTS "PlantScan_kioskId_scannedAt_idx"
  ON "PlantScan" ("kioskId", "scannedAt" DESC);
