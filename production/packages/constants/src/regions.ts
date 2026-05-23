/**
 * I@H (Internationalisation@Home) home regions. Codes map to i18n keys
 * `region${CODE}` in packages/i18n/messages/*.json.
 */
export const HOME_REGIONS = [
  'FI-LL', // Lapland
  'FI-HA', // Häme
  'FI-PP', // Bothnian coast
  'SE',
  'NO',
  'EE',
  'RU',
  'GB-SCT',
  'DE',
  'NORDIC',
  'EUR',
  'OTHER',
] as const;

export type HomeRegion = (typeof HOME_REGIONS)[number];

/** "Skip — any plant" comes first when shown in a form select. */
export const REGION_SKIP = '' as const;
export type RegionSelectValue = HomeRegion | typeof REGION_SKIP;
