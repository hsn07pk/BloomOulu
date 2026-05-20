/**
 * Payment Providers — enable/disable + paste credentials. Credentials
 * still live in `.env` for security (so a database breach can't leak
 * the merchant secret), but the on/off toggles and the public-safe
 * settings live here and apply immediately.
 */
import React from 'react';
import ConfigForm, { type ConfigSchema } from './ConfigForm';

const Preview: React.FC<{ values: Record<string, unknown> }> = ({ values }) => {
  const card = (values['payments.paytrail'] as boolean) === true;
  const bank = (values['payments.bank_transfer'] as boolean) === true;
  const mob = (values['payments.mobilepay'] as boolean) === true;
  const Chip: React.FC<{ on: boolean; label: string }> = ({ on, label }) => (
    <span
      style={{
        padding: '4px 12px',
        borderRadius: 999,
        background: on ? '#E8EEDE' : '#F5F2E8',
        color: on ? '#2D5440' : '#88897C',
        border: `1px solid ${on ? '#2D5440' : '#E5E2D8'}`,
        fontSize: 12,
      }}
    >
      {label}: {on ? 'live' : 'off'}
    </span>
  );
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Chip on={card} label="Card / online bank (Paytrail)" />
      <Chip on={mob} label="MobilePay" />
      <Chip on={bank} label="SEPA bank transfer" />
    </div>
  );
};

const schema: ConfigSchema = {
  title: 'Payment Providers',
  intro:
    'Turn each payment method on or off, and paste the merchant credentials you got from the provider portal. Changes apply within a minute (or sooner — admin saves invalidate the cache immediately).',
  Preview,
  sections: [
    {
      title: 'Provider toggles',
      description:
        'Which methods appear in the donor’s cart-checkout picker. At least one should stay enabled or donors will see "no payment methods available".',
      fields: [
        {
          key: 'payments.paytrail',
          label: 'Card & online bank (Paytrail)',
          help: 'Donors complete payment on Paytrail’s hosted checkout with Visa, Mastercard, Nordea, OP, Aktia, Danske, Säästöpankki, Ålandsbanken.',
          type: { kind: 'boolean' },
          default: true,
        },
        {
          key: 'payments.mobilepay',
          label: 'MobilePay / Vipps',
          help: 'For FI and NO donors. Requires registering at developer.vippsmobilepay.com and pasting the credentials below.',
          type: { kind: 'boolean' },
          default: false,
        },
        {
          key: 'payments.bank_transfer',
          label: 'SEPA bank transfer',
          help: 'Zero-fee. Donors get an IBAN + RF reference + QR code; the Garden’s accountant reconciles the next day from the bank statement.',
          type: { kind: 'boolean' },
          default: true,
        },
      ],
    },
    {
      title: 'Paytrail credentials',
      description:
        'Found in your Paytrail merchant portal under Developers → API. NEVER paste production credentials into a development environment.',
      fields: [
        {
          key: 'paytrail.merchantIdHint',
          label: 'Merchant ID',
          help: 'Public test merchant is 375917. Replace with your real merchant id once Paytrail approves your account.',
          type: { kind: 'string', maxLength: 16 },
          default: '375917',
          example: '375917 (Paytrail public test)',
        },
        {
          key: 'paytrail.modeHint',
          label: 'Sandbox or live?',
          help: 'Reflects PAYTRAIL_MOCK env. Set in your .env file: PAYTRAIL_MOCK=false for production.',
          type: {
            kind: 'select',
            options: [
              { value: 'mock', label: 'Localhost mock (PAYTRAIL_MOCK=true)' },
              { value: 'sandbox', label: 'Paytrail test merchant' },
              { value: 'live', label: 'Live merchant' },
            ],
          },
          default: 'sandbox',
        },
      ],
    },
    {
      title: 'MobilePay credentials',
      description:
        'Pasted into the SystemSetting table; the api reads them at next refresh. Production secrets should also live in your .env so a DB breach doesn’t leak them.',
      fields: [
        {
          key: 'mobilepay.merchantSerialHint',
          label: 'Merchant Serial Number (MSN)',
          help: 'Issued by Vipps MobilePay when you register a sales unit.',
          type: { kind: 'string', maxLength: 16 },
        },
        {
          key: 'mobilepay.modeHint',
          label: 'API target',
          type: {
            kind: 'select',
            options: [
              { value: 'test', label: 'Test (apitest.vipps.no)' },
              { value: 'live', label: 'Production (api.vipps.no)' },
            ],
          },
          default: 'test',
        },
      ],
    },
  ],
};

const PaymentProviders: React.FC = () => <ConfigForm schema={schema} />;
export default PaymentProviders;
