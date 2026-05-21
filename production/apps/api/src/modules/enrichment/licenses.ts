/**
 * Open-licence gating for enrichment content. BloomOulu is a public,
 * donation-funded site, so only commercially-reusable licences are
 * accepted — non-commercial (-NC) and no-derivatives (-ND) content is
 * rejected.
 */

/** True only for licences we may reuse on a public, donation-funded site. */
export function licenseOk(license: string | null | undefined): boolean {
  const l = (license ?? '').toLowerCase();
  if (!l) return false;
  if (l.includes('-nc') || l.includes('-nd') || l.includes('noncommercial') || l.includes('noderiv')) {
    return false;
  }
  return (
    l.includes('cc0') ||
    l.includes('zero') ||
    l.includes('publicdomain') ||
    l.includes('public domain') ||
    l.includes('cc-by') ||
    l.includes('/by/') ||
    l.includes('by-sa') ||
    l.includes('attribution')
  );
}

/** Normalise a licence code/name to a short SPDX-ish identifier. */
export function normalizeLicense(raw: string): string {
  const l = raw.toLowerCase().trim();
  if (!l) return 'unknown';
  if (l.includes('cc0') || l.includes('zero')) return 'CC0-1.0';
  if (l.includes('public') && l.includes('domain')) return 'Public-Domain';
  const m = l.match(/by(-sa)?(-\d(\.\d)?)?/);
  if (m) return `CC-BY${m[1] ? '-SA' : ''}${m[2] ?? '-4.0'}`;
  return raw.toUpperCase();
}
