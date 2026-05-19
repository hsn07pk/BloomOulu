-- ADR-0003 role hardening: admins need to deactivate staff/donor accounts
-- without GDPR-erasing them (finance hold). The RolesGuard rejects any
-- JWT whose subject has a non-null deactivatedAt at request time.
ALTER TABLE "User" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
CREATE INDEX "User_deactivatedAt_idx" ON "User" ("deactivatedAt");
