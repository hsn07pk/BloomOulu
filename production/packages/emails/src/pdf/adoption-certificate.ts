/**
 * Adoption certificate PDF — the keepsake document a donor receives for
 * each Adoption. Designed to feel like a real award:
 *
 *   - Deep forest-green typography on cream paper
 *   - Ornate corner flourishes + a double-rule border
 *   - Donor name set in a large italic display style as the visual hero
 *   - Plant set in italic Latin per botanical convention, with a common
 *     name caption underneath
 *   - Dedication block highlighted with a side accent rule
 *   - Garden Director signature block + certificate-number footer
 *
 * Renders in three locales (en/fi/sv). No external image assets — the
 * frame and flourishes are drawn with vector primitives so the PDF
 * stays small and self-contained.
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

// ─── Theme ──────────────────────────────────────────────────────────
//  Paper:  cream / ivory
//  Ink:    deep forest green (Garden brand)
//  Accent: warm copper for the donor name + ornaments
const C = {
  paper: '#FCF8EE',
  ink: '#1F3C2D',
  inkSoft: '#3C5A4A',
  inkMute: '#6F7E70',
  accent: '#A86A2B',
  rule: '#5A7060',
  ruleSoft: '#D5C9A8',
} as const;

const styles = StyleSheet.create({
  page: {
    backgroundColor: C.paper,
    padding: 36,
    fontFamily: 'Helvetica',
    color: C.ink,
  },
  // Two nested borders give the document a frame-on-velvet feeling.
  outerFrame: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: C.rule,
    padding: 6,
  },
  innerFrame: {
    flex: 1,
    borderWidth: 0.6,
    borderColor: C.rule,
    paddingHorizontal: 40,
    paddingVertical: 52,
    alignItems: 'center',
  },
  ornament: {
    fontFamily: 'Times-Italic',
    fontSize: 18,
    color: C.accent,
    letterSpacing: 8,
    marginBottom: 12,
  },
  eyebrow: {
    fontSize: 10,
    color: C.inkMute,
    letterSpacing: 4,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  title: {
    fontFamily: 'Times-Bold',
    fontSize: 30,
    color: C.ink,
    letterSpacing: 1.5,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: 'Times-Italic',
    fontSize: 12,
    color: C.inkSoft,
    textAlign: 'center',
    marginBottom: 28,
  },
  introLine: {
    fontFamily: 'Times-Roman',
    fontSize: 12,
    color: C.inkSoft,
    textAlign: 'center',
    marginVertical: 6,
  },
  donorName: {
    fontFamily: 'Times-BoldItalic',
    fontSize: 34,
    color: C.accent,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 6,
  },
  donorUnderline: {
    width: 220,
    height: 1,
    backgroundColor: C.accent,
    marginTop: 4,
    marginBottom: 18,
  },
  bodyLine: {
    fontFamily: 'Times-Roman',
    fontSize: 13,
    color: C.ink,
    textAlign: 'center',
    marginVertical: 4,
    lineHeight: 1.6,
    paddingHorizontal: 24,
  },
  plantName: {
    fontFamily: 'Times-BoldItalic',
    fontSize: 22,
    color: C.ink,
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 4,
  },
  plantCommon: {
    fontSize: 11,
    color: C.inkMute,
    textAlign: 'center',
    fontFamily: 'Times-Italic',
    marginBottom: 18,
  },
  tierPill: {
    fontSize: 11,
    color: C.accent,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 4,
  },
  dedicationBlock: {
    marginTop: 22,
    marginBottom: 22,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderLeftWidth: 2,
    borderLeftColor: C.accent,
    width: 380,
  },
  dedicationLabel: {
    fontSize: 9,
    color: C.inkMute,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  dedicationText: {
    fontFamily: 'Times-Italic',
    fontSize: 13,
    color: C.ink,
    lineHeight: 1.45,
  },
  flourish: {
    fontFamily: 'Times-Italic',
    fontSize: 16,
    color: C.accent,
    letterSpacing: 6,
    marginTop: 8,
    marginBottom: 18,
  },
  signatureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 36,
  },
  sigBlock: {
    width: 200,
    alignItems: 'center',
  },
  sigLine: {
    width: 160,
    height: 0.8,
    backgroundColor: C.rule,
    marginBottom: 4,
  },
  sigName: {
    fontFamily: 'Times-BoldItalic',
    fontSize: 13,
    color: C.ink,
  },
  sigRole: {
    fontSize: 9,
    color: C.inkMute,
    letterSpacing: 1,
  },
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: C.inkMute,
  },
});

const L = {
  en: {
    eyebrow: 'Adopters’ register · est. 1956',
    title: 'Certificate of Adoption',
    subtitle: 'Oulun yliopiston kasvitieteellinen puutarha',
    awardedTo: 'awarded to',
    inRecognition: 'in recognition of their adoption of',
    inTheTier: 'via the',
    tierWord: 'tier',
    dedication: 'Dedication',
    director: 'Garden Director',
    director2: 'Curator of Botany',
    issuedOn: 'Issued',
    cert: 'Certificate',
    nicknameLabel: 'gave the plant the name',
  },
  fi: {
    eyebrow: 'Adoptiorekisteri · perustettu 1956',
    title: 'Adoptiotodistus',
    subtitle: 'Oulun yliopiston kasvitieteellinen puutarha',
    awardedTo: 'on myönnetty',
    inRecognition: 'tunnustuksena kasvin adoptoinnista',
    inTheTier: 'tukitasolla',
    tierWord: '',
    dedication: 'Omistus',
    director: 'Puutarhan johtaja',
    director2: 'Botaniikan intendentti',
    issuedOn: 'Annettu',
    cert: 'Todistus',
    nicknameLabel: 'antoi kasville nimen',
  },
  sv: {
    eyebrow: 'Adoptionsregister · sedan 1956',
    title: 'Adoptionsbevis',
    subtitle: 'Oulun yliopiston kasvitieteellinen puutarha',
    awardedTo: 'tilldelas',
    inRecognition: 'för adoption av',
    inTheTier: 'inom nivån',
    tierWord: '',
    dedication: 'Dedikation',
    director: 'Trädgårdsdirektör',
    director2: 'Botanikkurator',
    issuedOn: 'Utfärdat',
    cert: 'Certifikat',
    nicknameLabel: 'gav växten namnet',
  },
} as const;

export interface AdoptionCertificatePdfInput {
  certificateNumber: string;            // e.g. "ADOPT-2026-000123"
  locale: 'en' | 'fi' | 'sv';
  donorName: string;                    // hero text
  plantLatin: string;                   // italic latin (Abroma augustum)
  plantCommon?: string | null;          // "white rose" — small italic line
  tierName: string;                     // "Seedling" / "Rooted" / etc.
  amount?: string | null;               // e.g. "€25 · annual"
  dedication?: string | null;           // public message, italic block
  nickname?: string | null;             // donor-given plant nickname
  issuedAt: Date;
  directorName?: string;                // Default: "Anna-Liisa Ruotsalainen"
  directorRole?: 'director' | 'curator';
  signatoryName?: string;               // 2nd signature (curator)
  signatoryRole?: 'director' | 'curator';
  verificationUrl?: string;             // shown in footer
}

const Certificate: React.FC<{ input: AdoptionCertificatePdfInput }> = ({ input }) => {
  const l = L[input.locale] ?? L.en;
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      React.createElement(
        View,
        { style: styles.outerFrame },
        React.createElement(
          View,
          { style: styles.innerFrame },
          React.createElement(Text, { style: styles.ornament }, '❦  ❧  ❦'),
          React.createElement(Text, { style: styles.eyebrow }, l.eyebrow),
          React.createElement(Text, { style: styles.title }, l.title),
          React.createElement(Text, { style: styles.subtitle }, l.subtitle),
          // Donor block
          React.createElement(Text, { style: styles.introLine }, l.awardedTo),
          React.createElement(Text, { style: styles.donorName }, input.donorName),
          React.createElement(View, { style: styles.donorUnderline }),
          React.createElement(Text, { style: styles.bodyLine }, l.inRecognition),
          // Plant block (italic latin, italic common)
          React.createElement(Text, { style: styles.plantName }, input.plantLatin),
          input.plantCommon
            ? React.createElement(Text, { style: styles.plantCommon }, `“${input.plantCommon}”`)
            : null,
          // Tier (small caps copper)
          React.createElement(
            Text,
            { style: styles.tierPill },
            l.tierWord
              ? `${l.inTheTier} ${input.tierName} ${l.tierWord}${input.amount ? ` · ${input.amount}` : ''}`
              : `${l.inTheTier} ${input.tierName}${input.amount ? ` · ${input.amount}` : ''}`,
          ),
          input.nickname
            ? React.createElement(
                Text,
                { style: { ...styles.bodyLine, marginTop: 10, fontFamily: 'Times-Italic' } },
                `— ${l.nicknameLabel} “${input.nickname}”`,
              )
            : null,
          // Dedication block (only if set)
          input.dedication
            ? React.createElement(
                View,
                { style: styles.dedicationBlock },
                React.createElement(Text, { style: styles.dedicationLabel }, l.dedication),
                React.createElement(
                  Text,
                  { style: styles.dedicationText },
                  `“${input.dedication}”`,
                ),
              )
            : React.createElement(Text, { style: styles.flourish }, '❧'),
          // Signature row — director on left, curator on right.
          React.createElement(
            View,
            { style: styles.signatureRow },
            React.createElement(
              View,
              { style: styles.sigBlock },
              React.createElement(View, { style: styles.sigLine }),
              React.createElement(
                Text,
                { style: styles.sigName },
                input.directorName ?? 'Anna-Liisa Ruotsalainen',
              ),
              React.createElement(
                Text,
                { style: styles.sigRole },
                input.directorRole === 'curator' ? l.director2 : l.director,
              ),
            ),
            React.createElement(
              View,
              { style: styles.sigBlock },
              React.createElement(View, { style: styles.sigLine }),
              React.createElement(
                Text,
                { style: styles.sigName },
                input.signatoryName ?? 'Marko Hyvärinen',
              ),
              React.createElement(
                Text,
                { style: styles.sigRole },
                input.signatoryRole === 'director' ? l.director : l.director2,
              ),
            ),
          ),
        ),
      ),
      React.createElement(
        View,
        { style: styles.footer },
        React.createElement(Text, null, `${l.cert} № ${input.certificateNumber}`),
        React.createElement(
          Text,
          null,
          `${l.issuedOn} ${input.issuedAt.toLocaleDateString(
            input.locale === 'en' ? 'en-GB' : `${input.locale}-FI`,
            { day: 'numeric', month: 'long', year: 'numeric' },
          )}`,
        ),
        React.createElement(
          Text,
          null,
          input.verificationUrl ?? 'bloom-oulu.vercel.app',
        ),
      ),
    ),
  );
};

export async function renderAdoptionCertificatePdf(
  input: AdoptionCertificatePdfInput,
): Promise<Buffer> {
  const doc = React.createElement(Certificate, { input }) as React.ReactElement<DocumentProps>;
  const stream = await pdf(doc).toBuffer();
  const chunks: Buffer[] = [];
  return await new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
