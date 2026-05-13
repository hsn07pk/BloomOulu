-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('donor', 'curator', 'finance', 'admin');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'fi', 'sv');

-- CreateEnum
CREATE TYPE "RedListStatus" AS ENUM ('LC', 'NT', 'VU', 'EN', 'CR', 'EX', 'DD', 'NA');

-- CreateEnum
CREATE TYPE "BloomSeason" AS ENUM ('spring', 'summer', 'autumn', 'winter', 'all');

-- CreateEnum
CREATE TYPE "CitationSourceType" AS ENUM ('paper', 'report', 'book', 'database', 'curator_note', 'phenology_log');

-- CreateEnum
CREATE TYPE "TierId" AS ENUM ('seedling', 'rooted', 'vulnerable', 'endangered', 'corporate');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('one_time', 'annual', 'monthly');

-- CreateEnum
CREATE TYPE "AdoptionIntent" AS ENUM ('for_self', 'gift', 'memorial', 'class', 'corporate');

-- CreateEnum
CREATE TYPE "AdoptionStatus" AS ENUM ('pending', 'active', 'paused', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('paytrail', 'mobilepay', 'bank_transfer');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'failed', 'refunded', 'cancelled', 'requires_action');

-- CreateEnum
CREATE TYPE "ReceiptKind" AS ENUM ('donation', 'refund', 'tax_certificate');

-- CreateEnum
CREATE TYPE "AskReaction" AS ENUM ('helpful', 'off_base', 'escalated');

-- CreateEnum
CREATE TYPE "GdprRequestStatus" AS ENUM ('pending', 'verified', 'executing', 'completed', 'rejected');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'donor',
    "locale" "Locale" NOT NULL DEFAULT 'fi',
    "homeRegion" TEXT,
    "postalAddress" JSONB,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "ouluUid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sessionToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Taxon" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "latinName" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "author" TEXT,
    "rank" TEXT NOT NULL DEFAULT 'species',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Taxon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "taxonId" UUID NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFi" TEXT NOT NULL,
    "nameSv" TEXT NOT NULL,
    "redListStatus" "RedListStatus" NOT NULL,
    "redListYear" INTEGER NOT NULL DEFAULT 2019,
    "origin" TEXT NOT NULL,
    "habitat" TEXT NOT NULL,
    "biome" TEXT NOT NULL,
    "bloomSeason" "BloomSeason" NOT NULL,
    "bloomWindow" TEXT,
    "story" JSONB NOT NULL,
    "quickFacts" JSONB NOT NULL,
    "primaryImageId" UUID,
    "microLat" DECIMAL(10,7),
    "microLng" DECIMAL(10,7),
    "gardenZone" TEXT,
    "adopterCount" INTEGER NOT NULL DEFAULT 0,
    "fundedCents" INTEGER NOT NULL DEFAULT 0,
    "targetCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantImage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plantId" UUID,
    "url" TEXT NOT NULL,
    "altEn" TEXT NOT NULL,
    "altFi" TEXT NOT NULL,
    "altSv" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "licenseSpdx" TEXT NOT NULL DEFAULT 'CC-BY-4.0',
    "season" "BloomSeason",
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlantImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Accession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accessionNumber" TEXT NOT NULL,
    "plantId" UUID NOT NULL,
    "collectedAt" TIMESTAMP(3),
    "collectedBy" TEXT,
    "sourcePopulation" TEXT,
    "propagationLineage" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Accession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sourceType" "CitationSourceType" NOT NULL,
    "displayTitle" TEXT NOT NULL,
    "authors" TEXT,
    "year" INTEGER,
    "identifier" TEXT,
    "url" TEXT,
    "page" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantCitation" (
    "plantId" UUID NOT NULL,
    "citationId" UUID NOT NULL,
    "context" TEXT,

    CONSTRAINT "PlantCitation_pkey" PRIMARY KEY ("plantId","citationId")
);

-- CreateTable
CREATE TABLE "AudioNarration" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plantId" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "audioUrl" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "transcript" TEXT NOT NULL,
    "captionsVtt" TEXT,
    "voiceCredit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudioNarration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tier" (
    "id" "TierId" NOT NULL,
    "name" TEXT NOT NULL,
    "nameFi" TEXT NOT NULL,
    "nameSv" TEXT NOT NULL,
    "annualPriceCents" INTEGER NOT NULL,
    "monthlyPriceCents" INTEGER,
    "blurbEn" TEXT NOT NULL,
    "blurbFi" TEXT NOT NULL,
    "blurbSv" TEXT NOT NULL,
    "perks" JSONB NOT NULL,
    "color" TEXT NOT NULL,
    "bg" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adoption" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donorId" UUID NOT NULL,
    "plantId" UUID NOT NULL,
    "tierId" "TierId" NOT NULL,
    "status" "AdoptionStatus" NOT NULL DEFAULT 'pending',
    "intent" "AdoptionIntent" NOT NULL DEFAULT 'for_self',
    "homeRegion" TEXT,
    "nickname" TEXT,
    "dedication" TEXT,
    "showOnDonorWall" BOOLEAN NOT NULL DEFAULT true,
    "publicName" TEXT,
    "giftRecipientId" UUID,
    "giftCodeId" UUID,
    "memorialOf" TEXT,
    "recurring" BOOLEAN NOT NULL DEFAULT true,
    "billingInterval" "BillingInterval" NOT NULL DEFAULT 'annual',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "startedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Adoption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCode" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plaque" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "adoptionId" UUID NOT NULL,
    "engravedText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "installedAt" TIMESTAMP(3),
    "installedByUserId" UUID,
    "photoUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plaque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" TEXT NOT NULL,
    "adoptionId" UUID,
    "donorId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerCustomerId" TEXT,
    "providerPaymentRef" TEXT,
    "providerSessionId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "netCents" INTEGER NOT NULL,
    "vatRateBp" INTEGER NOT NULL DEFAULT 0,
    "vatCents" INTEGER NOT NULL DEFAULT 0,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "receivedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "PaymentProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "paymentId" UUID,
    "payloadDigest" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "kind" "ReceiptKind" NOT NULL DEFAULT 'donation',
    "donorId" UUID NOT NULL,
    "paymentId" UUID,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "vatLineJson" JSONB NOT NULL,
    "pdfUrl" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdfSha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCertificate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donorId" UUID NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "scheme" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagDocument" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "sourceCitationId" UUID,
    "sourceUrl" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'en',
    "body" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagChunk" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "documentId" UUID NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "tokenStart" INTEGER NOT NULL,
    "tokenEnd" INTEGER NOT NULL,
    "locale" "Locale" NOT NULL,
    "embedding" vector(1024),
    "plantId" UUID,
    "citationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskMessage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "locale" "Locale" NOT NULL,
    "text" TEXT NOT NULL,
    "intent" TEXT NOT NULL DEFAULT 'on_topic',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskAnswer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "messageId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "reaction" "AskReaction",
    "escalatedAt" TIMESTAMP(3),
    "retrievedChunkIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskAnswerCitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "answerId" UUID NOT NULL,
    "citationId" UUID NOT NULL,
    "marker" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "AskAnswerCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskDevice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "label" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "pairingCode" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "pairingTokenHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unpaired',
    "lastSeen" TIMESTAMP(3),
    "buildSha" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deviceId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KioskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataExportRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "status" "GdprRequestStatus" NOT NULL DEFAULT 'pending',
    "exportUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DataExportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataErasureRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "status" "GdprRequestStatus" NOT NULL DEFAULT 'pending',
    "approach" TEXT NOT NULL DEFAULT 'pseudonymise',
    "reason" TEXT,
    "decidedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DataErasureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "type" TEXT,
    "updatedByUserId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Translation" (
    "i18nKey" TEXT NOT NULL,
    "en" TEXT NOT NULL,
    "fi" TEXT NOT NULL,
    "sv" TEXT NOT NULL,
    "context" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Translation_pkey" PRIMARY KEY ("i18nKey")
);

-- CreateTable
CREATE TABLE "ContentBlock" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "bodyFi" TEXT NOT NULL,
    "bodySv" TEXT NOT NULL,
    "imageUrl" TEXT,
    "ctaText" JSONB,
    "ctaHref" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "slug" TEXT NOT NULL,
    "subjectEn" TEXT NOT NULL,
    "subjectFi" TEXT NOT NULL,
    "subjectSv" TEXT NOT NULL,
    "preheaderEn" TEXT,
    "preheaderFi" TEXT,
    "preheaderSv" TEXT,
    "mjmlEn" TEXT NOT NULL,
    "mjmlFi" TEXT NOT NULL,
    "mjmlSv" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "VatRule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lineKind" TEXT NOT NULL,
    "rateBp" INTEGER NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VatRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "queueName" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_ouluUid_key" ON "User"("ouluUid");

-- CreateIndex
CREATE INDEX "User_locale_idx" ON "User"("locale");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Taxon_latinName_key" ON "Taxon"("latinName");

-- CreateIndex
CREATE UNIQUE INDEX "Plant_slug_key" ON "Plant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Plant_primaryImageId_key" ON "Plant"("primaryImageId");

-- CreateIndex
CREATE INDEX "Plant_redListStatus_idx" ON "Plant"("redListStatus");

-- CreateIndex
CREATE INDEX "Plant_bloomSeason_idx" ON "Plant"("bloomSeason");

-- CreateIndex
CREATE INDEX "Plant_status_idx" ON "Plant"("status");

-- CreateIndex
CREATE INDEX "Plant_slug_idx" ON "Plant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Accession_accessionNumber_key" ON "Accession"("accessionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AudioNarration_plantId_locale_key" ON "AudioNarration"("plantId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "Adoption_giftCodeId_key" ON "Adoption"("giftCodeId");

-- CreateIndex
CREATE INDEX "Adoption_donorId_idx" ON "Adoption"("donorId");

-- CreateIndex
CREATE INDEX "Adoption_plantId_idx" ON "Adoption"("plantId");

-- CreateIndex
CREATE INDEX "Adoption_status_idx" ON "Adoption"("status");

-- CreateIndex
CREATE INDEX "Adoption_tierId_idx" ON "Adoption"("tierId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCode_code_key" ON "GiftCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Plaque_adoptionId_key" ON "Plaque"("adoptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_donorId_idx" ON "Payment"("donorId");

-- CreateIndex
CREATE INDEX "Payment_adoptionId_idx" ON "Payment"("adoptionId");

-- CreateIndex
CREATE INDEX "Payment_provider_providerPaymentRef_idx" ON "Payment"("provider", "providerPaymentRef");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedEvent_provider_providerEventId_key" ON "ProcessedEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_number_key" ON "Receipt"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCertificate_donorId_taxYear_key" ON "TaxCertificate"("donorId", "taxYear");

-- CreateIndex
CREATE UNIQUE INDEX "RagDocument_title_locale_key" ON "RagDocument"("title", "locale");

-- CreateIndex
CREATE INDEX "RagChunk_locale_idx" ON "RagChunk"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "RagChunk_documentId_chunkIndex_key" ON "RagChunk"("documentId", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "AskAnswer_messageId_key" ON "AskAnswer"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "KioskDevice_pairingCode_key" ON "KioskDevice"("pairingCode");

-- CreateIndex
CREATE INDEX "KioskEvent_deviceId_occurredAt_idx" ON "KioskEvent"("deviceId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_occurredAt_idx" ON "AuditLog"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_resource_idx" ON "AuditLog"("resource");

-- CreateIndex
CREATE INDEX "Translation_status_idx" ON "Translation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ContentBlock_slug_key" ON "ContentBlock"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "VatRule_lineKind_key" ON "VatRule"("lineKind");

-- CreateIndex
CREATE INDEX "JobRun_queueName_status_idx" ON "JobRun"("queueName", "status");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_taxonId_fkey" FOREIGN KEY ("taxonId") REFERENCES "Taxon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_primaryImageId_fkey" FOREIGN KEY ("primaryImageId") REFERENCES "PlantImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantImage" ADD CONSTRAINT "PlantImage_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accession" ADD CONSTRAINT "Accession_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantCitation" ADD CONSTRAINT "PlantCitation_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantCitation" ADD CONSTRAINT "PlantCitation_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "Citation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioNarration" ADD CONSTRAINT "AudioNarration_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adoption" ADD CONSTRAINT "Adoption_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adoption" ADD CONSTRAINT "Adoption_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adoption" ADD CONSTRAINT "Adoption_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "Tier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adoption" ADD CONSTRAINT "Adoption_giftRecipientId_fkey" FOREIGN KEY ("giftRecipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adoption" ADD CONSTRAINT "Adoption_giftCodeId_fkey" FOREIGN KEY ("giftCodeId") REFERENCES "GiftCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plaque" ADD CONSTRAINT "Plaque_adoptionId_fkey" FOREIGN KEY ("adoptionId") REFERENCES "Adoption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_adoptionId_fkey" FOREIGN KEY ("adoptionId") REFERENCES "Adoption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedEvent" ADD CONSTRAINT "ProcessedEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCertificate" ADD CONSTRAINT "TaxCertificate_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagDocument" ADD CONSTRAINT "RagDocument_sourceCitationId_fkey" FOREIGN KEY ("sourceCitationId") REFERENCES "Citation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagChunk" ADD CONSTRAINT "RagChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "RagDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagChunk" ADD CONSTRAINT "RagChunk_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagChunk" ADD CONSTRAINT "RagChunk_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "Citation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskMessage" ADD CONSTRAINT "AskMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskAnswer" ADD CONSTRAINT "AskAnswer_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AskMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskAnswerCitation" ADD CONSTRAINT "AskAnswerCitation_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "AskAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskAnswerCitation" ADD CONSTRAINT "AskAnswerCitation_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "Citation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskEvent" ADD CONSTRAINT "KioskEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "KioskDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExportRequest" ADD CONSTRAINT "DataExportRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataErasureRequest" ADD CONSTRAINT "DataErasureRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

