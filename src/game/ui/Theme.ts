import type { Rarity } from '../Types';

/**
 * Central palette + typography for all scenes — the single source of truth for
 * the game's "neon arcade" look (Chips / Сотки).
 *
 * Design language (refreshed, full UI pass):
 *  - Deep indigo/violet "table" backgrounds with soft neon rim lighting.
 *  - Gold as premium/primary action; cyan/emerald/magenta as energy accents.
 *  - Modern surfaces: glassy panels, clean rounded controls, restrained glow.
 *  - Michroma as display voice (self-hosted), readable body stack fallback.
 *
 * Numeric entries (0x…) feed Phaser Graphics; string entries ('#…') feed text.
 */
export const COLORS = {
  /* ── surfaces ───────────────────────────────────────────── */
  bg: 0x050316,
  bg0: 0x050316,
  bg1: 0x0b0624,
  bg2: 0x140b33,
  bg3: 0x1f1247,
  panel: 0x151038,
  panelAlt: 0x1d1750,
  panelHi: 0x2a1f66,
  panelGlass: 0x18124a,

  /* ── lines / strokes ────────────────────────────────────── */
  stroke: 0x3f3278,
  strokeHi: 0x6b5bc0,
  strokeGold: 0xf5d97a,

  /* ── accents ────────────────────────────────────────────── */
  accent: 0xf5d97a,
  accent2: 0x3ee6a4,
  accent3: 0x53d7ff,
  accent4: 0xff6fd6,

  goldNum: 0xf5d97a,
  goldDeep: 0xd4a72c,
  goldDark: 0x7a5610,
  emerald: 0x3ee6a4,
  emeraldDeep: 0x14b87a,
  emeraldDark: 0x0a5c38,
  cyan: 0x53d7ff,
  cyanDeep: 0x1b8fd8,
  magenta: 0xff6fd6,
  magentaDeep: 0xc02a94,
  violet: 0xb47cff,
  violetDeep: 0x6d35d6,
  orange: 0xffb04d,
  red: 0xff5c6c,
  redDeep: 0xa32236,
  redDark: 0x5e0f1c,

  /* ── semantic ───────────────────────────────────────────── */
  danger: 0xff5c6c,
  warning: 0xffb04d,
  success: 0x3ee6a4,

  /* ── text (CSS colours) ─────────────────────────────────── */
  text: '#f5f3ff',
  textBright: '#ffffff',
  dim: '#b3a8de',
  gold: '#f5d97a',
  goldText: '#f5d97a',
} as const;

/** String (text-style) colours. */
export const TEXT_COLORS = {
  green: '#4dff9d',
  red: '#ff7a7a',
  gold: '#f7d774',
  blue: '#7fc4ff',
  violet: '#c39bff',
  cyan: '#4fd6ff',
  magenta: '#ff8fdb',
};

/**
 * Display face first (Michroma — self-hosted woff2 in `/public/fonts`,
 * loaded via BootScene before any text renders), then the body stack.
 * Design rule (design-review / frontend-design): no default font stacks as
 * the display voice — a distinctive face leads, body stays readable.
 */
export const FONT_FAMILY =
  '"Michroma", "Trebuchet MS", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

/* ───────────────────────── colour helpers ───────────────────────── */

/** 0xRRGGBB → '#rrggbb'. */
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Linear blend between two packed colours. `t`=0 → a, `t`=1 → b. */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Lighten toward white. */
export function lighten(color: number, t: number): number {
  return mix(color, 0xffffff, t);
}

/** Darken toward black. */
export function darken(color: number, t: number): number {
  return mix(color, 0x000000, t);
}

/**
 * Green → yellow → red "heat" ramp for power/streak meters. `t` is clamped to
 * `0…1`; the palette keys off the neon accents so it stays on-brand.
 */
export function heatColor(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  if (x < 0.45) return COLORS.cyan;
  if (x < 0.72) return COLORS.emerald;
  if (x < 0.88) return COLORS.orange;
  return COLORS.magenta;
}

/** Vivid rarity colour (numeric, for fills). */
export function rarityColor(rarity: Rarity): number {
  switch (rarity) {
    case 'common':
      return 0x9aa4c8;
    case 'rare':
      return 0x4fa3ff;
    case 'epic':
      return 0xb06bff;
    case 'legendary':
      return 0xffc94d;
  }
}

/** Bright aura colour used for rare+ glows. */
export function rarityGlow(rarity: Rarity): number {
  switch (rarity) {
    case 'common':
      return 0x6f7bb0;
    case 'rare':
      return 0x4fa3ff;
    case 'epic':
      return 0xb06bff;
    case 'legendary':
      return 0xffd76a;
  }
}

/** Localized rarity label. */
export function rarityLabel(rarity: Rarity): string {
  switch (rarity) {
    case 'common':
      return 'обычная';
    case 'rare':
      return 'редкая';
    case 'epic':
      return 'эпик';
    case 'legendary':
      return 'легенда';
  }
}

/** Short rarity label for tight chips/badges. */
export function rarityShort(rarity: Rarity): string {
  switch (rarity) {
    case 'common':
      return 'об';
    case 'rare':
      return 'ред';
    case 'epic':
      return 'эпик';
    case 'legendary':
      return 'легенд';
  }
}
