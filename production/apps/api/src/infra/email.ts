/**
 * SMTP sender. Requires real SMTP credentials in env — no dev catcher,
 * no local mailbox fallback. Set `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS`
 * (and `SMTP_SECURE=true` for SMTPS / `SMTP_PORT` for non-standard
 * ports) before sending mail.
 *
 * Common providers:
 *   • Gmail App Password — host=smtp.gmail.com, port=465, secure=true
 *   • Postal (self-hosted) — host=postal.example, port=25, secure=false
 *   • Postmark / SendGrid / SES — see provider docs for host/port
 *
 * If `SMTP_HOST` is unset, `sendEmail` throws immediately. That's by
 * design: silent send failures hide bugs in the magic-link / receipt /
 * dunning flows.
 */
import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const host = (process.env.SMTP_HOST ?? '').trim();
  if (!host) {
    throw new Error(
      'SMTP_HOST is not configured. Set SMTP_HOST + SMTP_USER + SMTP_PASS in .env ' +
        '(e.g. SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_SECURE=true, ' +
        'SMTP_USER=<you>@gmail.com, SMTP_PASS=<16-char-app-password>).',
    );
  }
  transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    pool: true,
    maxConnections: 5,
  });
  return transporter;
}

/**
 * One outbound message. Attachments may be supplied as either:
 *   • `path` — a filesystem path or http(s) URL nodemailer can fetch
 *   • `content` — an in-memory Buffer (used for local-disk blobs that
 *     don't have an external URL)
 * Exactly one of those must be present per attachment.
 */
export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: Buffer;
    contentType?: string;
  }>;
}

export async function sendEmail(msg: OutboundEmail): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM ?? 'BloomOulu <no-reply@bloomoulu.fi>',
    replyTo: process.env.EMAIL_REPLY_TO,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text ?? htmlToText(msg.html),
    attachments: msg.attachments?.map((a) => ({
      filename: a.filename,
      path: a.path,
      content: a.content,
      contentType: a.contentType,
    })),
  });
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
