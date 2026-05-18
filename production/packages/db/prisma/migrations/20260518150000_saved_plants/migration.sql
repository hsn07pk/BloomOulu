-- SavedPlant: per-user bookmark list.
-- Source of truth for the ☆ button on the plant page; anonymous users
-- keep a localStorage shadow that's synced into this table on sign-in.

CREATE TABLE "SavedPlant" (
    "id"      UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId"  UUID NOT NULL,
    "plantId" UUID NOT NULL,
    "note"    TEXT,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedPlant_pkey" PRIMARY KEY ("id")
);

-- One bookmark per (user, plant). Upserts are O(1).
CREATE UNIQUE INDEX "SavedPlant_userId_plantId_key" ON "SavedPlant"("userId", "plantId");

-- Hot path: "my saved plants, newest first".
CREATE INDEX "SavedPlant_userId_savedAt_idx" ON "SavedPlant"("userId", "savedAt" DESC);

ALTER TABLE "SavedPlant"
    ADD CONSTRAINT "SavedPlant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SavedPlant"
    ADD CONSTRAINT "SavedPlant_plantId_fkey"
    FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
