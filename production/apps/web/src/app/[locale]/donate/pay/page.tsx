/**
 * Bank-transfer instructions page.
 *
 * Reached after the adopt form when payment_method=bank_transfer. Shows:
 *   - Garden IBAN + BIC + beneficiary
 *   - Amount + RF reference
 *   - QR code that opens the donor's banking app (RFC 8905 payto: URI)
 *   - Printable view
 */
import { getTranslations } from 'next-intl/server';
import qrcode from 'qrcode-generator';

export const dynamic = 'force-dynamic';

async function loadSettings() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const res = await fetch(`${apiUrl}/v1/settings/public`, { next: { revalidate: 60 } });
  return res.ok ? res.json() : null;
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
  const t = await getTranslations({ locale, namespace: 'Pay' });
  const settings = await loadSettings();
  const iban = settings?.bankTransfer?.iban ?? 'FI00 0000 0000 0000 00';
  const bic = settings?.bankTransfer?.bic ?? 'NDEAFIHH';
  const name = settings?.bankTransfer?.beneficiaryName ?? 'BloomOulu';
  const amount = parseInt(sp.amount ?? '0', 10);
  const ref = sp.ref ?? '';

  // SEPA payment QR (EPC069-12: Stiftung EuroBanknotenStandard).
  const epc = [
    'BCD', '002', '1', 'SCT',
    bic.replace(/\s+/g, ''),
    name,
    iban.replace(/\s+/g, ''),
    `EUR${(amount / 100).toFixed(2)}`,
    '', '',
    `RF ${ref.replace(/^RF\s*/, '')}`,
  ].join('\n');
  const qr = qrcode(8, 'M');
  qr.addData(epc);
  qr.make();
  const qrSvg = qr.createSvgTag({ scalable: true });

  return (
    <main>
      <h1>{t('bankInstructions.title')}</h1>
      <p>{t('bankInstructions.openBankApp')}</p>
      <dl className="bank-instructions">
        <dt>{t('bankInstructions.iban')}</dt><dd><code>{iban}</code></dd>
        <dt>{t('bankInstructions.bic')}</dt><dd><code>{bic}</code></dd>
        <dt>{t('bankInstructions.amount')}</dt><dd><code>€{(amount / 100).toFixed(2)}</code></dd>
        <dt>{t('bankInstructions.reference')}</dt><dd><code>{ref}</code></dd>
      </dl>
      <figure aria-label="EPC QR code for SEPA Credit Transfer">
        <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
        <figcaption>Open your bank app's camera and scan to pre-fill the transfer.</figcaption>
      </figure>
      <p style={{ marginTop: 24 }}>
        <button onClick={() => window.print()}>Print this page</button>
      </p>
    </main>
  );
}
