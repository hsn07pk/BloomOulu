/**
 * Annual donation tax-certificate PDF.
 *
 * Two schemes:
 *   - **TVL §57 corporate**: Finnish corporate donor (intent=corporate) with
 *     a calendar-year aggregate donation of €850 – €250,000 to a Finnish
 *     university for scientific or artistic purposes. Deductible from
 *     business income.
 *   - **individual 2026**: Placeholder for the new 2026 individual-donor
 *     scheme. Until the exact thresholds + capped wording are finalised by
 *     Vero / lainsäädäntö, the PDF carries an "informational only" banner.
 *
 * Conforms to Finnish Kirjanpitolaki 2:5 § retention (6 years) — the PDF +
 * its sha256 are persisted on TaxCertificate.pdfUrl / pdfSha256 just like
 * regular Receipts.
 */
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
  type DocumentProps,
} from '@react-pdf/renderer';
import * as React from 'react';
import type { TaxCertificatePdfInput, OrgInfo } from './types.js';

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: 'Helvetica', fontSize: 11, color: '#1F3C2D' },
  hdrRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  hdrTitle: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#2D5440' },
  hdrSub: { fontSize: 9, color: '#777' },
  box: { padding: 12, marginBottom: 12, backgroundColor: '#F4F7EF', borderRadius: 4 },
  label: { fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontSize: 12, marginTop: 2 },
  totalValue: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#2D5440' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  footer: { position: 'absolute', bottom: 40, left: 48, right: 48, fontSize: 9, color: '#777' },
  hr: { borderBottom: '1pt solid #DDE6CB', marginVertical: 12 },
  banner: { padding: 8, marginBottom: 12, backgroundColor: '#FFF4D6', color: '#6B4F00', borderRadius: 4, fontSize: 10 },
});

const DEFAULT_ORG: OrgInfo = {
  name: process.env.GARDEN_ORG_NAME ?? 'Oulun yliopiston kasvitieteellinen puutarha',
  vatId: process.env.GARDEN_ORG_VAT_ID ?? 'FI02452579',
  iban: process.env.GARDEN_IBAN ?? 'FI00 0000 0000 0000 00',
  address: process.env.GARDEN_ADDRESS ?? 'Linnanmaa, 90014 Oulun yliopisto',
  email: process.env.GARDEN_CONTACT_EMAIL ?? 'garden@bloomoulu.fi',
};

const L = {
  en: {
    title: 'Annual donation certificate',
    no: 'Certificate no.',
    date: 'Issued',
    donor: 'Donor',
    year: 'Tax year',
    total: 'Total deductible donations',
    receipts: 'Underlying receipts',
    scheme: 'Scheme',
    schemeCorp: 'TVL §57 — Corporate donation to a Finnish university',
    schemeIndiv: '2026 individual donor scheme (informational; awaiting final guidance from Vero)',
    schemeInfo: 'Informational — not deductible at the current donation level',
    thanks: 'Thank you for supporting Finnish flora conservation.',
    legal: 'This certificate is issued under Finnish accounting law (Kirjanpitolaki 2:5 §). Retain for 6 years.',
    informationalBanner: 'INFORMATIONAL ONLY — final scheme parameters pending.',
  },
  fi: {
    title: 'Vuosittainen lahjoitustodistus',
    no: 'Todistusnro',
    date: 'Annettu',
    donor: 'Lahjoittaja',
    year: 'Verovuosi',
    total: 'Vähennyskelpoiset lahjoitukset yhteensä',
    receipts: 'Liittyvät kuitit',
    scheme: 'Järjestelmä',
    schemeCorp: 'TVL §57 — yrityksen lahjoitus suomalaiselle yliopistolle',
    schemeIndiv: 'Vuoden 2026 yksityishenkilön vähennysjärjestelmä (informatiivinen; lopulliset ohjeet Verolta odotettavissa)',
    schemeInfo: 'Tiedoksi — ei vähennyskelpoinen nykyisellä lahjoitustasolla',
    thanks: 'Kiitos suomalaisen luonnon suojelusta.',
    legal: 'Todistus annetaan kirjanpitolain 2:5 § mukaisesti. Säilytysaika 6 vuotta.',
    informationalBanner: 'INFORMATIIVINEN — järjestelmän lopulliset parametrit puuttuvat.',
  },
  sv: {
    title: 'Årligt donationsintyg',
    no: 'Intyg nr.',
    date: 'Utfärdat',
    donor: 'Donator',
    year: 'Beskattningsår',
    total: 'Avdragsgilla donationer totalt',
    receipts: 'Underliggande kvitton',
    scheme: 'System',
    schemeCorp: 'TVL §57 — Företagsdonation till finskt universitet',
    schemeIndiv: '2026 års system för privatpersoner (informativt; väntar slutlig vägledning från Vero)',
    schemeInfo: 'Informativt — inte avdragsgillt på nuvarande donationsnivå',
    thanks: 'Tack för att du stödjer den finska floran.',
    legal: 'Detta intyg utfärdas enligt finsk bokföringslag (Kirjanpitolaki 2:5 §). Bevaras i 6 år.',
    informationalBanner: 'ENBART INFORMATIVT — slutgiltiga parametrar väntar.',
  },
} as const;

function money(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-FI' : `${locale}-FI`, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

const TaxCertificate: React.FC<{ input: TaxCertificatePdfInput; org: OrgInfo }> = ({
  input,
  org,
}) => {
  const l = L[input.locale];
  const schemeLabel =
    input.scheme === 'TVL §57 corporate'
      ? l.schemeCorp
      : input.scheme === 'individual 2026'
        ? l.schemeIndiv
        : l.schemeInfo;
  const isInformational = input.scheme !== 'TVL §57 corporate';
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      React.createElement(
        View,
        { style: styles.hdrRow },
        React.createElement(
          View,
          null,
          React.createElement(Text, { style: styles.hdrTitle }, org.name),
          React.createElement(Text, { style: styles.hdrSub }, `${org.address} · Y-tunnus ${org.vatId}`),
        ),
        React.createElement(
          View,
          null,
          React.createElement(Text, { style: styles.hdrTitle }, l.title),
          React.createElement(Text, { style: styles.hdrSub }, `${l.no} ${input.certificateNumber}`),
          React.createElement(Text, { style: styles.hdrSub }, `${l.date} ${input.issuedAt.toLocaleDateString(input.locale)}`),
        ),
      ),
      React.createElement(View, { style: styles.hr }),
      isInformational
        ? React.createElement(Text, { style: styles.banner }, l.informationalBanner)
        : null,
      React.createElement(
        View,
        { style: styles.box },
        React.createElement(Text, { style: styles.label }, l.donor),
        React.createElement(Text, { style: styles.value }, input.donorName),
        input.donorAddress?.line1
          ? React.createElement(
              Text,
              { style: styles.value },
              `${input.donorAddress.line1}, ${input.donorAddress.postalCode ?? ''} ${input.donorAddress.city ?? ''}`,
            )
          : null,
      ),
      React.createElement(
        View,
        { style: styles.box },
        React.createElement(Text, { style: styles.label }, l.year),
        React.createElement(Text, { style: styles.value }, String(input.taxYear)),
      ),
      React.createElement(
        View,
        { style: styles.box },
        React.createElement(Text, { style: styles.label }, l.total),
        React.createElement(Text, { style: styles.totalValue }, money(input.totalCents, input.currency, input.locale)),
        React.createElement(Text, { style: styles.value }, schemeLabel),
      ),
      input.receiptNumbers.length > 0
        ? React.createElement(
            View,
            null,
            React.createElement(Text, { style: styles.label }, l.receipts),
            React.createElement(Text, { style: { fontSize: 9, color: '#555' } }, input.receiptNumbers.join(', ')),
          )
        : null,
      React.createElement(View, { style: styles.hr }),
      React.createElement(Text, { style: { fontSize: 10, marginBottom: 6 } }, l.thanks),
      React.createElement(Text, { style: { fontSize: 8, color: '#777' } }, l.legal),
      React.createElement(
        Text,
        { style: styles.footer },
        `${org.name} · ${org.email} · ${org.iban}`,
      ),
    ),
  );
};

export async function renderTaxCertificatePdf(
  input: TaxCertificatePdfInput,
  org: OrgInfo = DEFAULT_ORG,
): Promise<Buffer> {
  const doc = React.createElement(TaxCertificate, { input, org }) as React.ReactElement<DocumentProps>;
  const stream = await pdf(doc).toBuffer();
  const chunks: Buffer[] = [];
  return await new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
