import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { sendEmail } from '../../../infra/email.js';
import { renderMjml } from '@bloomoulu/emails/render';
import { presign, readFile } from '../../../infra/storage.js';

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

  // Resolve any storage references — both `s3://bucket/key` (legacy) and
  // `local://key` (the local-disk backend). `presign()` knows how to map
  // either form to a public `/v1/files/...` URL the donor can click from
  // the email. Used inside the email body via {{receiptUrl}} etc.
  const resolvedVars: Record<string, string> = { ...variables };
  for (const k of Object.keys(resolvedVars)) {
    const v = resolvedVars[k];
    if (typeof v === 'string' && (v.startsWith('s3://') || v.startsWith('local://'))) {
      resolvedVars[k] = await presign(v, 60 * 60 * 24);
    }
  }

  const html = renderMjml(mjml, { ...resolvedVars, preheader });

  // Attachments: load `local://` blobs from disk and ship as a Buffer
  // (nodemailer's `content:` option) — nodemailer treats `path:` as a
  // literal filesystem path / URL, so `local://...` would fail ENOENT.
  // `s3://` legacy refs get presigned to a public HTTP URL nodemailer
  // can fetch. Plain http(s) URLs pass through unchanged.
  const resolvedAttachments: Array<{
    filename: string;
    path?: string;
    content?: Buffer;
    contentType?: string;
  }> = await Promise.all(
    (attachments ?? []).map(async (a): Promise<{
      filename: string;
      path?: string;
      content?: Buffer;
      contentType?: string;
    }> => {
      if (a.url.startsWith('local://')) {
        const file = await readFile(a.url);
        if (!file) throw new Error(`Attachment missing in local storage: ${a.url}`);
        return { filename: a.filename, content: file.body, contentType: file.contentType };
      }
      if (a.url.startsWith('s3://')) {
        return { filename: a.filename, path: await presign(a.url, 60 * 60 * 24) };
      }
      return { filename: a.filename, path: a.url };
    }),
  );

  await sendEmail({
    to,
    subject: interpolate(subject, resolvedVars),
    html,
    attachments: resolvedAttachments,
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
