import type { ChipDef, Rarity } from '../Types';

/**
 * The collectible chip catalog.
 *
 * Series and flavour are drawn from the real late-90s/early-2000s "сотки"
 * craze (Chupa Caps, Mortal Kombat, Pocahontas, POG, Street Fighter, Pokémon,
 * Turtles, Gold…). Gameplay values are data-driven so designers can retune
 * without touching code.
 *
 * `weight` = resistance to being flipped by a smash (see `SMASH` constants).
 * `value` = collector/trade value used by the economy.
 */

/** Rarity multipliers applied below to keep the catalog consistent. */
const RARITY: Record<Rarity, { weight: number; value: number }> = {
  common: { weight: 1.0, value: 1 },
  rare: { weight: 1.4, value: 5 },
  epic: { weight: 1.8, value: 15 },
  legendary: { weight: 2.4, value: 50 },
};

/** Compact authoring shape; expanded into `ChipDef[]` below. */
interface Seed {
  id: string;
  name: string;
  series: string;
  rarity: Rarity;
  faceColor: number;
  face: string;
}

const SEEDS: Seed[] = [
  // — Chupa Caps ————————————————————————————————
  { id: 'chupa_green', name: 'Chupa Caps (зелёная)', series: 'Chupa Caps', rarity: 'common', faceColor: 0x2fbf5e, face: '🍭' },
  { id: 'chupa_red', name: 'Chupa Caps (красная)', series: 'Chupa Caps', rarity: 'common', faceColor: 0xe23b3b, face: '🍭' },
  { id: 'chupa_blue', name: 'Chupa Caps (синяя)', series: 'Chupa Caps', rarity: 'common', faceColor: 0x3b7de2, face: '🍭' },
  { id: 'chupa_gold', name: 'Chupa Caps Gold', series: 'Chupa Caps', rarity: 'rare', faceColor: 0xd9a521, face: '⭐' },

  // — Mortal Kombat ——————————————————————————————
  { id: 'mk_scorpion', name: 'Mortal Kombat — Scorpion', series: 'Mortal Kombat', rarity: 'common', faceColor: 0x9a1f1f, face: '🐉' },
  { id: 'mk_subzero', name: 'Mortal Kombat — Sub-Zero', series: 'Mortal Kombat', rarity: 'common', faceColor: 0x2a6fb0, face: '❄️' },
  { id: 'mk_raiden', name: 'Mortal Kombat — Raiden', series: 'Mortal Kombat', rarity: 'rare', faceColor: 0x2f4f7a, face: '⚡' },
  { id: 'mk_plastic', name: 'Mortal Kombat (пластик)', series: 'Mortal Kombat', rarity: 'epic', faceColor: 0x1b1b1b, face: '💀' },

  // — Pocahontas —————————————————————————————————
  { id: 'poca_leaf', name: 'Pocahontas — Лист', series: 'Pocahontas', rarity: 'common', faceColor: 0x8a5a2b, face: '🍃' },
  { id: 'poca_feather', name: 'Pocahontas — Перо', series: 'Pocahontas', rarity: 'rare', faceColor: 0xb87333, face: '🪶' },

  // — Casper Taps ————————————————————————————————
  { id: 'casper_white', name: 'Casper — Белая', series: 'Casper Taps', rarity: 'common', faceColor: 0xdfe6ee, face: '👻' },
  { id: 'casper_ghost', name: 'Casper — Призрак', series: 'Casper Taps', rarity: 'rare', faceColor: 0xcdd7e0, face: '👻' },

  // — Pog / POG ——————————————————————————————————
  { id: 'pog_yellow', name: 'POG — Жёлтая', series: 'POG', rarity: 'common', faceColor: 0xe8c93b, face: '🌀' },
  { id: 'pog_purple', name: 'POG — Фиолетовая', series: 'POG', rarity: 'rare', faceColor: 0x7a3bd1, face: '🌀' },
  { id: 'pog_metal', name: 'POG Metal (шершавая)', series: 'POG', rarity: 'epic', faceColor: 0x8d9299, face: '🌀' },

  // — Street Fighter —————————————————————————————
  { id: 'sf_ryu', name: 'Street Fighter — Ryu', series: 'Street Fighter', rarity: 'common', faceColor: 0x2f7d4f, face: '🥋' },
  { id: 'sf_ken', name: 'Street Fighter — Ken', series: 'Street Fighter', rarity: 'common', faceColor: 0xc0392b, face: '🥋' },
  { id: 'sf_mbison', name: 'Street Fighter — M. Bison', series: 'Street Fighter', rarity: 'epic', faceColor: 0x7a1020, face: '👑' },

  // — Pokémon ———————————————————————————————————
  { id: 'pkm_pika', name: 'Pokémon — Pikachu', series: 'Pokémon', rarity: 'rare', faceColor: 0xf2c33c, face: '⚡' },
  { id: 'pkm_charm', name: 'Pokémon — Charmander', series: 'Pokémon', rarity: 'rare', faceColor: 0xe9743b, face: '🔥' },
  { id: 'pkm_holo', name: 'Pokémon — голограмма', series: 'Pokémon', rarity: 'legendary', faceColor: 0x59d0d6, face: '✨' },

  // — Turtles ———————————————————————————————————
  { id: 'turtle_green', name: 'Turtles — Зелёная', series: 'Turtles', rarity: 'common', faceColor: 0x4caf50, face: '🐢' },
  { id: 'turtle_pizza', name: 'Turtles — Пицца', series: 'Turtles', rarity: 'rare', faceColor: 0xe0a13a, face: '🍕' },

  // — Gold / premium ————————————————————————————
  { id: 'gold_coin', name: 'Gold — Монета', series: 'Gold', rarity: 'epic', faceColor: 0xd4af37, face: '🪙' },
  { id: 'gold_legend', name: 'Gold — Легенда', series: 'Gold', rarity: 'legendary', faceColor: 0xf5d76e, face: '🏆' },
];

function expand(seed: Seed): ChipDef {
  const mods = RARITY[seed.rarity];
  return {
    ...seed,
    weight: mods.weight,
    value: mods.value,
  };
}

/** Full catalog, ordered as authored. */
export const CHIPS: ChipDef[] = SEEDS.map(expand);

/** Fast lookup by id. */
export const CHIP_BY_ID: Record<string, ChipDef> = Object.fromEntries(
  CHIPS.map((c) => [c.id, c]),
);

export function getChip(id: string): ChipDef {
  const chip = CHIP_BY_ID[id];
  if (!chip) throw new Error(`Unknown chip id: ${id}`);
  return chip;
}

/** All chips of a given rarity. */
export function chipsByRarity(rarity: Rarity): ChipDef[] {
  return CHIPS.filter((c) => c.rarity === rarity);
}

/** Base drop weight for a rarity when building a random pot. */
export const RARITY_DROP_WEIGHT: Record<Rarity, number> = {
  common: 100,
  rare: 22,
  epic: 5,
  legendary: 1,
};
