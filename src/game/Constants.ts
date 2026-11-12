/**
 * Numeric/gameplay constants for CHIPS.
 *
 * Gameplay values live here (or in `src/game/data/*`) rather than scattered
 * across scenes — see `.opencode/docs/coding-standards.md`:
 * "Gameplay values must be data-driven (external config), never hardcoded".
 *
 * Every knob that affects balance is named `TUNING`-style and is referenced by
 * the GDD in `design/gdd/`.
 */

/** Logical render resolution. `Scale.FIT` letterboxes to any screen. */
export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 800;

/** Phaser scene keys. */
export const SCENE_KEYS = {
  BOOT: 'BootScene',
  MENU: 'MenuScene',
  MATCH: 'MatchScene',
  COLLECTION: 'CollectionScene',
  MARKET: 'MarketScene',
  LEADERBOARD: 'LeaderboardScene',
  ONLINE: 'OnlineScene',
  ROOM: 'RoomScene',
} as const;

export const SCENES = SCENE_KEYS;

/** localStorage key for the persisted player profile. */
export const PROFILE_STORAGE_KEY = 'chips.profile.v1';

/** Starting balance of ordinary chips (фишки) for a brand new player. */
export const STARTING_BALANCE = 100;

/** Selectable stakes for a match (chips each side antes). */
export const STAKE_OPTIONS = [10, 20, 50] as const;

/**
 * Online (multiplayer) tuning. Stakes for player-created tables may be any
 * integer in `[MIN, MAX]`; these are just the quick-pick presets.
 */
export const ONLINE = {
  /** Quick-pick stake presets in the "create table" dialog. */
  STAKE_PRESETS: [10, 50, 100, 500, 1000] as const,
  MIN_STAKE: 1,
  MAX_STAKE: 1_000_000,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 10,
  /** How often the lobby list is re-requested while open (ms). */
  LOBBY_REFRESH_MS: 5000,
} as const;

/**
 * A match is hard-capped by turn count so a pathological table can never run
 * forever (mirrors `MAX_TURNS` in `server/engine.mjs`).
 */
export const MAX_TURNS = 600;

/** Бита-less "hand" smash power baseline. */
export const BARE_HAND_POWER = 1.0;

/**
 * Сотки smash model — see `design/gdd/core-match.md`.
 * Flip probability for a single chip in the stack:
 *
 *   p = clamp((BASE_FLIP + power * POWER_TO_FLIP - weight * WEIGHT_PENALTY)
 *             * shock(depth), MIN_FLIP, MAX_FLIP)
 *
 * where `shock(depth) = max(SHOCK_FLOOR, 1 - depth * STACK_DECAY)`.
 */
export const SMASH = {
  /** Base chance a chip flips with the weakest smash. */
  BASE_FLIP: 0.16,
  /** How much each point of bita power adds to the flip chance. */
  POWER_TO_FLIP: 0.065,
  /** How much a chip's own weight (resistance) subtracts per point. */
  WEIGHT_PENALTY: 0.018,
  /** Hard floor / ceiling on a single chip's flip chance. */
  MIN_FLIP: 0.02,
  MAX_FLIP: 0.96,
  /** Shock decays with depth into the stack (top chips flip easier). */
  STACK_DECAY: 0.024,
  /** Minimum shock multiplier so deep chips are never impossible. */
  SHOCK_FLOOR: 0.32,
  /** Power multiplier range */
  POWER_MULT_MIN: 0.5,
  POWER_MULT_MAX: 1.85,
  POWER_MULT_DEFAULT: 1.0,
  /** How much power affects penetration (decay reduction) */
  DECAY_POWER_SCALE: 0.18,
} as const;

/**
 * Aiming ("куда бить") tuning — the player directs the smash at a spot on the
 * column instead of hitting it flat. Chips near the aimed depth flip more
 * easily; the bonus falls off smoothly towards the rest of the stack.
 *
 * `BONUS` is added to a chip's flip chance before the `[MIN_FLIP, MAX_FLIP]`
 * clamp, so a perfect aim meaningfully "digs" where you pointed.
 */
export const AIM = {
  /** Max extra flip chance for a chip sitting exactly at the aimed depth. */
  BONUS: 0.17,
  /** Half-width of the focus band, as a fraction of the stack depth (0…1). */
  SPREAD: 0.42,
} as const;

/**
 * «Переход» — punishment for a whiffed smash (0 chips flipped). The next player
 * gets an extra aim bonus that is spent on their very next smash.
 * See `design/gdd/core-match.md`.
 */
export const MISS = {
  /** Extra flip chance handed over, applied at the recipient's aimed spot. */
  BONUS: 0.12,
  /** Cap on the accumulated bonus. */
  MAX_BONUS: 0.24,
} as const;

/**
 * Special moves («спец-удары») — active options a player may spend on a turn.
 *
 * They are paid for with chips the player has **already flipped**: the chips go
 * back to the bottom of the pot face-down. So a move costs position, not money,
 * and the total number of chips in play never changes.
 */
export const MOVES = {
  /** 🎯 Точный удар: guarantees at least `MIN_FLIPS` chips right at the aim. */
  PRECISE: { COST: 2, MIN_FLIPS: 2 },
  /** 🛡 Отбой: your smash also weakens the next player by `WEAKEN`. */
  BRACE: { COST: 1, WEAKEN: 0.25 },
  /** ⚡ Двойной удар: smash twice in one and the same turn. */
  DOUBLE: { COST: 1, HITS: 2 },
} as const;

/**
 * Press-and-hold power charge ("как бросок камня"): the meter sweeps
 * min → max and back while the player holds, so the release *times* the hit.
 */
export const CHARGE = {
  /** Time (ms) for the meter to sweep from the minimum to the maximum. */
  SWEEP_MS: 820,
} as const;

/** Chance to additionally knock out a bonus chip straight into the collection. */
export const BONUS_FIND = {
  /** Without a bita you can still rarely find a common chip. */
  COMMON_BASE: 0.12,
  /** A bita additionally rolls for a rare/unique chip using its `rareChance`. */
} as const;

/** Economy knobs — see `design/gdd/economy.md`. */
export const ECONOMY = {
  /** Daily reward range (inclusive). */
  DAILY_MIN: 20,
  DAILY_MAX: 100,
  /** Extra chips per consecutive day, capped. */
  DAILY_STREAK_BONUS: 5,
  DAILY_STREAK_CAP: 50,
  /** Fortune wheel spin price. */
  WHEEL_PRICE: 20,
  /** Achievement reward fallback (used by data that omits an explicit value). */
  ACHIEVEMENT_REWARD_DEFAULT: 50,
} as const;

/**
 * Кузница (forge): duplicate chips are melted into bita upgrades and new bitas.
 * One forge point = `ChipDef.value`, so a common duplicate is worth 1 point and
 * a legendary one 50.
 */
export const FORGE = {
  /** Craft price = ceil(bita.price / CRAFT_DIVISOR) forge points. */
  CRAFT_DIVISOR: 5,
  /** Level 1 → 2 costs this many points; each next level adds LEVEL_STEP. */
  LEVEL_BASE_COST: 20,
  LEVEL_STEP: 12,
  MAX_LEVEL: 5,
  /** Effective bita stats per level above 1. */
  POWER_PER_LEVEL: 0.08,
  RARE_PER_LEVEL: 0.005,
} as const;

/** AI opponent tuning. */
export const AI = {
  /** Probability the AI makes the "aggressive" (higher power) choice each turn. */
  AGGRESSION: 0.6,
  /** Artificial delay (ms) between the AI deciding and smashing. */
  THINK_MS: 750,
  /**
   * 0…1 — how reliably the AI plays the *best* aim and a strong charge instead
   * of a random one. 1 = a ruthless opponent, 0 = a drunk one.
   */
  SKILL: 0.7,
  /** Chance the AI spends a special move on its turn (when it can afford one). */
  MOVE_CHANCE: 0.3,
  /** Jitter (± half of it) added to the AI's chosen aim so it never looks robotic. */
  AIM_JITTER: 0.1,
} as const;
