-- AdoptionBenefit fulfilment tracking — one row per (Adoption, benefitKey).
-- Auto-seeded on adoption activation from the static catalog in
-- packages/constants/src/benefits.ts. Admin UI groups by status+category
-- so staff see a unified to-do list across all adoptions.

-- CreateEnum
CREATE TYPE "BenefitCategory" AS ENUM ('digital', 'physical', 'event', 'recurring');

-- CreateEnum
CREATE TYPE "BenefitStatus" AS ENUM (
  'pending', 'in_progress', 'fulfilled', 'cancelled', 'not_applicable'
);

-- CreateTable
CREATE TABLE "AdoptionBenefit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "adoptionId" UUID NOT NULL,
    "benefitKey" TEXT NOT NULL,
    "category" "BenefitCategory" NOT NULL,
    "labelSnapshot" TEXT NOT NULL,
    "donorLabelSnapshot" TEXT,
    "status" "BenefitStatus" NOT NULL DEFAULT 'pending',
    "shippingAddress" JSONB,
    "trackingNumber" TEXT,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "eventName" TEXT,
    "eventDate" TIMESTAMP(3),
    "rsvpStatus" TEXT,
    "rsvpAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "nextDueAt" TIMESTAMP(3),
    "notes" TEXT,
    "fulfilledByUserId" UUID,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdoptionBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdoptionBenefit_adoptionId_idx" ON "AdoptionBenefit"("adoptionId");
CREATE INDEX "AdoptionBenefit_status_idx" ON "AdoptionBenefit"("status");
CREATE INDEX "AdoptionBenefit_category_status_idx" ON "AdoptionBenefit"("category", "status");
CREATE INDEX "AdoptionBenefit_nextDueAt_idx" ON "AdoptionBenefit"("nextDueAt");
CREATE UNIQUE INDEX "AdoptionBenefit_adoptionId_benefitKey_key"
  ON "AdoptionBenefit"("adoptionId", "benefitKey");

-- AddForeignKey
ALTER TABLE "AdoptionBenefit" ADD CONSTRAINT "AdoptionBenefit_adoptionId_fkey"
  FOREIGN KEY ("adoptionId") REFERENCES "Adoption"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
