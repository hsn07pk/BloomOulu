/**
 * Design tokens — mirrored from the demo prototype so the production build
 * looks identical pixel-for-pixel.
 */
export const tokens = {
  color: {
    bg: '#FBFCF7',
    fg: '#1F3C2D',
    muted: '#5C6E5A',
    accent: '#2D5440',
    accentSoft: '#5FB0A0',
    leaf: '#88A050',
    cream: '#F4F7EF',
    border: '#DDE6CB',
    warn: '#C9A14A',
    err: '#B22',
  },
  font: {
    sans: "'Manrope', system-ui, sans-serif",
    display: "'Fraunces', serif",
    mono: "'JetBrains Mono', monospace",
  },
  radius: { sm: 4, md: 8, lg: 16 },
} as const;
