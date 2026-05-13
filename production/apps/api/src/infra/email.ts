/**
 * SMTP sender. Connects to Postal (FOSS, self-hosted) in production; uses
 * MailHog (Maildev) in dev for inspection.
 */
import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'postal',
    port: parseInt(process.env.SMTP_PORT ?? '25', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    pool: true,
    maxConnections: 5,
  });
  return transporter;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{ filename: string; url: string }>;
}

export async function sendEmail(msg: OutboundEmail): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM ?? 'BloomOulu <no-reply@bloomoulu.fi>',
    replyTo: process.env.EMAIL_REPLY_TO,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text ?? htmlToText(msg.html),
    attachments: msg.attachments?.map((a) => ({ filename: a.filename, path: a.url })),
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
