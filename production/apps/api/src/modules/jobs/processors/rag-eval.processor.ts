/**
 * Monthly RAG evaluation cron — runs at 04:30 UTC on the 1st of each month.
 *
 * ADR-0005: "a curator labels the previous month's bottom-50-score answers;
 * the labels feed back into the ingest job's chunking heuristics."
 *
 * This job:
 *   1. Selects the prior month's AskAnswer rows with the lowest helpfulness
 *      score (or the lowest top-chunk similarity if no reaction was given).
 *   2. Writes a JobRun row with `summary` listing each AskAnswer id, the
 *      original question, the score, and the answer text excerpt — this is
 *      what the curator sees in the admin panel's Operations → Job Runs view.
 *   3. Marks the JobRun as `awaiting_review` so the curator picks it up.
 */
import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';

const askAnswerSelect = {
  id: true,
  reaction: true,
  latencyMs: true,
  escalatedAt: true,
  text: true,
  messageId: true,
  createdAt: true,
  message: { select: { text: true, locale: true } },
} as const;

export interface RagEvalJob {
  sampleSize?: number;
}

export async function processRagEval(job: Job<RagEvalJob>) {
  const sampleSize = Math.max(1, Math.min(job.data.sampleSize ?? 50, 200));

  const now = new Date();
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const firstOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  // Pull the prior month's answers. We can't sort by chunk-similarity in SQL
  // because the score isn't stored on AskAnswer directly — for now we surface
  // the most-likely-bad ones (off_base reactions first, escalated next,
  // unreacted last) and bound the sample.
  const offBase = await prisma.askAnswer.findMany({
    where: {
      createdAt: { gte: firstOfLastMonth, lt: firstOfThisMonth },
      reaction: 'off_base',
    },
    orderBy: { createdAt: 'desc' },
    take: sampleSize,
    select: askAnswerSelect,
  });
  const escalated =
    offBase.length < sampleSize
      ? await prisma.askAnswer.findMany({
          where: {
            createdAt: { gte: firstOfLastMonth, lt: firstOfThisMonth },
            escalatedAt: { not: null },
            id: { notIn: offBase.map((r) => r.id) },
          },
          orderBy: { createdAt: 'desc' },
          take: sampleSize - offBase.length,
          select: askAnswerSelect,
        })
      : [];
  const remainingSlots = sampleSize - offBase.length - escalated.length;
  const unreacted =
    remainingSlots > 0
      ? await prisma.askAnswer.findMany({
          where: {
            createdAt: { gte: firstOfLastMonth, lt: firstOfThisMonth },
            reaction: null,
            id: { notIn: [...offBase.map((r) => r.id), ...escalated.map((r) => r.id)] },
          },
          orderBy: { latencyMs: 'desc' },
          take: remainingSlots,
          select: askAnswerSelect,
        })
      : [];
  const rows = [...offBase, ...escalated, ...unreacted];

  const summary = {
    window: { from: firstOfLastMonth.toISOString(), to: firstOfThisMonth.toISOString() },
    sampled: rows.length,
    breakdown: { offBase: offBase.length, escalated: escalated.length, unreacted: unreacted.length },
    items: rows.map((r) => ({
      askAnswerId: r.id,
      messageId: r.messageId,
      locale: r.message?.locale ?? null,
      reaction: r.reaction,
      latencyMs: r.latencyMs,
      escalatedAt: r.escalatedAt?.toISOString() ?? null,
      question: r.message?.text ?? '',
      answerExcerpt: r.text.slice(0, 240),
      createdAt: r.createdAt.toISOString(),
    })),
  };

  await prisma.jobRun.create({
    data: {
      queueName: 'rag-eval',
      jobName: 'monthly',
      payload: summary,
      status: 'awaiting_review',
      startedAt: new Date(),
      finishedAt: new Date(),
      attempts: job.attemptsMade + 1,
    },
  });

  return { sampled: rows.length };
}
