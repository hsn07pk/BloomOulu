/**
 * Bank-transfer instructions page.
 *
 * Reached when the donor's preferred provider is `bank_transfer` (the
 * router also picks it as the zero-fee default for FI donors when no
 * other provider is specified). Shows:
 *   - The amount and reference at a glance
 *   - Garden IBAN + BIC + beneficiary, mono-spaced
 *   - EPC069-12 SEPA QR code (every FI bank app scans it natively)
 *   - Printable view for donors who prefer a paper slip
 *
 * Reconciliation: the Garden's accountant uploads the daily bank
 * statement (camt.054 / pain.001) → cron POSTs each row to
 * /webhooks/bank-transfer → PaymentsService matches by RF body and
 * activates the adoption. No demo button — this page is the same in
 * dev and prod, so what the donor sees here matches reality.
 */
import { getTranslations } from 'next-intl/server';
import qrcode from 'qrcode-generator';
import { PrintButton } from './print-button.client';
import { internalApiUrl } from '../../../../lib/api';

export const dynamic = 'force-dynamic';

async function loadSettings() {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/settings/public`, { cache: 'no-store' });
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
  const ref = (sp.ref ?? '').replace(/\+/g, ' ');

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
      <header className="pay-page__header">
        <div className="eyebrow pay-page__eyebrow">
          {locale === 'fi' ? 'Pankkisiirto' : locale === 'sv' ? 'Bankgiro' : 'Bank transfer'}
        </div>
        <h1 className="pay-page__title">{t('title')}</h1>
        <p className="pay-page__lead">{t('openBankApp')}</p>
      </header>

      <div className="pay-page__grid">
        <section className="pay-page__details">
          <div className="pay-page__amount">
            <strong>€{(amount / 100).toFixed(2)}</strong>
            <span>{t('amount')}</span>
          </div>
          <dl style={{ margin: 0 }}>
            <div className="pay-page__row">
              <dt>{t('beneficiary')}</dt>
              <dd>{name}</dd>
            </div>
            <div className="pay-page__row">
              <dt>{t('iban')}</dt>
              <dd>{iban}</dd>
            </div>
            <div className="pay-page__row">
              <dt>{t('bic')}</dt>
              <dd>{bic}</dd>
            </div>
            <div className="pay-page__row">
              <dt>{t('reference')}</dt>
              <dd>{ref}</dd>
            </div>
          </dl>
        </section>

        <figure
          className="pay-page__qr"
          aria-label="EPC069-12 QR code for SEPA Credit Transfer"
        >
          <h2>
            {locale === 'fi' ? 'Skannaa pankkisovelluksella' : locale === 'sv' ? 'Skanna med din bankapp' : 'Scan with your bank app'}
          </h2>
          <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <figcaption>{t('qrCaption')}</figcaption>
        </figure>
      </div>

      <section className="pay-page__next">
        <h2>{t('next')}</h2>
        <p>{t('nextSteps')}</p>
      </section>

      <div className="pay-page__actions no-print">
        <a href={`/${locale}/garden`} className="btn btn-primary">
          {locale === 'fi' ? 'Avaa Oma puutarha' : locale === 'sv' ? 'Öppna Min trädgård' : 'Open My Garden'}
        </a>
        <PrintButton label={tc('print')} />
      </div>
    </main>
  );
}
