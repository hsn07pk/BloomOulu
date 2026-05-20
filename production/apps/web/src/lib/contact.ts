/**
 * Single source of truth for donor-facing contact details.
 *
 * Resolution order:
 *   1. `NEXT_PUBLIC_CURATOR_EMAIL` / `NEXT_PUBLIC_SUPPORT_EMAIL` env
 *      (set in docker-compose / .env / your hosting platform).
 *   2. Fallback to the documented Garden defaults.
 *
 * The API also persists these in SystemSetting (`admin.curator.email` /
 * `admin.support.email`) so an admin can override them at runtime without
 * a deploy. Pages that need the runtime value should call
 * `fetchPublicSettings()` (see lib/api.ts) and prefer that; the helpers
 * here are the safe synchronous fallback shape for build-time text.
 */

const DEFAULT_CURATOR = 'curator@bloomoulu.fi';
const DEFAULT_SUPPORT = 'donate@bloomoulu.fi';
const DEFAULT_NOREPLY = 'no-reply@bloomoulu.fi';
const DEFAULT_GARDEN_NAME_EN = 'BloomOulu — University of Oulu Botanical Garden';
const DEFAULT_GARDEN_NAME_FI = 'Oulun yliopiston kasvitieteellinen puutarha';
const DEFAULT_GARDEN_NAME_SV = 'Uleåborgs universitets botaniska trädgård';

export function curatorEmail(): string {
  return process.env.NEXT_PUBLIC_CURATOR_EMAIL ?? DEFAULT_CURATOR;
}

export function supportEmail(): string {
  return process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? DEFAULT_SUPPORT;
}

export function noReplyEmail(): string {
  return process.env.EMAIL_FROM ?? DEFAULT_NOREPLY;
}

export function gardenName(locale: 'en' | 'fi' | 'sv'): string {
  if (locale === 'fi') return process.env.NEXT_PUBLIC_GARDEN_NAME_FI ?? DEFAULT_GARDEN_NAME_FI;
  if (locale === 'sv') return process.env.NEXT_PUBLIC_GARDEN_NAME_SV ?? DEFAULT_GARDEN_NAME_SV;
  return process.env.NEXT_PUBLIC_GARDEN_NAME_EN ?? DEFAULT_GARDEN_NAME_EN;
}
