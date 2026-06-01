-- PlantImage.sourceUrl — the canonical upstream image URL (Wikimedia /
-- iNaturalist). `url` holds the local /v1/files copy; the file server falls
-- back to sourceUrl when the local copy isn't present yet, so the front end
-- is never image-less and a background job can cache images locally without
-- re-hitting third parties on every page view.

-- AlterTable
ALTER TABLE "PlantImage" ADD COLUMN "sourceUrl" TEXT;
