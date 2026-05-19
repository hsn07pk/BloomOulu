/**
 * Bank-transfer instructions page.
 *
 * Reached after the adopt form when payment_method=bank_transfer. Shows:
 *   - Garden IBAN + BIC + beneficiary
 *   - Amount + RF reference
 *   - EPC069-12 SEPA QR code (scannable by Nordea / OP / S-Pankki / etc.)
 *   - Printable view
 *
 * The donor's banking app supports the EPC QR natively — they scan, confirm,
 * and the payment is reconciled automatically when the Garden's accountant
 * uploads the next bank statement.
 */
import { getTranslations } from 'next-intl/server';
import qrcode from 'qrcode-generator';
import { PrintButton } from './print-button.client';
import { internalApiUrl } from '../../../../lib/api';

export const dynamic = 'force-dynamic';

async function loadSettings() {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/settings/public`, { next: { revalidate: 60 } });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ orderId?: string; amount?: string; ref?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: 'Pay.bankInstructions' });
  const tc = await getTranslations({ locale, namespace: 'Common' });
  const settings = await loadSettings();
  const iban = settings?.bankTransfer?.iban ?? 'FI00 0000 0000 0000 00';
  const bic = settings?.bankTransfer?.bic ?? 'OKOYFIHH';
  const name = settings?.bankTransfer?.beneficiaryName ?? 'BloomOulu';
  const amount = parseInt(sp.amount ?? '0', 10);
  const ref = sp.ref ?? '';

  // EPC069-12 SEPA Credit Transfer QR (European Payments Council standard).
  // Field order is fixed by the spec; every line is significant.
  const epc = [
    'BCD',                                  // Service tag
    '002',                                  // Version
    '1',                                    // Charset (UTF-8)
    'SCT',                                  // Function (SEPA Credit Transfer)
    bic.replace(/\s+/g, ''),                // BIC
    name,                                   // Beneficiary name
    iban.replace(/\s+/g, ''),               // IBAN
    `EUR${(amount / 100).toFixed(2)}`,      // Amount
    '',                                     // Purpose code (optional)
    '',                                     // Structured reference (we use unstructured below)
    `RF ${ref.replace(/^RF\s*/, '')}`,      // Unstructured reference — the RF Creditor Reference
  ].join('\n');
  const qr = qrcode(8, 'M');
  qr.addData(epc);
  qr.make();
  const qrSvg = qr.createSvgTag({ scalable: true });

  return (
    <main className="pay-page">
      <h1>{t('title')}</h1>
      <p>{t('openBankApp')}</p>
      <dl className="bank-instructions">
        <dt>{t('beneficiary')}</dt><dd>{name}</dd>
        <dt>{t('iban')}</dt><dd><code>{iban}</code></dd>
        <dt>{t('bic')}</dt><dd><code>{bic}</code></dd>
        <dt>{t('amount')}</dt><dd><code>€{(amount / 100).toFixed(2)}</code></dd>
        <dt>{t('reference')}</dt><dd><code>{ref}</code></dd>
      </dl>
      <figure aria-label="EPC069-12 QR code for SEPA Credit Transfer">
        <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        <figcaption>{t('qrCaption')}</figcaption>
      </figure>
      <section>
        <h2>{t('next')}</h2>
        <p>{t('nextSteps')}</p>
      </section>
      <p className="no-print" style={{ marginTop: 24 }}>
        <PrintButton label={tc('print')} />
      </p>
    </main>
  );
}
