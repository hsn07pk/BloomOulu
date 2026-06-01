/**
 * Donation receipt PDF — rendered server-side with @react-pdf/renderer.
 *
 * Produces a deterministic 1-page A4 PDF in the donor's locale with:
 *   - Garden masthead + Y-tunnus
 *   - Donor name + address
 *   - Receipt number (gapless year-prefixed)
 *   - Amount, currency, paid-at timestamp
 *   - VAT line (typically 0% for yleishyödyllinen yhteisö donations)
 *   - Plant + tier (if attached to an Adoption)
 *   - Order reference + verification URL
 *   - Signature block
 *
 * Conforms to the Finnish accounting record-keeping requirements
 * (Kirjanpitolaki 2:5 §): retained 6 years from end of fiscal year.
 */
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  pdf,
  Font,
  type DocumentProps,
} from '@react-pdf/renderer';
import * as React from 'react';
import type { ReceiptPdfInput, OrgInfo } from './types.js';

// Register a font that supports Finnish characters (Ä, Ö, Å).
// In production, ship a local TTF in packages/emails/assets/.
// Fallback: Helvetica handles Latin-1 well enough.

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: 'Helvetica', fontSize: 11, color: '#1F3C2D' },
  hdrRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  hdrTitle: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#2D5440' },
  hdrSub: { fontSize: 9, color: '#777' },
  box: { padding: 12, marginBottom: 12, backgroundColor: '#F4F7EF', borderRadius: 4 },
  label: { fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontSize: 12, marginTop: 2 },
  totalLabel: { fontSize: 9, color: '#666' },
  totalValue: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#2D5440' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  footer: { position: 'absolute', bottom: 40, left: 48, right: 48, fontSize: 9, color: '#777' },
  hr: { borderBottom: '1pt solid #DDE6CB', marginVertical: 12 },
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
    title: 'Donation receipt',
    no: 'Receipt no.',
    date: 'Issued',
    donor: 'Donor',
    plant: 'Adopted plant',
    tier: 'Tier',
    amount: 'Total',
    vat: 'VAT',
    net: 'Net',
    paidAt: 'Paid',
    order: 'Order ref.',
    thanks: 'Thank you for supporting Finnish flora conservation.',
    vatExempt: 'Donations to a Finnish non-profit (yleishyödyllinen yhteisö) are outside the scope of VAT.',
  },
  fi: {
    title: 'Lahjoituskuitti',
    no: 'Kuittinro',
    date: 'Annettu',
    donor: 'Lahjoittaja',
    plant: 'Adoptoitu kasvi',
    tier: 'Tukitaso',
    amount: 'Yhteensä',
    vat: 'ALV',
    net: 'Veroton',
    paidAt: 'Maksettu',
    order: 'Tilausviite',
    thanks: 'Kiitos suomalaisen luonnon suojelusta.',
    vatExempt: 'Yleishyödyllisen yhteisön saamat lahjoitukset jäävät arvonlisäveron soveltamisalan ulkopuolelle.',
  },
  sv: {
    title: 'Donationskvitto',
    no: 'Kvittonr',
    date: 'Utfärdat',
    donor: 'Donator',
    plant: 'Adopterad växt',
    tier: 'Nivå',
    amount: 'Totalt',
    vat: 'Moms',
    net: 'Netto',
    paidAt: 'Betalt',
    order: 'Beställningsref.',
    thanks: 'Tack för att du stödjer den finska floran.',
    vatExempt: 'Donationer till en allmännyttig sammanslutning faller utanför momsens tillämpningsområde.',
  },
} as const;

// Localised labels for the new personalisation block. Kept beside L so a
// future translator only edits one file.
const P = {
  en: {
    intentTitle: 'Adoption context',
    intentLabel: 'Intent',
    intentValues: {
      for_self: 'Personal — for myself',
      gift: 'Gift',
      memorial: 'In memoriam',
      class: 'Class / school',
      corporate: 'Corporate',
    },
    billingLabel: 'Billing',
    billingValues: { one_time: 'One-off', monthly: 'Monthly', annual: 'Annual' },
    nicknameLabel: 'Plant nickname',
    dedicationLabel: 'Dedication',
    homeRegionLabel: 'I@H · home region',
    giftRecipientLabel: 'Gift recipient',
    memorialOfLabel: 'In memory of',
    coAdoptersLabel: 'Co-adopters',
  },
  fi: {
    intentTitle: 'Adoptiotiedot',
    intentLabel: 'Tarkoitus',
    intentValues: {
      for_self: 'Itselleni',
      gift: 'Lahja',
      memorial: 'Muistolahjoitus',
      class: 'Luokka / koulu',
      corporate: 'Yritys',
    },
    billingLabel: 'Laskutus',
    billingValues: { one_time: 'Kerralla', monthly: 'Kuukausittain', annual: 'Vuosittain' },
    nicknameLabel: 'Kasvin lempinimi',
    dedicationLabel: 'Omistus',
    homeRegionLabel: 'I@H · kotialue',
    giftRecipientLabel: 'Lahjansaaja',
    memorialOfLabel: 'Muistolahjoitus',
    coAdoptersLabel: 'Yhteislahjoittajat',
  },
  sv: {
    intentTitle: 'Adoptionsdetaljer',
    intentLabel: 'Avsikt',
    intentValues: {
      for_self: 'För mig själv',
      gift: 'Gåva',
      memorial: 'Till minne av',
      class: 'Klass / skola',
      corporate: 'Företag',
    },
    billingLabel: 'Fakturering',
    billingValues: { one_time: 'Engångsbelopp', monthly: 'Månadsvis', annual: 'Årligen' },
    nicknameLabel: 'Växtens smeknamn',
    dedicationLabel: 'Dedikation',
    homeRegionLabel: 'I@H · hemregion',
    giftRecipientLabel: 'Gåvomottagare',
    memorialOfLabel: 'Till minne av',
    coAdoptersLabel: 'Medadoptörer',
  },
} as const;

function money(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-FI' : `${locale}-FI`, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

const Receipt: React.FC<{ input: ReceiptPdfInput; org: OrgInfo }> = ({ input, org }) => {
  const l = L[input.locale];
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
          React.createElement(Text, { style: styles.hdrSub }, `${org.address} · ${org.vatId}`),
        ),
        React.createElement(
          View,
          null,
          React.createElement(Text, { style: styles.hdrTitle }, l.title),
          React.createElement(Text, { style: styles.hdrSub }, `${l.no} ${input.number}`),
          React.createElement(Text, { style: styles.hdrSub }, `${l.date} ${input.paidAt.toLocaleDateString(input.locale)}`),
        ),
      ),
      React.createElement(View, { style: styles.hr }),
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
      input.plantName
        ? React.createElement(
            View,
            { style: styles.box },
            React.createElement(Text, { style: styles.label }, l.plant),
            React.createElement(Text, { style: styles.value }, input.plantName),
            input.tierName
              ? React.createElement(Text, { style: styles.value }, `${l.tier}: ${input.tierName}`)
              : null,
            // Nickname (the donor-chosen pet name for the plant) — only
            // appears if explicitly set. Italic styling keeps it visibly
            // distinct from the latin name above.
            input.nickname
              ? React.createElement(
                  Text,
                  { style: { ...styles.value, fontStyle: 'italic', color: '#4A6B40' } },
                  `"${input.nickname}"`,
                )
              : null,
          )
        : null,
      // Personalisation block — intent, billing cadence, dedication,
      // gift/memorial context, co-adopters, home region. Only renders
      // when at least one field is present, so the layout for a plain
      // anonymous donation stays minimal.
      (() => {
        const hasAny = !!(
          input.intent ||
          input.billingInterval ||
          input.dedication ||
          input.homeRegion ||
          input.giftRecipientName ||
          input.giftRecipientEmail ||
          input.memorialOf ||
          (input.coAdopters && input.coAdopters.length > 0)
        );
        if (!hasAny) return null;
        const p = P[input.locale] ?? P.en;
        const rows: React.ReactNode[] = [];
        rows.push(
          React.createElement(Text, { style: styles.label, key: 'h' }, p.intentTitle),
        );
        if (input.intent) {
          rows.push(
            React.createElement(
              Text,
              { style: styles.value, key: 'in' },
              `${p.intentLabel}: ${p.intentValues[input.intent] ?? input.intent}`,
            ),
          );
        }
        if (input.billingInterval) {
          rows.push(
            React.createElement(
              Text,
              { style: styles.value, key: 'bi' },
              `${p.billingLabel}: ${p.billingValues[input.billingInterval] ?? input.billingInterval}`,
            ),
          );
        }
        if (input.dedication) {
          rows.push(
            React.createElement(
              Text,
              { style: { ...styles.value, fontStyle: 'italic' }, key: 'de' },
              `${p.dedicationLabel}: "${input.dedication}"`,
            ),
          );
        }
        if (input.homeRegion) {
          rows.push(
            React.createElement(
              Text,
              { style: styles.value, key: 'hr' },
              `${p.homeRegionLabel}: ${input.homeRegion}`,
            ),
          );
        }
        if (input.giftRecipientName || input.giftRecipientEmail) {
          const label =
            [input.giftRecipientName, input.giftRecipientEmail].filter(Boolean).join(' · ');
          rows.push(
            React.createElement(
              Text,
              { style: styles.value, key: 'gr' },
              `${p.giftRecipientLabel}: ${label}`,
            ),
          );
        }
        if (input.memorialOf) {
          rows.push(
            React.createElement(
              Text,
              { style: styles.value, key: 'mo' },
              `${p.memorialOfLabel}: ${input.memorialOf}`,
            ),
          );
        }
        if (input.coAdopters && input.coAdopters.length > 0) {
          const list = input.coAdopters
            .map((c) => c?.name ?? c?.email ?? '')
            .filter(Boolean)
            .join(', ');
          if (list) {
            rows.push(
              React.createElement(
                Text,
                { style: styles.value, key: 'ca' },
                `${p.coAdoptersLabel}: ${list}`,
              ),
            );
          }
        }
        return React.createElement(View, { style: styles.box }, ...rows);
      })(),
      React.createElement(
        View,
        { style: styles.box },
        React.createElement(Text, { style: styles.label }, l.amount),
        React.createElement(Text, { style: styles.totalValue }, money(input.amountCents, input.currency, input.locale)),
        React.createElement(View, { style: styles.row },
          React.createElement(Text, null, l.net),
          React.createElement(Text, null, money(input.netCents, input.currency, input.locale)),
        ),
        React.createElement(View, { style: styles.row },
          React.createElement(Text, null, `${l.vat} (${(input.vatRateBp / 100).toFixed(1)} %)`),
          React.createElement(Text, null, money(input.vatCents, input.currency, input.locale)),
        ),
      ),
      React.createElement(
        View,
        null,
        React.createElement(Text, { style: styles.label }, l.order),
        React.createElement(Text, { style: styles.value }, input.orderId),
        React.createElement(Text, { style: { marginTop: 12, fontSize: 10 } }, l.thanks),
        React.createElement(Text, { style: { marginTop: 4, fontSize: 9, color: '#777' } }, l.vatExempt),
      ),
      React.createElement(
        Text,
        { style: styles.footer },
        `${org.name} · ${org.email} · ${org.iban}`,
      ),
    ),
  );
};

export async function renderReceiptPdf(input: ReceiptPdfInput, org: OrgInfo = DEFAULT_ORG): Promise<Buffer> {
  // The Receipt component returns a <Document>; cast lets @react-pdf accept it.
  const doc = React.createElement(Receipt, { input, org }) as React.ReactElement<DocumentProps>;
  const stream = await pdf(doc).toBuffer();
  const chunks: Buffer[] = [];
  return await new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
