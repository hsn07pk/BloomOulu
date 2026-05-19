-- Adopt page feature parity with demo-design.
--
-- Demo design has a 4-step adoption wizard: tier (monthly toggle) → plant →
-- personalise (intent, dedication, I@H, gift, memorial, co-adopt) → pay
-- (Paytrail/MobilePay/Invoice/Bank). The columns below cover every input
-- exposed in steps 3 + 4 that the old schema couldn't store.

ALTER TABLE "Tier"
  ADD COLUMN "tagEn" TEXT,
  ADD COLUMN "tagFi" TEXT,
  ADD COLUMN "tagSv" TEXT;

ALTER TABLE "Adoption"
  ADD COLUMN "giftDeliverOn" DATE,
  ADD COLUMN "giftAnonymous" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "giftWrap" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "memorialFamilyEmail" TEXT,
  ADD COLUMN "coAdopters" JSONB,
  ADD COLUMN "marketingOptIn" BOOLEAN NOT NULL DEFAULT false;

-- The (status, recurring, endsAt) renewal-cron index already exists; gift
-- delivery is a separate cron path, so add a partial index covering only
-- pending-delivery gifts.
CREATE INDEX "Adoption_giftDeliverOn_idx"
  ON "Adoption" ("giftDeliverOn")
  WHERE "giftDeliverOn" IS NOT NULL;
