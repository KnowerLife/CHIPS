/**
 * Server-side mirror of the gameplay data used by the authoritative online
 * simulation.
 *
 * The browser build keeps the catalog in TypeScript (`src/game/data/*.ts`).
 * The game server is dependency-free ES modules (so it deploys to Amvera with
 * a bare `node` runtime), therefore the handful of numbers the server needs to
 * resolve a smash are mirrored here.
 *
 * IMPORTANT: keep in sync with
 *   - src/game/data/Chips.ts        (SEEDS + RARITY + RARITY_DROP_WEIGHT)
 *   - src/game/data/Bitas.ts        (BITAS)
 *   - src/game/Constants.ts         (SMASH, BONUS_FIND, BARE_HAND_POWER)
 *
 * `server/gamedata.test.mjs` asserts the smash math against golden values so a
 * silent divergence is caught by `npm run test:server`.
 */

/** Rarity modifiers applied to the seed catalog (weight = flip resistance). */
export const RARITY = {
  common: { weight: 1.0, value: 1 },
  rare: { weight: 1.4, value: 5 },
  epic: { weight: 1.8, value: 15 },
  legendary: { weight: 2.4, value: 50 },
};

/** Base drop weight per rarity when building a random pot. */
export const RARITY_DROP_WEIGHT = {
  common: 100,
  rare: 22,
  epic: 5,
  legendary: 1,
};

/** [id, rarity] pairs — mirrors `SEEDS` in `src/game/data/Chips.ts`. */
export const SEEDS = [
  ['chupa_green', 'common'],
  ['chupa_red', 'common'],
  ['chupa_blue', 'common'],
  ['chupa_gold', 'rare'],

  ['mk_scorpion', 'common'],
  ['mk_subzero', 'common'],
  ['mk_raiden', 'rare'],
  ['mk_plastic', 'epic'],

  ['poca_leaf', 'common'],
  ['poca_feather', 'rare'],

  ['casper_white', 'common'],
  ['casper_ghost', 'rare'],

  ['pog_yellow', 'common'],
  ['pog_purple', 'rare'],
  ['pog_metal', 'epic'],

  ['sf_ryu', 'common'],
  ['sf_ken', 'common'],
  ['sf_mbison', 'epic'],

  ['pkm_pika', 'rare'],
  ['pkm_charm', 'rare'],
  ['pkm_holo', 'legendary'],

  ['turtle_green', 'common'],
  ['turtle_pizza', 'rare'],

  ['gold_coin', 'epic'],
  ['gold_legend', 'legendary'],
];

/** id -> { rarity, weight, value } */
export const CHIP_BY_ID = Object.fromEntries(
  SEEDS.map(([id, rarity]) => [
    id,
    { id, rarity, weight: RARITY[rarity].weight, value: RARITY[rarity].value },
  ]),
);

/** id -> rarity, used by the pot/collection lookups. */
export const CHIP_RARITY = Object.fromEntries(SEEDS.map(([id, rarity]) => [id, rarity]));

/** id -> { power, rareChance } — mirrors `BITAS` in `src/game/data/Bitas.ts`. */
export const BITA_BY_ID = {
  bit_plastic: { power: 0.6, rareChance: 0.03 },
  bit_star: { power: 1.2, rareChance: 0.05 },
  bit_rocket: { power: 1.4, rareChance: 0.045 },
  bit_diamond: { power: 1.7, rareChance: 0.06 },
  bit_crown: { power: 2.0, rareChance: 0.07 },
  bit_fire: { power: 1.5, rareChance: 0.05 },
};

/** Smash model — mirrors `SMASH` in `src/game/Constants.ts`. */
export const SMASH = {
  BASE_FLIP: 0.16,
  POWER_TO_FLIP: 0.065,
  WEIGHT_PENALTY: 0.018,
  MIN_FLIP: 0.02,
  MAX_FLIP: 0.96,
  STACK_DECAY: 0.024,
  SHOCK_FLOOR: 0.32,
  POWER_MULT_MIN: 0.5,
  POWER_MULT_MAX: 1.85,
  POWER_MULT_DEFAULT: 1.0,
  DECAY_POWER_SCALE: 0.18,
};

/** Aiming focus — mirrors `AIM` in `src/game/Constants.ts`. */
export const AIM = {
  BONUS: 0.17,
  SPREAD: 0.42,
};

/** «Переход» (miss penalty) — mirrors `MISS` in `src/game/Constants.ts`. */
export const MISS = {
  BONUS: 0.12,
  MAX_BONUS: 0.24,
};

/** Special moves («спец-удары») — mirrors `MOVES` in `src/game/Constants.ts`. */
export const MOVES = {
  PRECISE: { COST: 2, MIN_FLIPS: 2 },
  BRACE: { COST: 1, WEAKEN: 0.25 },
  DOUBLE: { COST: 1, HITS: 2 },
};

/** Bot-brain tuning — mirrors `AI` in `src/game/Constants.ts`. */
export const AI = {
  SKILL: 0.7,
  MOVE_CHANCE: 0.3,
  AIM_JITTER: 0.1,
};

/** Bonus-find tuning — mirrors `BONUS_FIND`. */
export const BONUS_FIND = { COMMON_BASE: 0.12 };

/** Bare-hand power — mirrors `BARE_HAND_POWER`. */
export const BARE_HAND_POWER = 1.0;

/** Forge tuning — mirrors `FORGE` in `src/game/Constants.ts` (level part). */
export const FORGE = {
  MAX_LEVEL: 5,
  POWER_PER_LEVEL: 0.08,
  RARE_PER_LEVEL: 0.005,
};

/** Effective stats of a bita at a forge level. */
export function effectiveBita(def, level = 1) {
  const lv = Number.isFinite(level) ? Math.max(1, Math.min(FORGE.MAX_LEVEL, Math.floor(level))) : 1;
  const steps = lv - 1;
  return {
    power: def.power * (1 + FORGE.POWER_PER_LEVEL * steps),
    rareChance: Math.min(0.5, def.rareChance + FORGE.RARE_PER_LEVEL * steps),
    level: lv,
  };
}

/** Chips that can be found as a bonus when a bita is equipped. */
export const RARE_BONUS_POOL = [
  'mk_raiden',
  'pog_purple',
  'pkm_pika',
  'gold_coin',
  'pkm_holo',
  'chupa_gold',
  'casper_ghost',
  'poca_feather',
  'turtle_pizza',
  'pkm_charm',
];

/** Common chips eligible for the bita-less bonus roll. */
export const COMMON_BONUS_POOL = SEEDS.filter(([, r]) => r === 'common').map(([id]) => id);
