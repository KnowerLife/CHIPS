import type { BitaDef } from '../Types';
import { FORGE } from '../Constants';

/**
 * "Биты" (slammers) — heavy tools purchased with ordinary chips.
 *
 * A bita raises `power` (faster clearing of the stack) and `rareChance` (odds
 * of the bonus rare-chip find after a smash). Values are intentionally modest so
 * the base game stays about luck + stack reading, not pay-to-win.
 *
 * Catalog seeded from the original Telegram-bot prototype's `UNIQUE_CHIPS`,
 * rebalanced here.
 */
export const BITAS: BitaDef[] = [
  {
    id: 'bit_plastic',
    name: 'Пластиковая бита',
    face: '⚫',
    rarity: 'common',
    price: 150,
    power: 0.6,
    rareChance: 0.03,
    color: 0x2b2b33,
  },
  {
    id: 'bit_star',
    name: 'Золотая звезда',
    face: '🌟',
    rarity: 'rare',
    price: 400,
    power: 1.2,
    rareChance: 0.05,
    color: 0xd4af37,
  },
  {
    id: 'bit_rocket',
    name: 'Космический корабль',
    face: '🚀',
    rarity: 'rare',
    price: 450,
    power: 1.4,
    rareChance: 0.045,
    color: 0x3b7de2,
  },
  {
    id: 'bit_diamond',
    name: 'Алмаз',
    face: '💎',
    rarity: 'epic',
    price: 650,
    power: 1.7,
    rareChance: 0.06,
    color: 0x59d0d6,
  },
  {
    id: 'bit_crown',
    name: 'Корона',
    face: '👑',
    rarity: 'epic',
    price: 800,
    power: 2.0,
    rareChance: 0.07,
    color: 0xf5d76e,
  },
  {
    id: 'bit_fire',
    name: 'Огненный шар',
    face: '🔥',
    rarity: 'rare',
    price: 500,
    power: 1.5,
    rareChance: 0.05,
    color: 0xe9743b,
  },
];

export const BITA_BY_ID: Record<string, BitaDef> = Object.fromEntries(
  BITAS.map((b) => [b.id, b]),
);

export function getBita(id: string): BitaDef {
  const bita = BITA_BY_ID[id];
  if (!bita) throw new Error(`Unknown bita id: ${id}`);
  return bita;
}

/** Clamp an arbitrary level into the legal forge range (1…MAX_LEVEL). */
export function clampBitaLevel(level: number | undefined): number {
  if (!Number.isFinite(level)) return 1;
  return Math.max(1, Math.min(FORGE.MAX_LEVEL, Math.floor(level as number)));
}

/**
 * Effective combat stats of a bita at a forge level.
 * Level 1 returns the catalog values untouched; each level adds a modest
 * power/rare-chance bump so upgrades matter without breaking the balance.
 */
export function effectiveBita(
  def: BitaDef,
  level = 1,
): { power: number; rareChance: number; level: number } {
  const lv = clampBitaLevel(level);
  const steps = lv - 1;
  return {
    power: def.power * (1 + FORGE.POWER_PER_LEVEL * steps),
    rareChance: Math.min(0.5, def.rareChance + FORGE.RARE_PER_LEVEL * steps),
    level: lv,
  };
}
