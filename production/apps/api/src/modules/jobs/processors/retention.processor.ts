/**
 * Daily GDPR retention sweep.
 *
 * Enforces the retention windows promised in the privacy policy + required
 * by GDPR Art. 5(1)(e) (storage limitation). Everything here is idempotent
 * and set-based (deleteMany / updateMany with date filters), so re-running
 * on the same day is a no-op once a window has been swept.
 *
 * Windows (all admin/env-configurable via BloomOuluSettings.gdpr):
 *   - AskMessage transcripts → pseudonymised after askMessageRetentionDays
 *     (default 365). Text is replaced with "(erased)"; timestamps stay for
 *     retention statistics. AskAnswer rows hold no PII (model + token
 *     counts) and are left intact.
 *   - AuditLog → pruned after auditRetentionDays (default 6 years). We are
 *     CONSERVATIVE: rows whose `resource` points at a financial / adoption
 *     entity (which may be needed for the Finnish 6-year accounting window
 *     or a dispute) are never deleted here, regardless of age.
 *   - Session + VerificationToken → deleted once expired.
 *   - PlantScan + KioskEvent + ObservabilityEvent → deleted after
 *     analyticsRetentionDays (default 90).
 *   - Donor Users inactive longer than pseudonymiseAfterDays (default
 *     6 years) → pseudonymised via the shared eraseUserData (financial
 *     records preserved). "Inactive" = donor role, not already erased /
 *     deactivated, no successful payment inside the window, no active
 *     adoption, and the row itself untouched within the window.
 *
 * Disable entirely with RETENTION_CRON_DISABLED=true (mirrors the
 * DISBURSEMENT_CRON_DISABLED pattern). A JobRun summary row is always
 * written for observability.
 */
import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { Logger } from '@nestjs/common';
import { buildSettingsDefaults } from '../../settings/settings.service.js';
import { eraseUserData } from '../../gdpr/gdpr.data.js';

const logger = new Logger('RetentionSweep');

const DAY_MS = 86_400_000;

/** Resource prefixes whose AuditLog rows we never prune (financial /
 *  adoption trail that may be needed for the 6-year accounting window or a
 *  dispute). Matched against AuditLog.resource (e.g. "Payment/8f3e…"). */
const AUDIT_KEEP_PREFIXES = [
  'Payment/',
  'Receipt/',
  'TaxCertificate/',
  'Disbursement/',
  'DisbursementEntry/',
  'Adoption/',
];

export async function processRetention(_job: Job) {
  const settings = buildSettingsDefaults().gdpr;
  const now = Date.now();

  const askCutoff = new Date(now - settings.askMessageRetentionDays * DAY_MS);
  const auditCutoff = new Date(now - settings.auditRetentionDays * DAY_MS);
  const analyticsCutoff = new Date(now - settings.analyticsRetentionDays * DAY_MS);
  const inactiveCutoff = new Date(now - settings.pseudonymiseAfterDays * DAY_MS);
  const nowDate = new Date(now);

  // 1. AskMessage transcripts → pseudonymise text past the window. Skip
  //    rows already pseudonymised so the row count reflects real work and
  //    the operation stays idempotent.
  const askMessages = await prisma.askMessage.updateMany({
    where: { createdAt: { lt: askCutoff }, text: { not: '(erased)' } },
    data: { text: '(erased)' },
  });

  // 2. AuditLog → prune non-financial rows past the (long) retention window.
  const auditLog = await prisma.auditLog.deleteMany({
    where: {
      occurredAt: { lt: auditCutoff },
      NOT: { OR: AUDIT_KEEP_PREFIXES.map((p) => ({ resource: { startsWith: p } })) },
    },
  });

  // 3. Expired auth artefacts.
  const sessions = await prisma.session.deleteMany({
    where: { expires: { lt: nowDate } },
  });
  const verificationTokens = await prisma.verificationToken.deleteMany({
    where: { expires: { lt: nowDate } },
  });

  // 4. Ephemeral analytics past 90 days. Note the differing timestamp
  //    columns: PlantScan.scannedAt, KioskEvent.occurredAt,
  //    ObservabilityEvent.ts.
  const plantScans = await prisma.plantScan.deleteMany({
    where: { scannedAt: { lt: analyticsCutoff } },
  });
  const kioskEvents = await prisma.kioskEvent.deleteMany({
    where: { occurredAt: { lt: analyticsCutoff } },
  });
  const observabilityEvents = await prisma.observabilityEvent.deleteMany({
    where: { ts: { lt: analyticsCutoff } },
  });

  // 5. Long-inactive donor Users → pseudonymise (financial records kept).
  //    Conservative candidate selection; cap per run so a backlog can't
  //    blow up a single job. Each user is scrubbed via the shared
  //    eraseUserData so this matches the Art. 17 path exactly.
  const inactiveCandidates = await prisma.user.findMany({
    where: {
      role: 'donor',
      deletedAt: null,
      deactivatedAt: null,
      updatedAt: { lt: inactiveCutoff },
      // No successful payment inside the retention window.
      payments: { none: { status: 'succeeded', createdAt: { gte: inactiveCutoff } } },
      // No still-active / paused adoption (those are live relationships).
      adoptions: { none: { status: { in: ['active', 'paused', 'pending'] } } },
    },
    select: { id: true },
    take: 200,
  });
  let pseudonymisedUsers = 0;
  for (const u of inactiveCandidates) {
    try {
      await eraseUserData(prisma, u.id, 'retention-auto');
      pseudonymisedUsers += 1;
    } catch (err) {
      logger.warn(`retention: failed to pseudonymise inactive user ${u.id}: ${(err as Error).message}`);
    }
  }

  const summary = {
    askMessagesPseudonymised: askMessages.count,
    auditLogPruned: auditLog.count,
    sessionsDeleted: sessions.count,
    verificationTokensDeleted: verificationTokens.count,
    plantScansDeleted: plantScans.count,
    kioskEventsDeleted: kioskEvents.count,
    observabilityEventsDeleted: observabilityEvents.count,
    inactiveDonorsPseudonymised: pseudonymisedUsers,
    windows: {
      askMessageRetentionDays: settings.askMessageRetentionDays,
      auditRetentionDays: settings.auditRetentionDays,
      analyticsRetentionDays: settings.analyticsRetentionDays,
      pseudonymiseAfterDays: settings.pseudonymiseAfterDays,
    },
  };

  logger.log(`retention sweep done: ${JSON.stringify(summary)}`);

  await prisma.jobRun.create({
    data: {
      queueName: 'retention',
      jobName: 'daily',
      payload: summary,
      status: 'ok',
      startedAt: nowDate,
      finishedAt: new Date(),
      attempts: 1,
    },
  });

  return summary;
}
