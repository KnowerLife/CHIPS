import { ECONOMY } from '../Constants';
import { ACHIEVEMENTS, type Achievement } from '../data/Achievements';
import { getChip } from '../data/Chips';
import type { ChipInstance, MatchState, PlayerProfile, SmashReport } from '../Types';
import type { Rng } from '../Rng';
import { addChip, addChips, uniqueChips } from './Economy';
import { syncSeries } from './Series';
import { questEvent } from './Quests';
import type { SeriesDef } from '../data/Series';

const DAY_MS = 24 * 60 * 60 * 1000;

/* ───────────────────────── Daily reward ───────────────────────── */

export interface DailyResult {
  ok: boolean;
  reward: number;
  streak: number;
  /** ms until the next claim is available (0 when claimed now). */
  waitMs: number;
}

/**
 * Claim the daily reward. Streak grows when claims are within 48h of each other.
 */
export function claimDaily(
  profile: PlayerProfile,
  rng: Rng,
  now = Date.now(),
): DailyResult {
  const stats = profile.stats;
  const elapsed = now - stats.lastDaily;

  if (stats.lastDaily > 0 && elapsed < DAY_MS) {
    return { ok: false, reward: 0, streak: stats.dailyStreak, waitMs: DAY_MS - elapsed };
  }

  const continued = stats.lastDaily > 0 && elapsed < DAY_MS * 2;
  const streak = continued ? stats.dailyStreak + 1 : 1;

  const base = rng.int(ECONOMY.DAILY_MIN, ECONOMY.DAILY_MAX);
  const bonus = Math.min((streak - 1) * ECONOMY.DAILY_STREAK_BONUS, ECONOMY.DAILY_STREAK_CAP);
  const reward = base + bonus;

  stats.dailyStreak = streak;
  stats.lastDaily = now;
  addChips(profile, reward);

  return { ok: true, reward, streak, waitMs: 0 };
}

/* ───────────────────────── Fortune wheel ───────────────────────── */

export type WheelPrize =
  | { kind: 'chips'; amount: number; jackpot: boolean }
  | { kind: 'chip'; defId: string };

export interface WheelResult {
  ok: boolean;
  prize?: WheelPrize;
  reason?: 'poor';
}

const WHEEL_TABLE: { weight: number; prize: WheelPrize }[] = [
  { weight: 30, prize: { kind: 'chips', amount: 10, jackpot: false } },
  { weight: 25, prize: { kind: 'chips', amount: 20, jackpot: false } },
  { weight: 15, prize: { kind: 'chips', amount: 50, jackpot: false } },
  { weight: 20, prize: { kind: 'chip', defId: '__rare__' } },
  { weight: 10, prize: { kind: 'chips', amount: 100, jackpot: true } },
];

/** Spin the fortune wheel for a fee. */
export function spinWheel(profile: PlayerProfile, rng: Rng, now = Date.now()): WheelResult {
  if (profile.balance < ECONOMY.WHEEL_PRICE) return { ok: false, reason: 'poor' };
  profile.balance -= ECONOMY.WHEEL_PRICE;

  questEvent(profile, 'wheel', 1, now);

  const entry = rng.weighted(WHEEL_TABLE, (e) => e.weight);
  const prize = entry.prize;

  if (prize.kind === 'chips') {
    addChips(profile, prize.amount);
  } else {
    // "__rare__" resolves to a random rare-or-better chip.
    const pool = ['mk_raiden', 'pog_purple', 'pkm_pika', 'gold_coin', 'pkm_holo'];
    const defId = rng.pick(pool);
    addChip(profile, defId);
    syncSeries(profile);
    return { ok: true, prize: { kind: 'chip', defId } };
  }
  return { ok: true, prize };
}

/* ───────────────────────── Achievements ───────────────────────── */

/** Grant any newly-earned achievements; returns the ones granted. */
export function checkAchievements(profile: PlayerProfile): Achievement[] {
  const granted: Achievement[] = [];
  for (const ach of ACHIEVEMENTS) {
    if (profile.achievements.includes(ach.id)) continue;
    if (ach.check(profile)) {
      profile.achievements.push(ach.id);
      addChips(profile, ach.reward);
      granted.push(ach);
    }
  }
  return granted;
}

/* ───────────────────────── Match settlement ───────────────────────── */

export interface SettlementResult {
  won: boolean;
  tie: boolean;
  /** Chips flipped by the player this match (credited to balance + collection). */
  flipped: number;
  balanceDelta: number;
  newAchievements: Achievement[];
  /** Series completed (and paid) for the first time by this settlement. */
  newSeries: SeriesDef[];
}

/** Add collected chips (and any bonus) to the collection. */
function collectToInventory(profile: PlayerProfile, chips: ChipInstance[]): void {
  for (const chip of chips) {
    // Validate id defensively; unknown ids are skipped.
    try {
      getChip(chip.defId);
      addChip(profile, chip.defId);
    } catch {
      /* ignore unknown */
    }
  }
}

/**
 * Settle a finished match against the player's profile.
 *
 * Currency model (see `design/gdd/economy.md`):
 * each side antes `stake`; the chips a player flips are theirs — credited back
 * to balance 1:1 **and** added to the collection as trophies. So a match is
 * zero-sum in chips and the long-term faucets are the daily reward, the wheel
 * and achievements.
 */
export function settleMatch(
  profile: PlayerProfile,
  state: MatchState,
  playerIndex: 0 | 1,
  wonOverride?: boolean,
  now = Date.now(),
): SettlementResult {
  const me = state.players[playerIndex];
  const opponent = state.players[playerIndex === 0 ? 1 : 0];

  const flipped = me.collected.length;
  const tie = flipped === opponent.collected.length;
  const won = wonOverride ?? flipped > opponent.collected.length;

  const uniqueBefore = uniqueChips(profile);
  const specialBefore = countSpecials(state.log, playerIndex);

  addChips(profile, flipped);
  collectToInventory(profile, me.collected);

  // Bonus chips knocked out during the match go to the collection.
  for (const report of state.log) {
    if (report.playerIndex === playerIndex && report.bonus) {
      collectToInventory(profile, [report.bonus]);
      profile.stats.bitsCollected += 1;
    }
  }

  const stats = profile.stats;
  stats.gamesPlayed += 1;
  if (won) {
    stats.gamesWon += 1;
    stats.winStreak += 1;
    stats.bestWinStreak = Math.max(stats.bestWinStreak, stats.winStreak);
  } else {
    stats.winStreak = 0;
  }
  const netChips = flipped - me.anted;
  if (netChips >= 0) stats.chipsWon += netChips;
  else stats.chipsLost += -netChips;

  // Daily quests: a match advances wins/flips/specials and (newly found chips)
  // the collection goal.
  questEvent(profile, 'wins', won ? 1 : 0, now);
  questEvent(profile, 'flips', flipped, now);
  questEvent(profile, 'special', specialBefore, now);
  const uniqueAfter = uniqueChips(profile);
  if (uniqueAfter > uniqueBefore) questEvent(profile, 'unique', uniqueAfter - uniqueBefore, now);

  const newAchievements = checkAchievements(profile);
  const newSeries = syncSeries(profile);

  return {
    won,
    tie,
    flipped,
    balanceDelta: flipped - me.anted,
    newAchievements,
    newSeries,
  };
}

/** Number of special strikes the player already recorded in this match. */
function countSpecials(log: SmashReport[], playerIndex: 0 | 1): number {
  return log.filter((r) => r.playerIndex === playerIndex && r.move && r.move !== 'normal').length;
}

/** Snapshot used by the leaderboard scene. */
export function recordLeaderboard(profile: PlayerProfile): void {
  profile.leaderboard.push({
    name: profile.name,
    chips: uniqueChips(profile),
    at: Date.now(),
  });
  profile.leaderboard.sort((a, b) => b.chips - a.chips);
  profile.leaderboard = profile.leaderboard.slice(0, 10);
}
