import type { SVGProps } from 'react';

/**
 * Shared primary-nav definition — icons + items + active matcher — consumed by
 * BOTH the desktop Topbar nav (PrimaryNav.client) and the mobile bottom tab bar
 * (MobileTabBar), so a given destination shows the SAME minimal line icon in
 * each and active-state matching can't drift between them.
 *
 * Icons are outline SVGs that inherit `currentColor`, so the active styles
 * (cream on the forest pill in the topbar; forest text on mobile) recolour them
 * for free. Pixel sizing lives in globals.css (`.nav a svg`, `.mobile-tab-ico`).
 */

type IconProps = SVGProps<SVGSVGElement>;

function Glyph(props: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

// Home — a leaf (mirrors the demo's first/"Discover" tab).
function LeafIcon(props: IconProps): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.52-4.48 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </Glyph>
  );
}

// Plants — a simple bloom (mobile-only tab; kept distinct from the Home leaf).
function FlowerIcon(props: IconProps): JSX.Element {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="2.4" />
      <circle cx="12" cy="7" r="2.7" />
      <circle cx="12" cy="17" r="2.7" />
      <circle cx="7" cy="12" r="2.7" />
      <circle cx="17" cy="12" r="2.7" />
    </Glyph>
  );
}

// Adopt — a sprout/seedling (matches the demo).
function SproutIcon(props: IconProps): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="M7 20h10" />
      <path d="M10 20c5.5-2.5.8-6.4 3-10" />
      <path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8Z" />
      <path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2Z" />
    </Glyph>
  );
}

// Ask the Garden — a friendly bot (matches the demo's robot).
function BotIcon(props: IconProps): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </Glyph>
  );
}

// My Garden — a person (matches the demo).
function UserIcon(props: IconProps): JSX.Element {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
    </Glyph>
  );
}

export type NavKey = 'home' | 'plants' | 'adopt' | 'ask' | 'garden';

export interface NavItem {
  key: NavKey;
  /** Path segment after the locale prefix (''=home). */
  seg: string;
  Icon: (props: IconProps) => JSX.Element;
  /** Shown in the desktop topbar? (Plants is mobile-only.) */
  inTopbar: boolean;
  /** Shorter label key (Nav namespace) for the cramped mobile tab bar; the
   *  full `key` label stays the accessible name via aria-label. */
  shortKey?: 'askShort';
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', seg: '', Icon: LeafIcon, inTopbar: true },
  { key: 'plants', seg: '/plants', Icon: FlowerIcon, inTopbar: false },
  { key: 'adopt', seg: '/adopt', Icon: SproutIcon, inTopbar: true },
  { key: 'ask', seg: '/ask', Icon: BotIcon, inTopbar: true, shortKey: 'askShort' },
  { key: 'garden', seg: '/garden', Icon: UserIcon, inTopbar: true },
];

/**
 * Active-tab matcher, locale-agnostic. `pathname` is the raw next/navigation
 * value; we strip the /en|/fi|/sv prefix before comparing to `seg`. (Lifted
 * verbatim from the original MobileTabBar so both bars agree on what's active.)
 */
export function isActiveSeg(pathname: string, seg: string): boolean {
  const rest = pathname.replace(/^\/(en|fi|sv)(?=\/|$)/, '') || '/';
  if (seg === '') return rest === '/';
  if (rest === seg || rest.startsWith(seg + '/')) return true;
  // My Garden also owns the /me/* account routes.
  if (seg === '/garden' && (rest === '/me' || rest.startsWith('/me/'))) return true;
  return false;
}
