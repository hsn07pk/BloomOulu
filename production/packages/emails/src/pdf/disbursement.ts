/**
 * Disbursement claim PDF — the human-readable companion to the CSV.
 *
 * UoO finance teams often prefer a one-page signed document on letterhead
 * over a raw .csv, both for filing and to attach as the "voucher" against
 * the internal cost-centre transfer.
 *
 * Layout:
 *   - Garden masthead + Y-tunnus / IBAN (so UoO routes the transfer to
 *     the right account from the start)
 *   - "Claim for reimbursement" eyebrow
 *   - Reference (DISB-YYYY-NNN) + period
 *   - Summary box: number of payments, gross / fees / net
 *   - Line items table (donor email · provider · gross · fee · net)
 *   - Authorisation block (Garden Director / Finance Manager)
 *   - Footer with CSV sha256 (tamper-evidence cross-reference) +
 *     contact email for queries
 *
 * Deterministic and idempotent — same Disbursement row produces the same
 * bytes (modulo the issuedAt timestamp the caller passes in). All ink in
 * the Garden's brand deep-forest with copper accents on totals.
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
import type { OrgInfo } from './types.js';

const C = {
  paper: '#FCFAF3',
  ink: '#1F3C2D',
  inkSoft: '#3C5A4A',
  inkMute: '#6F7E70',
  accent: '#A86A2B',
  rule: '#C8D3BD',
  box: '#F1ECDB',
} as const;

const styles = StyleSheet.create({
  page: {
    backgroundColor: C.paper,
    padding: 48,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: C.ink,
  },
  // Masthead
  mast: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 22,
    borderBottom: `1pt solid ${C.rule}`,
    paddingBottom: 10,
  },
  mastTitle: { fontFamily: 'Helvetica-Bold', fontSize: 14, color: C.ink },
  mastSub: { fontSize: 9, color: C.inkMute, marginTop: 3 },
  // Header
  eyebrow: {
    fontSize: 9,
    color: C.accent,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  h1: { fontFamily: 'Helvetica-Bold', fontSize: 22, color: C.ink, marginBottom: 4 },
  ref: { fontFamily: 'Helvetica', fontSize: 12, color: C.inkSoft, marginBottom: 24 },
  // Summary box
  summary: {
    backgroundColor: C.box,
    borderLeft: `3pt solid ${C.accent}`,
    padding: 14,
    marginBottom: 22,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  summaryLabel: { fontSize: 10, color: C.inkSoft },
  summaryValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.ink },
  summaryNet: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.accent },
  // Table
  tableHeader: {
    flexDirection: 'row',
    borderBottom: `1pt solid ${C.ink}`,
    paddingBottom: 4,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: `0.4pt solid ${C.rule}`,
    paddingVertical: 3,
  },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: C.inkSoft, letterSpacing: 0.5 },
  td: { fontSize: 9, color: C.ink },
  colDonor: { width: '32%' },
  colProvider: { width: '12%' },
  colDate: { width: '18%' },
  colGross: { width: '12%', textAlign: 'right' },
  colFee: { width: '11%', textAlign: 'right' },
  colNet: { width: '15%', textAlign: 'right' },
  // Auth
  authRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 36 },
  authBlock: { width: 220 },
  authLine: { width: 200, borderBottom: `0.8pt solid ${C.ink}`, marginBottom: 6, marginTop: 28 },
  authName: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: C.ink },
  authRole: { fontSize: 8, color: C.inkMute, marginTop: 2 },
  // Footer
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 48,
    right: 48,
    borderTop: `0.5pt solid ${C.rule}`,
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: C.inkMute,
  },
  note: { fontSize: 8, color: C.inkMute, marginTop: 12, lineHeight: 1.4 },
});

const L = {
  en: {
    eyebrow: 'Claim for reimbursement',
    h1: 'Disbursement claim',
    summaryTitle: 'Summary',
    entries: 'Included payments',
    gross: 'Gross',
    fee: 'Provider fees',
    net: 'Net due',
    period: 'Period',
    table: { donor: 'Donor', provider: 'Provider', date: 'Settled', gross: 'Gross €', fee: 'Fee €', net: 'Net €' },
    submittedBy: 'Submitted by',
    director: 'Garden Director',
    finance: 'Finance Manager',
    payTo: 'Payable to',
    note:
      'Please apply the funds to the Garden cost-centre using the disbursement reference shown above. ' +
      'Provider fees are subtracted from the gross before transfer. ' +
      'The accompanying CSV file (sha256 below) carries the per-payment detail for reconciliation against your bank statements.',
    csvHash: 'CSV integrity (sha256)',
    refNo: 'Reference',
    page: 'Page',
  },
  fi: {
    eyebrow: 'Korvausvaatimus',
    h1: 'Tilitysvaatimus',
    summaryTitle: 'Yhteenveto',
    entries: 'Sisältyvät maksut',
    gross: 'Brutto',
    fee: 'Palveluntarjoajan kulut',
    net: 'Nettomaksu',
    period: 'Jakso',
    table: { donor: 'Lahjoittaja', provider: 'Tarjoaja', date: 'Selvitetty', gross: 'Brutto €', fee: 'Kulut €', net: 'Netto €' },
    submittedBy: 'Lähetti',
    director: 'Puutarhan johtaja',
    finance: 'Talouspäällikkö',
    payTo: 'Maksun saaja',
    note:
      'Pyydämme kohdistamaan varat puutarhan kustannuspaikalle yllä olevaa tilitysviitettä käyttäen. ' +
      'Palveluntarjoajan kulut on vähennetty bruttosummasta ennen siirtoa. ' +
      'Mukana oleva CSV-tiedosto (sha256 alla) sisältää maksukohtaiset tiedot pankkitiliotteen täsmäytystä varten.',
    csvHash: 'CSV-eheys (sha256)',
    refNo: 'Viite',
    page: 'Sivu',
  },
  sv: {
    eyebrow: 'Ersättningsanspråk',
    h1: 'Utbetalningskrav',
    summaryTitle: 'Sammanfattning',
    entries: 'Inkluderade betalningar',
    gross: 'Brutto',
    fee: 'Leverantörens avgifter',
    net: 'Netto att betala',
    period: 'Period',
    table: { donor: 'Donator', provider: 'Leverantör', date: 'Avräknad', gross: 'Brutto €', fee: 'Avgift €', net: 'Netto €' },
    submittedBy: 'Insänd av',
    director: 'Trädgårdsdirektör',
    finance: 'Ekonomichef',
    payTo: 'Betalningsmottagare',
    note:
      'Vänligen tillämpa medlen på trädgårdens kostnadsställe med användning av referensen ovan. ' +
      'Leverantörsavgifter har subtraherats från bruttobeloppet före överföring. ' +
      'Den medföljande CSV-filen (sha256 nedan) innehåller betalningsdetaljer för avstämning mot ert kontoutdrag.',
    csvHash: 'CSV-integritet (sha256)',
    refNo: 'Referens',
    page: 'Sida',
  },
} as const;

export interface DisbursementPdfInput {
  reference: string;
  locale: 'en' | 'fi' | 'sv';
  periodStart: Date;
  periodEnd: Date;
  status: string;
  expectedCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
  csvSha256?: string | null;
  issuedAt: Date;
  entries: Array<{
    donorEmail: string;
    donorName?: string | null;
    provider: string;
    paidAt: Date | null;
    amountCents: number;
    feeCents: number;
    netCents: number;
    plantName?: string | null;
  }>;
  // Optional override of signatories (defaults to the Garden's standing
  // Director + Finance Manager names).
  directorName?: string;
  financeName?: string;
}

function money(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-FI' : `${locale}-FI`, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function shortDate(d: Date, locale: string): string {
  return d.toLocaleDateString(locale === 'en' ? 'en-GB' : `${locale}-FI`, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const DEFAULT_ORG: OrgInfo = {
  name: process.env.GARDEN_ORG_NAME ?? 'Oulun yliopiston kasvitieteellinen puutarha',
  vatId: process.env.GARDEN_ORG_VAT_ID ?? 'FI02452579',
  iban: process.env.GARDEN_IBAN ?? 'FI00 0000 0000 0000 00',
  address: process.env.GARDEN_ADDRESS ?? 'Linnanmaa, 90014 Oulun yliopisto',
  email: process.env.GARDEN_FINANCE_EMAIL ?? 'finance@bloomoulu.fi',
};

const Disbursement: React.FC<{ input: DisbursementPdfInput; org: OrgInfo }> = ({ input, org }) => {
  const l = L[input.locale] ?? L.en;
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      // Masthead
      React.createElement(
        View,
        { style: styles.mast },
        React.createElement(
          View,
          null,
          React.createElement(Text, { style: styles.mastTitle }, org.name),
          React.createElement(Text, { style: styles.mastSub }, `${org.address} · Y-tunnus ${org.vatId}`),
          React.createElement(Text, { style: styles.mastSub }, `IBAN ${org.iban}`),
        ),
        React.createElement(
          View,
          null,
          React.createElement(Text, { style: { ...styles.mastSub, textAlign: 'right' } }, `${l.refNo}: ${input.reference}`),
          React.createElement(Text, { style: { ...styles.mastSub, textAlign: 'right' } }, shortDate(input.issuedAt, input.locale)),
        ),
      ),
      // Header
      React.createElement(Text, { style: styles.eyebrow }, l.eyebrow),
      React.createElement(Text, { style: styles.h1 }, l.h1),
      React.createElement(
        Text,
        { style: styles.ref },
        `${l.period}: ${shortDate(input.periodStart, input.locale)} – ${shortDate(input.periodEnd, input.locale)}`,
      ),
      // Summary
      React.createElement(
        View,
        { style: styles.summary },
        React.createElement(Text, { style: { ...styles.eyebrow, color: C.inkSoft, marginBottom: 8 } }, l.summaryTitle),
        React.createElement(
          View,
          { style: styles.summaryRow },
          React.createElement(Text, { style: styles.summaryLabel }, l.entries),
          React.createElement(Text, { style: styles.summaryValue }, String(input.entries.length)),
        ),
        React.createElement(
          View,
          { style: styles.summaryRow },
          React.createElement(Text, { style: styles.summaryLabel }, l.gross),
          React.createElement(Text, { style: styles.summaryValue }, money(input.expectedCents, input.currency, input.locale)),
        ),
        React.createElement(
          View,
          { style: styles.summaryRow },
          React.createElement(Text, { style: styles.summaryLabel }, l.fee),
          React.createElement(Text, { style: styles.summaryValue }, `− ${money(input.feeCents, input.currency, input.locale)}`),
        ),
        React.createElement(
          View,
          { style: { ...styles.summaryRow, marginTop: 6, borderTop: `0.5pt solid ${C.rule}`, paddingTop: 8 } },
          React.createElement(Text, { style: { ...styles.summaryLabel, fontFamily: 'Helvetica-Bold', color: C.ink } }, l.net),
          React.createElement(Text, { style: styles.summaryNet }, money(input.netCents, input.currency, input.locale)),
        ),
      ),
      // Table header
      React.createElement(
        View,
        { style: styles.tableHeader },
        React.createElement(Text, { style: { ...styles.th, ...styles.colDonor } }, l.table.donor),
        React.createElement(Text, { style: { ...styles.th, ...styles.colProvider } }, l.table.provider),
        React.createElement(Text, { style: { ...styles.th, ...styles.colDate } }, l.table.date),
        React.createElement(Text, { style: { ...styles.th, ...styles.colGross } }, l.table.gross),
        React.createElement(Text, { style: { ...styles.th, ...styles.colFee } }, l.table.fee),
        React.createElement(Text, { style: { ...styles.th, ...styles.colNet } }, l.table.net),
      ),
      // Rows — limit displayed rows to a reasonable count so the PDF
      // stays one page. CSV carries the full detail.
      ...input.entries.slice(0, 18).map((e, i) =>
        React.createElement(
          View,
          { style: styles.tableRow, key: `r${i}` },
          React.createElement(
            Text,
            { style: { ...styles.td, ...styles.colDonor } },
            (e.donorName ?? e.donorEmail).slice(0, 36),
          ),
          React.createElement(Text, { style: { ...styles.td, ...styles.colProvider } }, e.provider),
          React.createElement(
            Text,
            { style: { ...styles.td, ...styles.colDate } },
            e.paidAt ? shortDate(e.paidAt, input.locale) : '—',
          ),
          React.createElement(
            Text,
            { style: { ...styles.td, ...styles.colGross } },
            (e.amountCents / 100).toFixed(2),
          ),
          React.createElement(
            Text,
            { style: { ...styles.td, ...styles.colFee } },
            (e.feeCents / 100).toFixed(2),
          ),
          React.createElement(
            Text,
            { style: { ...styles.td, ...styles.colNet, fontFamily: 'Helvetica-Bold' } },
            (e.netCents / 100).toFixed(2),
          ),
        ),
      ),
      input.entries.length > 18
        ? React.createElement(
            Text,
            { style: { ...styles.note, fontStyle: 'italic' } },
            `… +${input.entries.length - 18} more — see the accompanying CSV file.`,
          )
        : null,
      // Note
      React.createElement(Text, { style: styles.note }, l.note),
      // Auth
      React.createElement(
        View,
        { style: styles.authRow },
        React.createElement(
          View,
          { style: styles.authBlock },
          React.createElement(Text, { style: { fontSize: 9, color: C.inkMute } }, l.submittedBy),
          React.createElement(View, { style: styles.authLine }),
          React.createElement(
            Text,
            { style: styles.authName },
            input.directorName ?? 'Anna-Liisa Ruotsalainen',
          ),
          React.createElement(Text, { style: styles.authRole }, l.director),
        ),
        React.createElement(
          View,
          { style: styles.authBlock },
          React.createElement(Text, { style: { fontSize: 9, color: C.inkMute } }, l.payTo),
          React.createElement(View, { style: styles.authLine }),
          React.createElement(
            Text,
            { style: styles.authName },
            input.financeName ?? 'Marko Hyvärinen',
          ),
          React.createElement(Text, { style: styles.authRole }, l.finance),
        ),
      ),
      // Footer
      React.createElement(
        View,
        { style: styles.footer },
        React.createElement(Text, null, `${l.csvHash}: ${input.csvSha256 ?? '—'}`),
        React.createElement(Text, null, org.email),
      ),
    ),
  );
};

export async function renderDisbursementPdf(
  input: DisbursementPdfInput,
  org: OrgInfo = DEFAULT_ORG,
): Promise<Buffer> {
  const doc = React.createElement(Disbursement, { input, org }) as React.ReactElement<DocumentProps>;
  const stream = await pdf(doc).toBuffer();
  const chunks: Buffer[] = [];
  return await new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
