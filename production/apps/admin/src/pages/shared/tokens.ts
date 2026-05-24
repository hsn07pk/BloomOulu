/**
 * BloomOulu admin design tokens.
 *
 * Single source of truth for colors, spacing, typography, radii, shadows
 * and motion used by every custom admin page. Mirrors the CSS custom
 * properties in src/styles/global.css so React components can use either
 * inline-style objects (this file) or class-based styling (the CSS).
 *
 * Keep the two files in sync — both reference the same palette grounded
 * in the BloomOulu botanical brand (forest / sage / cream / terra).
 */

export const colors = {
  // Greens — primary identity
  forestDeep: '#16301F',
  forest: '#1F3C2D',
  forestMid: '#2D5440',
  moss: '#3D6A52',
  teal: '#5FB0A0',
  olive: '#88A050',
  leaf: '#A8C060',

  // Warm neutrals — paper, cards, surfaces
  paper: '#FFFFFF',
  cream: '#FAF7EE',
  sage: '#E8EEDE',
  sagePale: '#F2F0E8',
  whisper: '#F7F5EC',
  parchment: '#FDFBF3',

  // Borders + dividers
  line: '#E5E2D8',
  lineSoft: '#EFECDF',
  lineStrong: '#C9C6B6',

  // Ink (text)
  ink: '#1F3C2D',
  inkSoft: '#3A4E3F',
  inkMute: '#6B7560',
  inkFaint: '#88897C',
  inkDisabled: '#B7B6A7',

  // Status colours — botanical-flavoured
  successBg: '#E8EEDE',
  successFg: '#2D5440',
  successLine: '#88A050',

  warningBg: '#FCF1D8',
  warningFg: '#7A5A1A',
  warningLine: '#E8C66A',

  dangerBg: '#FCE8DE',
  dangerFg: '#8A3A28',
  dangerLine: '#B8513A',

  infoBg: '#E1F0EE',
  infoFg: '#1F584F',
  infoLine: '#5FB0A0',

  // Highlights
  accent: '#B8513A',     // terra clay — destructive / important accents
  accentSoft: '#FCE8DE',
  highlight: '#FBE9B0',  // soft amber — search-match highlight
} as const;

export const space = {
  px: '1px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  7: '28px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
} as const;

export const radius = {
  xs: '4px',
  sm: '6px',
  md: '10px',
  lg: '14px',
  xl: '20px',
  pill: '999px',
} as const;

export const shadow = {
  none: 'none',
  sm: '0 1px 2px rgba(31, 60, 45, 0.06)',
  md: '0 4px 14px rgba(31, 60, 45, 0.08), 0 1px 2px rgba(31, 60, 45, 0.04)',
  lg: '0 16px 40px rgba(31, 60, 45, 0.12), 0 4px 10px rgba(31, 60, 45, 0.06)',
  ring: '0 0 0 3px rgba(95, 176, 160, 0.28)',
  ringWarn: '0 0 0 3px rgba(232, 198, 106, 0.32)',
  ringDanger: '0 0 0 3px rgba(184, 81, 58, 0.28)',
} as const;

export const motion = {
  fast: '120ms cubic-bezier(0.4, 0, 0.2, 1)',
  base: '180ms cubic-bezier(0.4, 0, 0.2, 1)',
  slow: '280ms cubic-bezier(0.2, 0.8, 0.2, 1)',
} as const;

export const font = {
  display:
    '"Fraunces", "Iowan Old Style", Georgia, ui-serif, serif',
  body:
    '"Hanken Grotesk", "Helvetica Neue", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

export const fontSize = {
  xs: '11px',
  sm: '12px',
  base: '14px',
  md: '15px',
  lg: '17px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '32px',
  '4xl': '40px',
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export const z = {
  base: 1,
  raised: 10,
  sticky: 50,
  dropdown: 100,
  drawer: 200,
  modal: 300,
  toast: 400,
  tooltip: 500,
} as const;

/**
 * Common inline-style fragments composed by primitives.
 */
export const stylePresets = {
  resetButton: {
    background: 'transparent',
    border: 'none',
    padding: 0,
    margin: 0,
    cursor: 'pointer',
    font: 'inherit',
    color: 'inherit',
    lineHeight: 1,
  } as React.CSSProperties,
  focusRing: {
    outline: `2px solid ${colors.teal}`,
    outlineOffset: '2px',
  } as React.CSSProperties,
  truncate: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
} as const;
