/**
 * Admin · Enrichment knobs.
 * Controls the 24/7 worker + per-field auto-apply vs human-review policy.
 */
import React from 'react';
import ConfigForm, { type ConfigSchema } from './ConfigForm';

const Preview: React.FC<{ values: Record<string, unknown> }> = ({ values }) => {
  const enabled = (values['enrichment.enabled'] as boolean) ?? true;
  const auto = {
    story: (values['enrichment.autoApply.story'] as boolean) ?? false,
    origin: (values['enrichment.autoApply.origin'] as boolean) ?? true,
    status: (values['enrichment.autoApply.status'] as boolean) ?? true,
    image: (values['enrichment.autoApply.image'] as boolean) ?? false,
  };
  const refresh = (values['enrichment.refreshDays'] as number) ?? 30;
  const reviewed = Object.entries(auto).filter(([, v]) => !v).map(([k]) => k);
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 13, color: '#1F3A2C', lineHeight: 1.6 }}>
      24/7 worker is <strong>{enabled ? 'on' : 'off'}</strong>. Plants refresh every
      <strong> {refresh} days</strong>. Fields requiring curator review:{' '}
      <strong>{reviewed.length === 0 ? 'none (everything auto-applies)' : reviewed.join(', ')}</strong>.
    </div>
  );
};

export const schema: ConfigSchema = {
  title: 'Plant Enrichment',
  kicker: 'Open-data backfill',
  intro:
    "Open-data enrichment fetches story / origin / conservation status / photo from Wikipedia, GBIF, laji.fi, Wikimedia Commons. The worker runs continuously; per-field, decide whether new values land on the Plant row directly or wait for human review.",
  helpBannerId: 'enrichment-config-intro',
  helpBannerTitle: 'Auto-apply vs. human review',
  helpBanner: (
    <>
      Short factual fields (<strong>origin</strong>, <strong>Red List status</strong>) come from
      authoritative databases — safe to auto-apply. Free-form fields (<strong>story</strong>,
      <strong> photo</strong>) get more variable and benefit from a curator’s eye. Toggle
      auto-apply per field; everything still records a suggestion in <em>Enrichment review</em>
      for audit, even when auto-applied.
    </>
  ),
  Preview,
  sections: [
    {
      title: 'Worker',
      description:
        'Master switch. When off, the cron stops seeding new jobs; in-flight jobs still finish.',
      fields: [
        {
          key: 'enrichment.enabled',
          label: '24/7 enrichment worker enabled',
          type: { kind: 'boolean' },
          default: true,
        },
        {
          key: 'enrichment.refreshDays',
          label: 'Refresh cadence (days per plant)',
          help: 'Plants whose latest enrichment was longer than this ago re-enter the queue.',
          type: { kind: 'number', min: 1, max: 365, step: 1 },
          default: 30,
        },
        {
          key: 'enrichment.batchSize',
          label: 'Plants per sweep tick',
          help:
            'Each cron tick (default every 15 min) enqueues this many plants. With 20 per tick and a 15-min cadence, the worker processes ~1,900 plants/day — comfortably below GBIF / Wikipedia rate limits.',
          type: { kind: 'number', min: 1, max: 200, step: 1 },
          default: 20,
        },
      ],
    },
    {
      title: 'Auto-apply policy',
      description:
        "Toggle ON to write fetched values straight to the Plant row. Toggle OFF to queue them for review in Enrichment review. A suggestion is always recorded for audit, even when auto-applied.",
      fields: [
        {
          key: 'enrichment.autoApply.story',
          label: 'Story (Wikipedia / GBIF / EOL summary)',
          help: 'Off by default — story text changes the public page significantly, curator review preferred.',
          type: { kind: 'boolean' },
          default: false,
        },
        {
          key: 'enrichment.autoApply.origin',
          label: 'Native origin (GBIF / WCVP)',
          help: 'On by default — short factual strings, low risk.',
          type: { kind: 'boolean' },
          default: true,
        },
        {
          key: 'enrichment.autoApply.status',
          label: 'IUCN Red List status (laji.fi)',
          help: 'On by default — enum value, authoritative source.',
          type: { kind: 'boolean' },
          default: true,
        },
        {
          key: 'enrichment.autoApply.image',
          label: 'Primary photo (Wikimedia Commons / iNaturalist)',
          help:
            'Off by default — image hosting is the expensive step; require approval before downloading.',
          type: { kind: 'boolean' },
          default: false,
        },
      ],
    },
  ],
};

const EnrichmentConfig: React.FC = () => <ConfigForm schema={schema} />;
export default EnrichmentConfig;
