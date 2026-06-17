-- Donation + favourites model.
--
-- Replaces the adopt-a-plant program (tiers / perks / plaques / recurring /
-- gifts) with one-time donations + a favourites (votes) leaderboard.
--
-- Hand-authored (not `migrate diff` output) so it touches ONLY the
-- donation/vote surface: the full-text/trigram (`searchText`, trgm/gin) and
-- pgvector (`searchVector`, hnsw) artifacts added by earlier raw-SQL
-- migrations are intentionally left untouched.
--
-- NOTE: destructive — drops Adoption/Tier/AdoptionBenefit/GiftCode/Plaque and
-- their enums. Apply with `prisma migrate deploy` after the new images build.

-- ── New enum ────────────────────────────────────────────────────────────────
CREATE TYPE "DonationStatus" AS ENUM ('pending', 'completed', 'failed', 'refunded');

-- ── Drop adoption-era foreign keys ───────────────────────────────────────────
ALTER TABLE "Adoption" DROP CONSTRAINT IF EXISTS "Adoption_donorId_fkey";
ALTER TABLE "Adoption" DROP CONSTRAINT IF EXISTS "Adoption_giftCodeId_fkey";
ALTER TABLE "Adoption" DROP CONSTRAINT IF EXISTS "Adoption_giftRecipientId_fkey";
ALTER TABLE "Adoption" DROP CONSTRAINT IF EXISTS "Adoption_plantId_fkey";
ALTER TABLE "Adoption" DROP CONSTRAINT IF EXISTS "Adoption_tierId_fkey";
ALTER TABLE "AdoptionBenefit" DROP CONSTRAINT IF EXISTS "AdoptionBenefit_adoptionId_fkey";
ALTER TABLE "Plaque" DROP CONSTRAINT IF EXISTS "Plaque_adoptionId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_adoptionId_fkey";

-- ── Payment: relink adoption → donation ──────────────────────────────────────
DROP INDEX IF EXISTS "Payment_adoptionId_idx";
ALTER TABLE "Payment" DROP COLUMN "adoptionId",
                      ADD COLUMN "donationId" UUID;
CREATE INDEX "Payment_donationId_idx" ON "Payment"("donationId");

-- ── Plant: counters (adopterCount → donorCount, + voteCount) ──────────────────
DROP INDEX IF EXISTS "Plant_status_adopterCount_nameEn_idx";
ALTER TABLE "Plant" DROP COLUMN "adopterCount",
                    ADD COLUMN "donorCount" INTEGER NOT NULL DEFAULT 0,
                    ADD COLUMN "voteCount" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "Plant_status_donorCount_nameEn_idx" ON "Plant"("status", "donorCount" DESC, "nameEn");
CREATE INDEX "Plant_status_voteCount_nameEn_idx" ON "Plant"("status", "voteCount" DESC, "nameEn");

-- ── Drop adoption tables + enums ─────────────────────────────────────────────
DROP TABLE IF EXISTS "AdoptionBenefit";
DROP TABLE IF EXISTS "Plaque";
DROP TABLE IF EXISTS "GiftCode";
DROP TABLE IF EXISTS "Adoption";
DROP TABLE IF EXISTS "Tier";
DROP TYPE IF EXISTS "AdoptionIntent";
DROP TYPE IF EXISTS "AdoptionStatus";
DROP TYPE IF EXISTS "BenefitCategory";
DROP TYPE IF EXISTS "BenefitStatus";
DROP TYPE IF EXISTS "BillingInterval";
DROP TYPE IF EXISTS "TierId";

-- ── Donation ─────────────────────────────────────────────────────────────────
CREATE TABLE "Donation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donorId" UUID NOT NULL,
    "plantId" UUID,
    "status" "DonationStatus" NOT NULL DEFAULT 'pending',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "dedication" TEXT,
    "showOnWall" BOOLEAN NOT NULL DEFAULT true,
    "publicName" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Donation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Donation_donorId_status_createdAt_idx" ON "Donation"("donorId", "status", "createdAt" DESC);
CREATE INDEX "Donation_plantId_status_idx" ON "Donation"("plantId", "status");
CREATE INDEX "Donation_status_showOnWall_startedAt_idx" ON "Donation"("status", "showOnWall", "startedAt" DESC);

-- ── PlantVote (favourites leaderboard) ───────────────────────────────────────
CREATE TABLE "PlantVote" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plantId" UUID NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'fi',
    "kioskId" TEXT,
    "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlantVote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlantVote_plantId_visitorHash_key" ON "PlantVote"("plantId", "visitorHash");
CREATE INDEX "PlantVote_plantId_idx" ON "PlantVote"("plantId");
CREATE INDEX "PlantVote_votedAt_idx" ON "PlantVote"("votedAt" DESC);

-- ── Foreign keys ─────────────────────────────────────────────────────────────
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlantVote" ADD CONSTRAINT "PlantVote_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
