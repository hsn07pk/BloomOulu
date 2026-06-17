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

// Donate — an open hand cradling a heart (a gift to the Garden).
function HandHeartIcon(props: IconProps): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="M11 14h2a2 2 0 0 0 0-4h-3c-.6 0-1.1.2-1.5.6L3 16" />
      <path d="m7 20 1.6-1.4c.4-.4.9-.6 1.5-.6h4c1.1 0 2.1-.4 2.9-1.2l4.3-4.1a2 2 0 0 0-2.75-2.91l-3.9 3.6" />
      <path d="M2 15v6" />
      <path d="M19.5 5.5a2.1 2.1 0 0 0-3-3l-.5.5-.5-.5a2.1 2.1 0 0 0-3 3L16 9Z" />
    </Glyph>
  );
}

// Favourites — a heart (the votes leaderboard).
function HeartIcon(props: IconProps): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />
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

export type NavKey = 'home' | 'plants' | 'donate' | 'favourites' | 'ask' | 'garden';

export interface NavItem {
  key: NavKey;
  /** Path segment after the locale prefix (''=home). */
  seg: string;
  Icon: (props: IconProps) => JSX.Element;
  /** Shown in the desktop topbar? (Plants is mobile-only.) */
  inTopbar: boolean;
  /** Shown in the mobile bottom tab bar? Defaults to true; Favourites is
   *  desktop-only so the phone bar stays at five comfortable targets. */
  inMobile?: boolean;
  /** Shorter label key (Nav namespace) for the cramped mobile tab bar; the
   *  full `key` label stays the accessible name via aria-label. */
  shortKey?: 'askShort';
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', seg: '', Icon: LeafIcon, inTopbar: true },
  { key: 'plants', seg: '/plants', Icon: FlowerIcon, inTopbar: false },
  { key: 'donate', seg: '/donate', Icon: HandHeartIcon, inTopbar: true },
  { key: 'favourites', seg: '/favourites', Icon: HeartIcon, inTopbar: true, inMobile: false },
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
