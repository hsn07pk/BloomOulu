/**
 * Shared GDPR data access — the SINGLE source of truth for what a Subject
 * Access Request (Art. 15 / portability Art. 20) returns and what an
 * erasure (Art. 17) scrubs. Both the async export processor
 * (jobs/processors/gdpr-export.processor.ts), the synchronous controller
 * path (exports/exports.controller.ts), and the erasure processor
 * (jobs/processors/gdpr-erase.processor.ts) call into here so the three
 * can never drift apart.
 *
 * Invariants:
 *   - NEVER include User.passwordHash.
 *   - NEVER include OAuth secrets (Account.refresh_token / access_token /
 *     id_token). Account rows are exported as metadata only.
 *   - Session rows are exported as metadata only (no sessionToken).
 *   - Financial rows (Payment / Receipt / TaxCertificate) are included in
 *     the export and PRESERVED on erasure (Finnish Kirjanpitolaki 2:5 §,
 *     6-year retention).
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

/**
 * Collect every row that references the user, with all sensitive secrets
 * stripped. Returns a plain JSON-serialisable bundle.
 */
export async function collectUserExport(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const [
    adoptions,
    giftsReceived,
    payments,
    receipts,
    taxCertificates,
    askMessages,
    savedPlants,
    quizAttempts,
    accountsRaw,
    sessionsRaw,
    auditLog,
    dataExportRequests,
    dataErasureRequests,
  ] = await Promise.all([
    // Adoptions the donor created — pull EVERY personal field the schema
    // carries: nickname/dedication/publicName, gift + memorial fields,
    // co-adopters, plus the per-adoption Plaque (engravedText) and
    // AdoptionBenefit fulfilment rows (shipping address + tracking).
    prisma.adoption.findMany({
      where: { donorId: userId },
      include: {
        plant: { select: { slug: true, nameEn: true } },
        tier: { select: { id: true, name: true } },
        plaque: true,
        benefits: true,
        giftRecipient: { select: { id: true, email: true, name: true } },
      },
    }),
    // Adoptions where this user is the gift recipient.
    prisma.adoption.findMany({
      where: { giftRecipientId: userId },
      include: { plant: { select: { slug: true, nameEn: true } } },
    }),
    prisma.payment.findMany({ where: { donorId: userId } }),
    prisma.receipt.findMany({ where: { donorId: userId } }),
    prisma.taxCertificate.findMany({ where: { donorId: userId } }),
    prisma.askMessage.findMany({
      where: { userId },
      include: { answer: true },
    }),
    prisma.savedPlant.findMany({
      where: { userId },
      include: { plant: { select: { slug: true, nameEn: true } } },
    }),
    // QuizAttempt has no FK relation to User (userId is a bare column), so
    // query by userId directly.
    prisma.quizAttempt.findMany({ where: { userId } }),
    // Auth.js Account rows — metadata only; secrets stripped below.
    prisma.account.findMany({ where: { userId } }),
    // Session rows — metadata only; sessionToken stripped below.
    prisma.session.findMany({ where: { userId } }),
    prisma.auditLog.findMany({ where: { actorUserId: userId } }),
    prisma.dataExportRequest.findMany({ where: { userId } }),
    prisma.dataErasureRequest.findMany({ where: { userId } }),
  ]);

  // Strip OAuth secrets from Account rows (Art. 15 covers metadata, not the
  // bearer tokens that would let anyone impersonate the OAuth link).
  const accounts = accountsRaw.map((a) => ({
    id: a.id,
    provider: a.provider,
    type: a.type,
    providerAccountId: a.providerAccountId,
    scope: a.scope ?? null,
    expires_at: a.expires_at ?? null,
    // refresh_token / access_token / id_token / session_state intentionally omitted.
  }));

  // Session rows — metadata only (the sessionToken is a live credential).
  const sessions = sessionsRaw.map((s) => ({
    id: s.id,
    expires: s.expires,
    // sessionToken intentionally omitted.
  }));

  // Strip the password hash from the user copy (never part of an export).
  const safeUser: Record<string, unknown> = { ...user };
  delete safeUser.passwordHash;

  return {
    exportedAt: new Date().toISOString(),
    subjectRights: 'GDPR Articles 15 (access) + 20 (portability)',
    user: safeUser,
    adoptions,
    giftsReceived,
    payments,
    receipts,
    taxCertificates,
    askMessages,
    savedPlants,
    quizAttempts,
    accounts,
    sessions,
    auditLog,
    dataExportRequests,
    dataErasureRequests,
    // PlantScan rows are stored anonymously (only a daily-rotating
    // visitorHash, never a userId), so they cannot be attributed to an
    // individual account. Documented here for completeness/transparency.
    plantScans: {
      note: 'Plant QR scans are recorded anonymously (no account link), so none can be attributed to your user.',
      rows: [] as never[],
    },
  };
}

/**
 * Erase / pseudonymise every PII field tied to the user, in one
 * transaction. Financial records (Payment / Receipt / TaxCertificate) are
 * preserved for the Finnish 6-year retention window, but any PII *copies*
 * on them that aren't legally required are nulled.
 *
 * `approach` mirrors DataErasureRequest.approach ('pseudonymise' | 'delete')
 * and is only recorded in the returned summary; the financial-hold means we
 * always pseudonymise the User row rather than hard-deleting it.
 */
export async function eraseUserData(
  prisma: PrismaClient,
  userId: string,
  approach: string,
): Promise<{ userId: string; approach: string }> {
  await prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u) throw new Error('user disappeared');

    const pseudoEmail = `erased-${createHash('sha256')
      .update(u.email)
      .digest('hex')
      .slice(0, 16)}@bloomoulu.deleted`;

    // 1. User PII → pseudonymise. postalAddress is a nullable Json column,
    //    so it must be cleared with Prisma.JsonNull (passing `undefined`
    //    would be a no-op). preferences is a non-null Json — reset to {}.
    await tx.user.update({
      where: { id: userId },
      data: {
        email: pseudoEmail,
        name: null,
        image: null,
        postalAddress: Prisma.JsonNull,
        homeRegion: null,
        preferences: {},
        deletedAt: new Date(),
      },
    });

    // Resolve the donor's adoption ids once. Prisma's updateMany `where`
    // does NOT support relation filters at runtime (only scalar columns),
    // so child tables (Plaque, AdoptionBenefit) are scoped by adoptionId.
    const adoptionIds = (
      await tx.adoption.findMany({ where: { donorId: userId }, select: { id: true } })
    ).map((a) => a.id);

    // 2. Adoption personalisation + gift/memorial/co-adopter fields.
    //    coAdopters is nullable Json → Prisma.JsonNull.
    await tx.adoption.updateMany({
      where: { donorId: userId },
      data: {
        nickname: null,
        dedication: null,
        publicName: null,
        showOnDonorWall: false,
        coAdopters: Prisma.JsonNull,
        memorialOf: null,
        memorialFamilyEmail: null,
        giftRecipientId: null,
      },
    });

    if (adoptionIds.length > 0) {
      // 3. Plaque engraving text — free-form, can name the donor/dedicatee.
      await tx.plaque.updateMany({
        where: { adoptionId: { in: adoptionIds } },
        data: { engravedText: '(erased)' },
      });

      // 4. AdoptionBenefit shipping address (nullable Json → Prisma.JsonNull)
      //    + tracking number.
      await tx.adoptionBenefit.updateMany({
        where: { adoptionId: { in: adoptionIds } },
        data: { shippingAddress: Prisma.JsonNull, trackingNumber: null },
      });
    }

    // 5. AskTheGarden message text (keep timestamps for retention stats).
    await tx.askMessage.updateMany({
      where: { userId },
      data: { text: '(erased)' },
    });

    // 6. QuizAttempt — detach from the user (anonymous analytics remain).
    await tx.quizAttempt.updateMany({
      where: { userId },
      data: { userId: null },
    });

    // 7. Account rows (OAuth links) + Session rows (live credentials) →
    //    hard delete. These hold secrets and must not survive erasure.
    await tx.account.deleteMany({ where: { userId } });
    await tx.session.deleteMany({ where: { userId } });

    // 8. SavedPlant bookmarks (incl. free-form notes) → delete.
    await tx.savedPlant.deleteMany({ where: { userId } });

    // 9. AuditLog — pseudonymise the network identifiers for THIS subject
    //    but keep action/resource so the security trail stays intact.
    await tx.auditLog.updateMany({
      where: { actorUserId: userId },
      data: { ip: null, userAgent: null },
    });

    // 10. Financial records (Payment / Receipt / TaxCertificate) are
    //     retained for the 6-year window. They reference the (now
    //     pseudonymised) User via donorId; no extra free-form PII copies
    //     live on those rows in this schema, so nothing further to null.

    // 11. Close out the erasure request(s).
    await tx.auditLog.create({
      data: {
        actorUserId: null,
        action: 'gdpr.erase',
        resource: `User/${userId}`,
        after: { approach },
      },
    });
  });

  return { userId, approach };
}
