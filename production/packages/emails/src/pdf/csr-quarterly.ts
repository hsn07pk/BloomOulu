/**
 * CSR quarterly impact report — corporate-tier PDF the donor company
 * receives every quarter. One page, A4, Garden brand palette.
 *
 * Includes:
 *   - Garden masthead + period
 *   - Hero: total funded this quarter in copper
 *   - Tier + adopted plant name
 *   - Plain-English copy for the CSR / sustainability report
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

const C = {
  paper: '#FCFAF3',
  ink: '#1F3C2D',
  inkMute: '#6F7E70',
  accent: '#A86A2B',
  rule: '#C8D3BD',
  box: '#F1ECDB',
} as const;

const styles = StyleSheet.create({
  page: { backgroundColor: C.paper, padding: 48, fontFamily: 'Helvetica', fontSize: 10, color: C.ink },
  mast: { flexDirection: 'row', justifyContent: 'space-between', borderBottom: `1pt solid ${C.rule}`, paddingBottom: 8, marginBottom: 18 },
  brandName: { fontFamily: 'Helvetica-Bold', fontSize: 13, color: C.ink },
  eyebrow: { fontSize: 9, color: C.accent, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 },
  h1: { fontFamily: 'Helvetica-Bold', fontSize: 22, color: C.ink, marginBottom: 12 },
  totalLabel: { fontSize: 11, color: C.inkMute, marginBottom: 6 },
  total: { fontFamily: 'Helvetica-Bold', fontSize: 38, color: C.accent, marginBottom: 4 },
  totalCaption: { fontSize: 11, color: C.inkMute, marginBottom: 24 },
  card: { padding: 14, backgroundColor: C.box, borderLeft: `3pt solid ${C.accent}`, marginBottom: 14 },
  cardTitle: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  bar: { height: 8, backgroundColor: C.rule, borderRadius: 2, marginVertical: 8 },
  barFill: { height: 8, backgroundColor: C.accent, borderRadius: 2 },
  note: { fontSize: 9, color: C.inkMute, marginTop: 12, lineHeight: 1.5 },
});

export interface CsrQuarterlyPdfInput {
  locale: 'en' | 'fi' | 'sv';
  donorName: string;
  plantName: string;
  tierName: string;
  quarterStart: Date;
  quarterEnd: Date;
  fundedCents: number;
  paymentCount: number;
  issuedAt: Date;
}

const L = {
  en: {
    eyebrow: 'Quarterly impact report',
    title: 'Conservation impact',
    fundedTitle: 'Total funded this quarter',
    fundedCaption: 'across {n} payment(s) from your corporate adoption',
    plantLine: 'Your adopted plant',
    note:
      'This document satisfies the CSR-reporting requirements set out in the EU CSRD ' +
      'directive for purpose-driven sustainability spending. The Garden retains audited ' +
      'records of every plant + payment referenced; full reconciliation is available on request.',
    issuedOn: 'Issued',
  },
  fi: {
    eyebrow: 'Neljännesvuotinen vaikuttavuusraportti',
    title: 'Suojeluvaikutus',
    fundedTitle: 'Rahoitettu yhteensä tällä neljänneksellä',
    fundedCaption: '{n} maksun kautta yrityksenne adoptiosta',
    plantLine: 'Adoptoimanne kasvi',
    note:
      'Tämä asiakirja täyttää EU:n CSRD-direktiivin mukaiset CSR-raportointivaatimukset. ' +
      'Puutarha säilyttää tilintarkastetut tiedot jokaisesta tähän viittauksesta tehdystä kasvista ja maksusta.',
    issuedOn: 'Annettu',
  },
  sv: {
    eyebrow: 'Kvartalsvis effektrapport',
    title: 'Bevarandeeffekt',
    fundedTitle: 'Finansierat totalt detta kvartal',
    fundedCaption: 'via {n} betalningar från ert företagsadoption',
    plantLine: 'Er adopterade växt',
    note:
      'Detta dokument uppfyller CSR-rapporteringskraven i EU:s CSRD-direktiv. ' +
      'Trädgården bevarar reviderade register över alla växter och betalningar som refereras.',
    issuedOn: 'Utfärdat',
  },
} as const;

function money(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-FI' : `${locale}-FI`, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

const Report: React.FC<{ input: CsrQuarterlyPdfInput }> = ({ input }) => {
  const l = L[input.locale] ?? L.en;
  const fmt = (d: Date): string =>
    d.toLocaleDateString(input.locale === 'en' ? 'en-GB' : `${input.locale}-FI`, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      React.createElement(
        View,
        { style: styles.mast },
        React.createElement(
          View,
          null,
          React.createElement(Text, { style: styles.brandName }, 'BloomOulu'),
          React.createElement(Text, { style: { fontSize: 8, color: C.inkMute } }, 'Oulun yliopiston kasvitieteellinen puutarha · Y-tunnus FI02452579'),
        ),
        React.createElement(
          View,
          null,
          React.createElement(Text, { style: { fontSize: 8, color: C.inkMute, textAlign: 'right' } }, `${fmt(input.quarterStart)} – ${fmt(input.quarterEnd)}`),
          React.createElement(Text, { style: { fontSize: 8, color: C.inkMute, textAlign: 'right' } }, input.donorName),
        ),
      ),
      React.createElement(Text, { style: styles.eyebrow }, l.eyebrow),
      React.createElement(Text, { style: styles.h1 }, l.title),
      React.createElement(Text, { style: styles.totalLabel }, l.fundedTitle),
      React.createElement(Text, { style: styles.total }, money(input.fundedCents, input.locale)),
      React.createElement(
        Text,
        { style: styles.totalCaption },
        l.fundedCaption.replace('{n}', String(input.paymentCount)),
      ),
      React.createElement(
        View,
        { style: styles.card },
        React.createElement(Text, { style: styles.cardTitle }, l.plantLine),
        React.createElement(Text, { style: { fontFamily: 'Times-BoldItalic', fontSize: 14 } }, input.plantName),
        React.createElement(Text, { style: { fontSize: 9, color: C.inkMute, marginTop: 4 } }, input.tierName),
      ),
      React.createElement(Text, { style: styles.note }, l.note),
      React.createElement(Text, { style: { ...styles.note, marginTop: 24, textAlign: 'right' } }, `${l.issuedOn} ${fmt(input.issuedAt)}`),
    ),
  );
};

export async function renderCsrQuarterlyPdf(input: CsrQuarterlyPdfInput): Promise<Buffer> {
  const doc = React.createElement(Report, { input }) as React.ReactElement<DocumentProps>;
  const stream = await pdf(doc).toBuffer();
  const chunks: Buffer[] = [];
  return await new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
