import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { sendEmail } from '../../../infra/email.js';
import { renderMjml } from '@bloomoulu/emails/render';

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

  const html = renderMjml(mjml, { ...variables, preheader });

  await sendEmail({
    to,
    subject: interpolate(subject, variables),
    html,
    attachments: attachments ?? [],
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
