-- Bundle-payment support: shared id linking sibling Adoption rows that
-- were checked out together from the cart. The webhook activates all
-- siblings together on a single PaymentSucceeded event.
ALTER TABLE "Adoption" ADD COLUMN "bundleId" uuid;
CREATE INDEX "Adoption_bundleId_idx" ON "Adoption" ("bundleId");
