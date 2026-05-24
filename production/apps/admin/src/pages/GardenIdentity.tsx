/**
 * Garden Identity — the donor-facing identity of the Garden.
 * Edits here flow live to: bank-transfer pay page IBAN/BIC/QR, PDF
 * receipts, tax certificates, donor-wall banner, kiosk footer.
 */
import React from 'react';
import ConfigForm, { type ConfigSchema } from './ConfigForm';

const Preview: React.FC<{ values: Record<string, unknown> }> = ({ values }) => {
  const name = (values['bankTransfer.beneficiaryName'] as string) || 'BloomOulu';
  const iban = (values['bankTransfer.iban'] as string) || '—';
  const bic = (values['bankTransfer.bic'] as string) || '—';
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 14, color: '#1F3C2D', lineHeight: 1.55 }}>
      <div style={{ fontWeight: 600 }}>{name}</div>
      <div style={{ fontFamily: 'ui-monospace, monospace', color: '#6B7560', marginTop: 4 }}>
        IBAN {iban} · BIC {bic}
      </div>
    </div>
  );
};

export const schema: ConfigSchema = {
  title: 'Garden Identity',
  kicker: 'Identity & banking',
  intro:
    'Who the Garden is, in the donor’s eyes. These values appear on the bank-transfer page, the receipt PDF, the tax certificate, and anywhere we sign off as the Garden. Changes are live the moment you save — refresh any open donor page to verify.',
  helpBannerId: 'garden-identity-intro',
  helpBannerTitle: 'Verify with your accountant before saving',
  helpBanner: (
    <>
      A typo in the <strong>IBAN</strong> here will silently drop donations — the bank will receive
      transfers and bounce them back. Same for the VAT&nbsp;ID, which the donor needs to claim the
      gift in their tax return. When in doubt, copy the values from a recent bank statement and
      a receipt PDF rather than from memory.
    </>
  ),
  Preview,
  sections: [
    {
      title: 'Public name',
      description: 'Shown in the donor wall, footer, and on every PDF.',
      fields: [
        {
          key: 'bankTransfer.beneficiaryName',
          label: 'Beneficiary (English)',
          help: 'The legal name of the Garden, exactly as it appears on the bank account. Donors’ banks may reject the transfer if this differs from the bank record.',
          type: { kind: 'string', maxLength: 120 },
          default: 'Oulun yliopiston kasvitieteellinen puutarha',
          example: 'Oulun yliopiston kasvitieteellinen puutarha',
        },
      ],
    },
    {
      title: 'Bank details (SEPA)',
      description:
        'These appear on /donate/pay alongside the EPC069-12 QR code. A wrong IBAN will silently drop donations — verify with your accountant before saving.',
      fields: [
        {
          key: 'bankTransfer.iban',
          label: 'IBAN',
          help: 'Spaces are allowed; we strip them when generating the QR code. Always uppercase letters.',
          hint: 'International Bank Account Number',
          type: { kind: 'string', maxLength: 34 },
          example: 'FI21 1234 5600 0007 85',
        },
        {
          key: 'bankTransfer.bic',
          label: 'BIC / SWIFT',
          help: 'The 8- or 11-character SWIFT code of the receiving bank.',
          hint: 'Business Identifier Code',
          type: { kind: 'string', maxLength: 11 },
          example: 'OKOYFIHH',
        },
      ],
    },
    {
      title: 'Receipts & tax certificates',
      description: 'Footer block of every PDF receipt and the annual tax certificate.',
      fields: [
        {
          key: 'garden.vatId',
          label: 'VAT / Y-tunnus',
          help: 'Finnish business id (Y-tunnus). Required on receipts for the donor to claim the gift in their tax return.',
          type: { kind: 'string', maxLength: 16 },
          example: '0245259-2',
        },
        {
          key: 'garden.address',
          label: 'Garden postal address',
          help: 'One line. Where receipts and physical perks are sent from.',
          type: { kind: 'string', maxLength: 160 },
          example: 'Linnanmaa, 90014 Oulun yliopisto',
        },
      ],
    },
    {
      title: 'Donate page link',
      description: 'Where bank-transfer redirects land — usually your public donate page.',
      fields: [
        {
          key: 'bankTransfer.instructionsUrl',
          label: 'Bank-transfer instructions URL',
          help: 'Full URL including https://. After bank_transfer is picked, the donor is sent here with the order details in the query string.',
          type: { kind: 'url' },
          example: 'https://bloomoulu.fi/en/donate/pay',
        },
      ],
    },
  ],
};

const GardenIdentity: React.FC = () => <ConfigForm schema={schema} />;
export default GardenIdentity;
