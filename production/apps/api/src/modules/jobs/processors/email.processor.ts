import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { sendEmail } from '../../../infra/email.js';
import { renderMjml } from '@bloomoulu/emails/render';
import { presign } from '../../../infra/storage.js';

export interface EmailJob {
  template: string;             // EmailTemplate.slug
  to: string;
  locale: 'en' | 'fi' | 'sv';
  variables: Record<string, string>;
  attachments?: Array<{ filename: string; url: string }>;
}

export async function processEmail(job: Job<EmailJob>): Promise<void> {
  const { template, to, locale, variables, attachments } = job.data;

  const tpl = await prisma.emailTemplate.findUnique({ where: { slug: template } });
  if (!tpl || !tpl.isActive) throw new Error(`Email template ${template} not found or inactive`);

  const subject = pickLocale(tpl, 'subject', locale);
  const preheader = pickLocale(tpl, 'preheader', locale) ?? '';
  const mjml = pickLocale(tpl, 'mjml', locale);

  // Resolve any s3://bucket/key references — both in `variables.receiptUrl`
  // (used inside the email body) and in `attachments[*].url` (passed to
  // nodemailer as `path:`). nodemailer can fetch via http(s); we presign for
  // 24h so the donor can also click the link from the email.
  const resolvedVars: Record<string, string> = { ...variables };
  for (const k of Object.keys(resolvedVars)) {
    const v = resolvedVars[k];
    if (typeof v === 'string' && v.startsWith('s3://')) {
      resolvedVars[k] = await presign(v, 60 * 60 * 24);
    }
  }

  const html = renderMjml(mjml, { ...resolvedVars, preheader });

  const resolvedAttachments = await Promise.all(
    (attachments ?? []).map(async (a) => ({
      filename: a.filename,
      path: a.url.startsWith('s3://') ? await presign(a.url, 60 * 60 * 24) : a.url,
    })),
  );

  await sendEmail({
    to,
    subject: interpolate(subject, resolvedVars),
    html,
    attachments: resolvedAttachments.map((a) => ({ filename: a.filename, url: a.path })),
  });
}

function pickLocale<T extends Record<string, any>>(
  tpl: T,
  field: 'subject' | 'preheader' | 'mjml',
  locale: 'en' | 'fi' | 'sv',
): string {
  const key = `${field}${locale[0]!.toUpperCase()}${locale.slice(1)}`;
  return tpl[key] ?? tpl[`${field}En`] ?? '';
}

function interpolate(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}
