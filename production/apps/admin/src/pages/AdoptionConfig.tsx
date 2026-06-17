/**
 * Donation knobs — the quick-pick amounts donors see, the pre-selected
 * default, whether a custom amount is allowed, the min/max accepted, the
 * dedication-line length limit, and the "where your money goes" link.
 *
 * Edits the donation.* SystemSetting keys consumed by the public donate
 * flow. Replaces the old tier / gift-wrap / plaque / billing-interval
 * adoption knobs, which no longer exist after the donation rewrite.
 *
 * NOTE: the file name and exported names are kept as-is on purpose —
 * server.ts registers this component by path/name.
 */
import React from 'react';
import ConfigForm, { type ConfigSchema } from './ConfigForm';

const euro = (cents: number): string => `€${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

const Preview: React.FC<{ values: Record<string, unknown> }> = ({ values }) => {
  const amounts = Array.isArray(values['donation.suggestedAmountsCents'])
    ? (values['donation.suggestedAmountsCents'] as unknown[])
        .map((c) => (typeof c === 'number' ? c : Number(c)))
        .filter((n) => Number.isFinite(n))
    : [];
  const def = (values['donation.defaultAmountCents'] as number) ?? 0;
  const allowCustom =
    values['donation.allowCustomAmount'] === true || values['donation.allowCustomAmount'] === 'true';
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 13, color: '#1F3C2D', lineHeight: 1.6 }}>
      Donors see {amounts.length} quick-pick amount{amounts.length === 1 ? '' : 's'}:{' '}
      <strong>{amounts.length ? amounts.map(euro).join(' / ') : '—'}</strong>
      {def ? (
        <>
          {' '}
          · default <strong>{euro(def)}</strong>
        </>
      ) : null}
      . {allowCustom ? 'A custom-amount field is shown too.' : 'Custom amounts are turned off.'}
    </div>
  );
};

export const schema: ConfigSchema = {
  title: 'Donation amounts',
  kicker: 'Donor donate flow',
  intro:
    'Tune what donors see in the donate flow. All changes are live immediately for new sessions — open a fresh /donate tab to verify.',
  helpBannerId: 'donation-config-intro',
  helpBannerTitle: 'These knobs drive the public donate page',
  helpBanner: (
    <>
      The quick-pick buttons, the pre-selected default, and the min/max guard-rails all read from
      the values below. Amounts are stored in cents but shown here in euros. Leave “allow custom
      amount” on so donors can give any sum between the minimum and maximum.
    </>
  ),
  Preview,
  sections: [
    {
      title: 'Suggested amounts',
      description: 'The quick-pick buttons on the donate page, and which one is pre-selected.',
      fields: [
        {
          key: 'donation.suggestedAmountsCents',
          label: 'Quick-pick amounts',
          help: 'Comma-separated euros — e.g. "5, 15, 25, 50". Shown as one-tap buttons on the donate page, in this order. Stored as a list of cents.',
          type: { kind: 'centsList' },
          default: [500, 1500, 2500, 5000],
          example: '5, 15, 25, 50',
        },
        {
          key: 'donation.defaultAmountCents',
          label: 'Default amount',
          help: 'The quick-pick that is pre-selected when the donate page opens. Set it to one of the amounts above.',
          type: { kind: 'cents', suffix: 'pre-selected' },
          default: 1500,
        },
      ],
    },
    {
      title: 'Custom amount',
      description: 'Whether donors can type their own amount, and the limits we accept.',
      fields: [
        {
          key: 'donation.allowCustomAmount',
          label: 'Allow a custom amount',
          help: 'When on, the donate page shows a free-entry field so donors can give any sum between the min and max below.',
          type: { kind: 'boolean', trueLabel: 'Custom amount allowed', falseLabel: 'Quick-picks only' },
          default: true,
        },
        {
          key: 'donation.minCents',
          label: 'Minimum donation',
          help: 'Smallest accepted donation. The donate page and the API both reject anything below this.',
          type: { kind: 'cents', suffix: 'minimum' },
          default: 200,
        },
        {
          key: 'donation.maxCents',
          label: 'Maximum donation',
          help: 'Largest accepted donation in a single gift. Guards against fat-finger entries — raise it for corporate gifts.',
          type: { kind: 'cents', suffix: 'maximum' },
          default: 500000,
        },
      ],
    },
    {
      title: 'Dedication & transparency',
      fields: [
        {
          key: 'donation.dedicationMaxChars',
          label: 'Dedication max length',
          help: 'Maximum characters in the donor-facing dedication line ("In memory of …") shown on the donor wall.',
          type: { kind: 'number', min: 40, max: 1000, suffix: 'chars' },
          default: 240,
        },
        {
          key: 'donation.fundsFlowUrl',
          label: '“Where your money goes” link',
          help: 'Full URL (including https://) to the page explaining how donations are used. Linked from the donate page for transparency.',
          type: { kind: 'url' },
          example: 'https://bloomoulu.fi/en/about/funds',
        },
      ],
    },
  ],
};

const AdoptionConfig: React.FC = () => <ConfigForm schema={schema} />;
export default AdoptionConfig;
