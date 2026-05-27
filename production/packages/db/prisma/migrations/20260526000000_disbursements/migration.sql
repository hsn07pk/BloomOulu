-- Disbursement tracking — the channel through which the University of
-- Oulu's central treasury reimburses the Botanical Garden for donations
-- collected on the Garden's behalf. Every donation flows into the
-- University's main account first; the Garden's finance staff bundle
-- settled donations into a Disbursement claim with full transaction
-- detail, the University finance office pays the claim, and we
-- reconcile the received amount against expected.

CREATE TYPE "DisbursementStatus" AS ENUM (
  'draft',
  'ready',
  'submitted',
  'paid',
  'reconciled',
  'cancelled'
);

CREATE TABLE "Disbursement" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "reference"      TEXT NOT NULL UNIQUE,
  "periodStart"    DATE NOT NULL,
  "periodEnd"      DATE NOT NULL,
  "status"         "DisbursementStatus" NOT NULL DEFAULT 'draft',
  "expectedCents"  INTEGER NOT NULL DEFAULT 0,
  "paidCents"      INTEGER NOT NULL DEFAULT 0,
  "feeCents"       INTEGER NOT NULL DEFAULT 0,
  "netCents"       INTEGER NOT NULL DEFAULT 0,
  "currency"       TEXT NOT NULL DEFAULT 'EUR',
  "notes"          TEXT,
  "submittedAt"    TIMESTAMP(3),
  "paidAt"         TIMESTAMP(3),
  "reconciledAt"   TIMESTAMP(3),
  "cancelledAt"    TIMESTAMP(3),
  "pdfUrl"         TEXT,
  "csvUrl"         TEXT,
  "csvSha256"      TEXT,
  "createdByUserId" UUID,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Disbursement_status_periodEnd_idx"
  ON "Disbursement"("status", "periodEnd" DESC);
CREATE INDEX "Disbursement_createdAt_idx"
  ON "Disbursement"("createdAt" DESC);

CREATE TABLE "DisbursementEntry" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "disbursementId" UUID NOT NULL REFERENCES "Disbursement"("id") ON DELETE CASCADE,
  "paymentId"      UUID NOT NULL REFERENCES "Payment"("id") ON DELETE RESTRICT,
  "amountCents"    INTEGER NOT NULL,
  "feeCents"       INTEGER NOT NULL DEFAULT 0,
  "netCents"       INTEGER NOT NULL,
  "included"       BOOLEAN NOT NULL DEFAULT TRUE,
  "excludedReason" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("disbursementId", "paymentId")
);

CREATE INDEX "DisbursementEntry_paymentId_idx" ON "DisbursementEntry"("paymentId");
