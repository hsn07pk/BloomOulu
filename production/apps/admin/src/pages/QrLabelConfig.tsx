/**
 * QR label print knobs — what the curator-facing
 * /[locale]/plants/[slug]/print page renders. Every option here flows
 * into SystemSetting `qrLabel.*` and the print page picks it up at
 * render time, no redeploy needed.
 */
import React from 'react';
import ConfigForm, { type ConfigSchema } from './ConfigForm';

const Preview: React.FC<{ values: Record<string, unknown> }> = ({ values }) => {
  const w = (values['qrLabel.labelWidthMm'] as number) ?? 80;
  const h = (values['qrLabel.labelHeightMm'] as number) ?? 50;
  const qr = (values['qrLabel.sizeMm'] as number) ?? 35;
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 13, color: '#1F3C2D', lineHeight: 1.6 }}>
      Each label prints at{' '}
      <strong>
        {w}×{h}mm
      </strong>{' '}
      with a <strong>{qr}mm</strong> QR code. Curators visit{' '}
      <code>/&lt;locale&gt;/plants/&lt;slug&gt;/print</code> and hit Cmd+P (or just append{' '}
      <code>?autoprint=1</code>).
    </div>
  );
};

export const schema: ConfigSchema = {
  title: 'QR labels',
  kicker: 'Print configuration',
  intro:
    'Controls every printed plant tag — size, which fields appear next to the QR, and whether the encoded URL carries a kiosk-tracking tag. Changes apply to the very next print.',
  helpBannerId: 'qr-label-config-intro',
  helpBannerTitle: 'Test on real label paper',
  helpBanner: (
    <>
      Browsers vary in how they honour <code>@page</code> sizing. Always do a one-label test print
      on the exact sticker stock you’ll use, then measure with a ruler. If the QR is even a
      millimetre clipped, scanners may fail outdoors — error-correction level&nbsp;H needs a
      minimum 25&nbsp;mm side at typical reader distances.
    </>
  ),
  Preview,
  sections: [
    {
      title: 'Print dimensions',
      description: 'Standard label-sheet sizes are 80×50mm (laser) or 50×30mm (thermal).',
      fields: [
        {
          key: 'qrLabel.labelWidthMm',
          label: 'Label width (mm)',
          help: 'Sets @page width and the on-screen preview. The print page applies @page so a single label fills one sticker.',
          type: { kind: 'number', min: 10, max: 300, step: 1 },
          default: 80,
        },
        {
          key: 'qrLabel.labelHeightMm',
          label: 'Label height (mm)',
          type: { kind: 'number', min: 10, max: 300, step: 1 },
          default: 50,
        },
        {
          key: 'qrLabel.sizeMm',
          label: 'QR side length (mm)',
          help: 'Must fit inside the label minus padding. We use error-correction level H so 25mm is the practical floor for outdoor signage.',
          type: { kind: 'number', min: 15, max: 200, step: 1 },
          default: 35,
        },
      ],
    },
    {
      title: 'Page format for the PDF download',
      description:
        '"Match label size" makes the single-plant print page one label per page (no waste). Pick A4, Letter, etc. for sheet stock with multiple labels. The bulk-print page always uses the configured sheet size unless overridden.',
      fields: [
        {
          key: 'qrLabel.pageFormat',
          label: 'Default page format',
          help: 'Curators can still override on the print page itself. "Custom" uses the W×H below.',
          type: {
            kind: 'select',
            options: [
              { value: 'label', label: 'Match label size (single label per page)' },
              { value: 'a4', label: 'A4 (210 × 297 mm)' },
              { value: 'a3', label: 'A3 (297 × 420 mm)' },
              { value: 'a5', label: 'A5 (148 × 210 mm)' },
              { value: 'letter', label: 'US Letter (216 × 279 mm)' },
              { value: 'legal', label: 'US Legal (216 × 356 mm)' },
              { value: 'tabloid', label: 'Tabloid (279 × 432 mm)' },
              { value: 'custom', label: 'Custom dimensions (W × H below)' },
            ],
          },
          default: 'label',
        },
        {
          key: 'qrLabel.pageCustomWidthMm',
          label: 'Custom width (mm)',
          help: 'Used only when "Custom" is selected above.',
          type: { kind: 'number', min: 20, max: 2000, step: 1 },
          default: 80,
        },
        {
          key: 'qrLabel.pageCustomHeightMm',
          label: 'Custom height (mm)',
          type: { kind: 'number', min: 20, max: 2000, step: 1 },
          default: 50,
        },
      ],
    },
    {
      title: 'What to print next to the QR',
      description: 'Toggle the info shown alongside the scannable code. The label always includes the QR itself.',
      fields: [
        {
          key: 'qrLabel.showLatin',
          label: 'Latin (scientific) name',
          type: { kind: 'boolean' },
          default: true,
        },
        {
          key: 'qrLabel.showCommonName',
          label: 'Localised common name',
          type: { kind: 'boolean' },
          default: true,
        },
        {
          key: 'qrLabel.showRedList',
          label: 'IUCN Red List status badge',
          type: { kind: 'boolean' },
          default: true,
        },
        {
          key: 'qrLabel.showGardenZone',
          label: 'Garden zone code',
          help: "Helpful when relabelling specific beds. Leave off for public-facing labels — visitors don't need internal zone codes.",
          type: { kind: 'boolean' },
          default: false,
        },
        {
          key: 'qrLabel.showSlug',
          label: 'Plant slug (small footer)',
          help: 'Curators sometimes want the slug visible for QA. Public labels usually hide it.',
          type: { kind: 'boolean' },
          default: false,
        },
      ],
    },
    {
      title: 'Tracking',
      description:
        'Every scan is already recorded as a PlantScan row. Adding a kiosk ID to the printed URL lets you split scans by physical label so you can A/B different sticker designs / locations.',
      fields: [
        {
          key: 'qrLabel.embedKioskId',
          label: 'Embed kioskId in QR URL',
          help: 'When on, the URL the QR encodes is /plants/<slug>?qr=1&kiosk=<id>. When off, only ?qr=1 is included.',
          type: { kind: 'boolean' },
          default: true,
        },
        {
          key: 'qrLabel.defaultKioskId',
          label: 'Default kiosk ID',
          help: 'Used when the print URL is opened without ?kiosk=<id>. Example: "greenhouse-north".',
          type: { kind: 'string', placeholder: 'e.g. greenhouse-north' },
          default: '',
        },
      ],
    },
  ],
};

const QrLabelConfig: React.FC = () => <ConfigForm schema={schema} />;
export default QrLabelConfig;
