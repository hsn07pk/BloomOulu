-- Add password authentication alongside the existing magic-link flow.
-- Donors who register via the sign-up form set a password once at verify
-- time; staff who use University SSO never have a passwordHash set.
-- Existing magic-link rows continue to work because the column is
-- nullable; verifyMagicLink() doesn't touch passwordHash.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "passwordHash" text;

-- Convenience index for the "is this a new email" lookup the sign-in
-- form does before deciding whether to show a password field. The
-- email column already has a unique index, so this is redundant — but
-- keeping the migration symmetric with the schema.prisma diff.
