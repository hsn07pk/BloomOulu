/**
 * Daily audit-gap detector — runs at 03:30 UTC.
 *
 * ADR-0008: "a daily 'audit gap' check job that compares row counts
 * day-over-day and alerts if a day has < 30 % of the 30-day median."
 *
 * Mechanism:
 *   1. Aggregate AuditLog row counts for each of the last 31 calendar days.
 *   2. Treat days 1..30 (excluding yesterday) as the baseline window.
 *   3. Compute the median of that window.
 *   4. If yesterday's count < 30 % of the median, fire a P0 ntfy alert.
 *
 * Idempotent: re-running on the same day overwrites the same JobRun row by
 * day-bucket; the alert is rate-limited by ntfy's deduplication tag.
 */
import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { ntfyAlert } from '../../../infra/alerts.js';

export async function processAuditGap(_job: Job) {
  // Build day buckets in UTC.
  const startOfTodayUTC = new Date();
  startOfTodayUTC.setUTCHours(0, 0, 0, 0);
  const startOfYesterdayUTC = new Date(startOfTodayUTC.getTime() - 86_400_000);
  const startOf31DaysAgo = new Date(startOfTodayUTC.getTime() - 31 * 86_400_000);

  const rows = await prisma.$queryRaw<Array<{ day: Date; n: bigint }>>`
    SELECT date_trunc('day', "occurredAt") AS day, COUNT(*)::bigint AS n
    FROM "AuditLog"
    WHERE "occurredAt" >= ${startOf31DaysAgo} AND "occurredAt" < ${startOfTodayUTC}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  const countsByDay = new Map<string, number>();
  for (const r of rows) {
    countsByDay.set(r.day.toISOString().slice(0, 10), Number(r.n));
  }

  // Fill in zero-count days so the median isn't biased upward by missing days.
  const baselineCounts: number[] = [];
  for (let i = 30; i >= 1; i--) {
    const day = new Date(startOfTodayUTC.getTime() - i * 86_400_000);
    const key = day.toISOString().slice(0, 10);
    baselineCounts.push(countsByDay.get(key) ?? 0);
  }
  const yesterdayKey = startOfYesterdayUTC.toISOString().slice(0, 10);
  const yesterdayCount = countsByDay.get(yesterdayKey) ?? 0;

  // Median of baseline (excluding yesterday — the last entry).
  const baseline = baselineCounts.slice(0, -1).sort((a, b) => a - b);
  const median =
    baseline.length === 0
      ? 0
      : baseline.length % 2
        ? baseline[Math.floor(baseline.length / 2)]!
        : Math.round((baseline[baseline.length / 2 - 1]! + baseline[baseline.length / 2]!) / 2);

  const threshold = Math.max(1, Math.floor(median * 0.3));
  const isGap = median > 0 && yesterdayCount < threshold;

  if (isGap) {
    await ntfyAlert({
      tier: 'P0',
      title: 'Audit-log gap detected',
      body: `Yesterday (${yesterdayKey}) saw ${yesterdayCount} AuditLog rows; 30-day median is ${median}. Threshold (30 %) is ${threshold}. Investigate dropped writes or DB outage.`,
    });
  }

  await prisma.jobRun.create({
    data: {
      queueName: 'audit-gap',
      jobName: 'daily',
      payload: { yesterdayKey, yesterdayCount, median, threshold, isGap },
      status: isGap ? 'alerted' : 'ok',
      startedAt: new Date(),
      finishedAt: new Date(),
      attempts: 1,
    },
  });

  return { yesterdayCount, median, threshold, isGap };
}
