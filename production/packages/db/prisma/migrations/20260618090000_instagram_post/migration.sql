-- CreateTable: cached Instagram posts for the public home-page band.
CREATE TABLE "InstagramPost" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shortcode" TEXT,
    "caption" TEXT,
    "takenAt" TIMESTAMP(3),
    "mediaType" TEXT NOT NULL DEFAULT 'image',
    "imageUrl" TEXT NOT NULL,
    "permalink" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstagramPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramPost_shortcode_key" ON "InstagramPost"("shortcode");

-- CreateIndex
CREATE INDEX "InstagramPost_isFallback_displayOrder_idx" ON "InstagramPost"("isFallback", "displayOrder");

-- CreateIndex
CREATE INDEX "InstagramPost_isFallback_takenAt_idx" ON "InstagramPost"("isFallback", "takenAt" DESC);
