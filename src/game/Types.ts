/**
 * Shared domain types for CHIPS.
 *
 * These are engine-agnostic: the pure simulation in `src/game/systems/*` never
 * imports Phaser, which keeps it unit-testable (see coding standards).
 */

/** Rarity ladder for collectible chips. */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/** A collectible chip definition (a "сотка"/"кэпс"). */
export interface ChipDef {
  /** Stable id used in inventories and saves. */
  id: string;
  /** Display name (ru). */
  name: string;
  /** Collector series, e.g. "Chupa Caps", "Mortal Kombat". */
  series: string;
  rarity: Rarity;
  /** Face background colour (0xRRGGBB). */
  faceColor: number;
  /** Symbol/glyph drawn on the face (emoji or letter). */
  face: string;
  /**
   * Resistance to flipping — heavier/thicker chips flip less. Baseline 1.0.
   * Feeds `SMASH.WEIGHT_PENALTY` in the flip formula.
   */
  weight: number;
  /** Collector value used for trading/forging/economy. */
  value: number;
}

/** A "бита" (slammer) — the heavy tool used to smash the stack. */
export interface BitaDef {
  id: string;
  name: string;
  /** Face glyph. */
  face: string;
  rarity: Rarity;
  /** Market price in ordinary chips. */
  price: number;
  /** Added to flip chance via `SMASH.POWER_TO_FLIP`. */
  power: number;
  /** Extra chance per smash to knock out a rare/unique chip into the collection. */
  rareChance: number;
  /** Face colour for rendering. */
  color: number;
}

/** A concrete chip sitting in a stack or a collection. */
export interface ChipInstance {
  /** Reference to a `ChipDef.id`. */
  defId: string;
  /** true = face up (перевёрнута, "выбита"); false = рубашкой вверх. */
  faceUp: boolean;
}

export type MatchStatus = 'active' | 'finished';

export type SmashOutcome = 'flipped' | 'none';

/** Per-turn record, useful for the battle log and replays. */
export interface SmashReport {
  playerIndex: 0 | 1;
  /** Chips that flipped face-up this smash (collected by the smasher). */
  flipped: ChipInstance[];
  /** Stack indices that flipped — lets the renderer animate the right chips. */
  flippedIndices: number[];
  /** Bonus chip routed to the collection (not the pot), if any. */
  bonus: ChipInstance | null;
  /** Chips still face-down after the smash. */
  remaining: number;
  outcome: SmashOutcome;
  /** Special move that produced this pass («двойной удар» yields two reports). */
  move?: MoveKind;
  /** This pass was weakened by the opponent's «отбой». */
  weakened?: boolean;
  /** «Точный удар» had to force the flip (the roll came up short). */
  precise?: boolean;
}

/** A special move a player may spend on a turn («спец-удары»). */
export type MoveKind = 'normal' | 'precise' | 'brace' | 'double';

export interface PlayerState {
  index: 0 | 1;
  name: string;
  isAI: boolean;
  /** Bita id used this match (null = bare hand). */
  bitaId: string | null;
  /** Bita upgrade level (1…5) — carries the forge bonus into a match. */
  bitaLevel: number;
  /** Chips won during this match. */
  collected: ChipInstance[];
  /** Total chips anted at match start. */
  anted: number;
  /**
   * Extra aim bonus left on this player by the previous player's whiff
   * («переход»). Consumed by their next smash.
   */
  focusBonus: number;
  /**
   * Power penalty (0…1) waiting on this player's next smash — dealt by the
   * previous player's «отбой». Consumed by their next smash.
   */
  brace: number;
}

/** Everything needed to render and drive a match. */
export interface MatchState {
  status: MatchStatus;
  players: [PlayerState, PlayerState];
  /** The pot: chips face-down (рубашкой вверх). */
  stack: ChipInstance[];
  current: 0 | 1;
  /** How many chips each player anted. */
  stake: number;
  turn: number;
  log: SmashReport[];
}

/** Persisted player profile. */
export interface PlayerProfile {
  version: number;
  name: string;
  balance: number;
  /** defId -> count of owned chips. */
  inventory: Record<string, number>;
  /** Bita ids owned. */
  ownedBitas: string[];
  /** bitaId -> forge level (1…5). Missing = 1. */
  bitaLevels: Record<string, number>;
  /** Currently equipped bita id, or null. */
  equippedBita: string | null;
  achievements: string[];
  /** Series ids whose completion reward was already paid. */
  seriesClaimed: string[];
  /** Today's daily quests (rolled on first use of the day). */
  quests: QuestsState;
  stats: PlayerStats;
  /** Persisted local leaderboard (best results). */
  leaderboard: LeaderboardEntry[];
}

/** One daily quest of the three offered each day. */
export interface QuestProgress {
  /** `QuestDef.id`. */
  id: string;
  progress: number;
  /** Reward already collected. */
  claimed: boolean;
}

/** Daily quest slate. `day` is a local `YYYY-MM-DD` key. */
export interface QuestsState {
  day: string;
  items: QuestProgress[];
}

export interface PlayerStats {
  gamesPlayed: number;
  gamesWon: number;
  chipsWon: number;
  chipsLost: number;
  bitsCollected: number;
  dailyStreak: number;
  /** Epoch ms of the last daily claim. */
  lastDaily: number;
  winStreak: number;
  bestWinStreak: number;
}

export interface LeaderboardEntry {
  name: string;
  chips: number;
  at: number;
}

/** Global leaderboard row (server-side, per account). */
export interface GlobalLeaderboardEntry {
  id: string;
  name: string;
  /** Unique chips collected — the primary metric. */
  chips: number;
  /** Match wins. */
  wins: number;
  at: number;
}
