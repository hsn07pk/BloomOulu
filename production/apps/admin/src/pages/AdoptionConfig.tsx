/**
 * Adoption Knobs — gift-wrap price, max co-adopters, plaque-eligible
 * tiers, which billing intervals donors see, dedication length limit.
 */
import React from 'react';
import ConfigForm, { type ConfigSchema } from './ConfigForm';

const Preview: React.FC<{ values: Record<string, unknown> }> = ({ values }) => {
  const intervals = Array.isArray(values['adoption.intervalsEnabled'])
    ? (values['adoption.intervalsEnabled'] as string[])
    : typeof values['adoption.intervalsEnabled'] === 'string'
      ? (values['adoption.intervalsEnabled'] as string).split(',').map((s) => s.trim())
      : ['monthly', 'one_time'];
  const giftWrap = (values['adoption.giftWrapCents'] as number) ?? 400;
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 13, color: '#1F3C2D', lineHeight: 1.6 }}>
      Donors see {intervals.length} billing interval{intervals.length === 1 ? '' : 's'}:{' '}
      <strong>{intervals.join(' / ')}</strong>. Gift-wrap upgrade adds{' '}
      <strong>€{(giftWrap / 100).toFixed(2)}</strong>.
    </div>
  );
};

const schema: ConfigSchema = {
  title: 'Adoption Knobs',
  intro:
    'Tune what donors see in the adopt flow. All changes are live immediately for new sessions — open a fresh /cart/checkout tab to verify.',
  Preview,
  sections: [
    {
      title: 'Billing intervals donors see',
      description:
        'The production default is monthly + one-time. Enable annual when you’re ready to offer it as a marketing tier.',
      fields: [
        {
          key: 'adoption.intervalsEnabled',
          label: 'Enabled intervals',
          help: 'The wizard, plant detail page, and cart-checkout all read this list. Disabled intervals never appear in the picker, and the API refuses adoptions that try to use them.',
          type: {
            kind: 'multiselect',
            options: [
              { value: 'monthly', label: 'Monthly', description: 'Auto-renews every month' },
              { value: 'annual', label: 'Annual', description: 'Auto-renews yearly' },
              { value: 'one_time', label: 'One-time', description: 'Single charge, no renewal' },
            ],
            stored: 'array',
          },
          default: ['monthly', 'one_time'],
        },
      ],
    },
    {
      title: 'Add-ons',
      fields: [
        {
          key: 'adoption.giftWrapCents',
          label: 'Gift-wrap upgrade',
          help: 'Linen-card certificate mailed to the recipient. Shown on Step 3 of the gift flow.',
          type: { kind: 'cents', suffix: 'per gift' },
          default: 400,
        },
        {
          key: 'adoption.dedicationMaxChars',
          label: 'Dedication max length',
          help: 'Maximum characters in the donor-facing dedication line ("From me, summer 2026").',
          type: { kind: 'number', min: 40, max: 1000, suffix: 'chars' },
          default: 240,
        },
        {
          key: 'adoption.coAdopterMax',
          label: 'Max co-adopters per adoption',
          help: 'Used by the "Split the gift" feature so several friends share one adoption record.',
          type: { kind: 'number', min: 1, max: 50, suffix: 'people' },
          default: 10,
        },
      ],
    },
    {
      title: 'Donor recognition',
      description: 'Which tiers earn an individually engraved plaque next to the plant.',
      fields: [
        {
          key: 'adoption.plaqueEligibleTiers',
          label: 'Plaque-eligible tiers',
          help: 'A tiny brass plaque is requested when an adoption in these tiers is paid. Workflow: plaque.status = requested → engraved → installed.',
          type: {
            kind: 'multiselect',
            options: [
              { value: 'seedling', label: 'Seedling' },
              { value: 'rooted', label: 'Rooted' },
              { value: 'vulnerable', label: 'Vulnerable' },
              { value: 'endangered', label: 'Endangered' },
              { value: 'corporate', label: 'Corporate' },
            ],
            stored: 'array',
          },
          default: ['endangered', 'corporate'],
        },
      ],
    },
    {
      title: 'Funds-flow disclosure',
      description: 'Donor-facing copy on the cart page about where the money goes.',
      fields: [
        {
          key: 'adoption.donationShareBp',
          label: 'Donation share',
          help: 'Of every €100, this percentage is treated as a pure donation in the tax-disclosure box. 7200 = 72%. The other 28% is perk value subject to VAT.',
          type: { kind: 'number', min: 0, max: 10000, suffix: 'bp (0–10000)' },
          default: 7200,
        },
        {
          key: 'adoption.fundsFlowUrl',
          label: 'Funds-flow detail page',
          help: 'Link shown beside the disclosure box. Usually points to /about#funds-flow.',
          type: { kind: 'string', maxLength: 240 },
          default: '/about#funds-flow',
        },
      ],
    },
  ],
};

const AdoptionConfig: React.FC = () => <ConfigForm schema={schema} />;
export default AdoptionConfig;
