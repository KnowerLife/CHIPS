import type { ChipPack } from '../net/Protocol';

/**
 * Fallback shop catalog shown when the online service is unreachable (so the
 * Market still shows what's on offer offline). The server's `/api/config` is
 * authoritative — these mirror `server/telegram.mjs#CHIP_PACKAGES`.
 *
 * Prices are in **Telegram Stars** (⭐), the in-Telegram currency.
 */
export const DEFAULT_PACKS: ChipPack[] = [
  { id: 'pack_small', title: 'Горсть фишек', chips: 500, stars: 25, emoji: '🪙' },
  { id: 'pack_medium', title: 'Мешок фишек', chips: 2500, stars: 100, emoji: '💰' },
  { id: 'pack_large', title: 'Сундук фишек', chips: 10000, stars: 350, emoji: '🧰' },
  { id: 'pack_mega', title: 'Казначейство', chips: 50000, stars: 1500, emoji: '🏦' },
  { id: 'donate_small', title: 'Поддержать игру', chips: 200, stars: 15, emoji: '❤️' },
];

/** Free-form donation tiers (Telegram Stars) — the chips are a thank-you bonus. */
export const DONATE_TIERS: ChipPack[] = [
  { id: 'pack_small', title: 'Поддержать игру', chips: 200, stars: 15, emoji: '❤️' },
  { id: 'pack_medium', title: 'Поддержать игру', chips: 1200, stars: 75, emoji: '💖' },
  { id: 'pack_large', title: 'Поддержать игру', chips: 6000, stars: 300, emoji: '💝' },
];
