import {
  AIM,
  AI,
  BARE_HAND_POWER,
  BONUS_FIND,
  MAX_TURNS,
  MISS,
  MOVES,
  SMASH,
} from '../Constants';
import { CHIPS, RARITY_DROP_WEIGHT, chipsByRarity, getChip } from '../data/Chips';
import { getBita, effectiveBita, clampBitaLevel } from '../data/Bitas';
import type {
  ChipDef,
  ChipInstance,
  MatchState,
  MoveKind,
  Rarity,
  SmashReport,
} from '../Types';
import type { Rng } from '../Rng';



/** Configuration for a single 1v1 match. */
export interface MatchConfig {
  /** Chips each side antes; the pot holds `2 * stake` chips. */
  stake: number;
  playerName: string;
  opponentName: string;
  opponentIsAI: boolean;
  playerBitaId: string | null;
  opponentBitaId?: string | null;
  /** Forge level of each side's bita (1…5, default 1). */
  playerBitaLevel?: number;
  opponentBitaLevel?: number;
  /**
   * First player. If omitted, a coin toss (via `rng`) decides — mirroring the
   * real "камень-ножницы-бумага" for first smash.
   */
  firstPlayer?: 0 | 1;
}

/** Clamp helper. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Aiming ("куда бить"): the player points the smash at a spot in the column.
 *
 * `focus` is the aimed depth in `0…1` (0 = top of the stack, 1 = bottom) and
 * `span` is the stack length at the moment of the smash. `aimBonus` returns the
 * extra flip chance that applies to a chip at `depth`; without an aim the whole
 * column is hit flat (the original behaviour).
 *
 * The band is also reused at a smaller scale for «переход» (a miss hands the
 * next player a bonus *at their aim*), which is why `scale` is a parameter.
 */
function focusBand(depth: number, span: number, focus: number): number {
  const f = clamp(focus, 0, 1);
  if (span <= 1) return 1;
  const d = depth / (span - 1);
  const t = 1 - Math.abs(d - f) / AIM.SPREAD;
  return t > 0 ? t * t : 0;
}

/** Aim bonus at `depth`, optionally scaled (used for «переход» bonuses). */
export function aimBonus(
  depth: number,
  span: number,
  focus: number,
  scale: number = AIM.BONUS,
): number {
  return scale * focusBand(depth, span, focus);
}

/** Options for a single smash. */
export interface SmashOptions {
  /** Power multiplier in `[SMASH.POWER_MULT_MIN, max]`. Defaults to 1.0. */
  powerMultiplier?: number;
  /**
   * Aimed depth in `0…1` (0 = top of the stack, 1 = bottom). Omit to smash the
   * whole column flat — i.e. the original behaviour.
   */
  focus?: number;
  /** Special move to play this turn. Defaults to `normal`. */
  move?: MoveKind;
}

/** Build the face-down pot for a match. */
export function buildPot(stake: number, rng: Rng): ChipInstance[] {
  const total = stake * 2;
  const pot: ChipInstance[] = [];
  for (let i = 0; i < total; i++) {
    const def = rng.weighted(CHIPS, (c) => RARITY_DROP_WEIGHT[c.rarity]);
    pot.push({ defId: def.id, faceUp: false });
  }
  // Top of the stack is index 0; shuffle so pot composition is varied.
  return rng.shuffle(pot);
}

/** Create a fresh match. */
export function createMatch(config: MatchConfig, rng: Rng): MatchState {
  const first: 0 | 1 =
    config.firstPlayer ?? (rng.chance(0.5) ? 0 : 1);

  return {
    status: 'active',
    players: [
      {
        index: 0,
        name: config.playerName,
        isAI: false,
        bitaId: config.playerBitaId,
        bitaLevel: clampBitaLevel(config.playerBitaLevel ?? 1),
        collected: [],
        anted: config.stake,
        focusBonus: 0,
        brace: 0,
      },
      {
        index: 1,
        name: config.opponentName,
        isAI: config.opponentIsAI,
        bitaId: config.opponentBitaId ?? null,
        bitaLevel: clampBitaLevel(config.opponentBitaLevel ?? 1),
        collected: [],
        anted: config.stake,
        focusBonus: 0,
        brace: 0,
      },
    ],
    stack: buildPot(config.stake, rng),
    current: first,
    stake: config.stake,
    turn: 1,
    log: [],
  };
}

/** Resolve which bita (if any) the given player is using. */
export function powerOf(state: MatchState, index: 0 | 1): { power: number; rareChance: number } {
  const p = state.players[index];
  if (!p.bitaId) return { power: BARE_HAND_POWER, rareChance: 0 };
  const stats = effectiveBita(getBita(p.bitaId), p.bitaLevel ?? 1);
  return { power: stats.power, rareChance: stats.rareChance };
}

/**
 * Flip probability for a single chip at a given depth (0 = top of stack).
 * Exposed for tests and for the UI's "smash preview".
 */
export function flipChance(
  power: number,
  weight: number,
  depth: number,
  powerMultiplier = 1.0,
  aim?: { focus: number; span: number; bonus?: number },
): number {
  const totalPower = Math.max(0, power * powerMultiplier);
  const decay = SMASH.STACK_DECAY * (1.0 + SMASH.DECAY_POWER_SCALE * (1.0 - powerMultiplier));
  const shock = Math.max(
    SMASH.SHOCK_FLOOR,
    1 - depth * decay,
  );
  // `bonus` is the leftover «переход» bonus: it rides on top of the normal aim
  // band, so it only helps where the player actually aims.
  const focused = aim
    ? aimBonus(depth, aim.span, aim.focus) +
      aimBonus(depth, aim.span, aim.focus, aim.bonus ?? 0)
    : 0;
  const raw =
    ((SMASH.BASE_FLIP + totalPower * SMASH.POWER_TO_FLIP - weight * SMASH.WEIGHT_PENALTY) * shock +
      focused) *
    (0.9 + 0.2 * powerMultiplier);
  return clamp(raw, SMASH.MIN_FLIP, SMASH.MAX_FLIP);
}

/** Roll a bonus chip for the collection (independent of the pot). */
function rollBonus(rareChance: number, rng: Rng): ChipInstance | null {
  if (rng.chance(rareChance)) {
    const pool = [
      ...chipsByRarity('rare'),
      ...chipsByRarity('epic'),
      ...chipsByRarity('legendary'),
    ];
    return { defId: rng.pick(pool).id, faceUp: true };
  }
  if (rng.chance(BONUS_FIND.COMMON_BASE)) {
    const pool = chipsByRarity('common');
    return { defId: rng.pick(pool).id, faceUp: true };
  }
  return null;
}

/* ───────────────────────── special moves ───────────────────────── */

/** Chips a move costs (paid back into the pot). `normal` is free. */
export function moveCost(move: MoveKind): number {
  if (move === 'precise') return MOVES.PRECISE.COST;
  if (move === 'brace') return MOVES.BRACE.COST;
  if (move === 'double') return MOVES.DOUBLE.COST;
  return 0;
}

/** Can this player pay for the move right now? */
export function canUseMove(state: MatchState, index: 0 | 1, move: MoveKind): boolean {
  return move === 'normal' || state.players[index].collected.length >= moveCost(move);
}

/** Everything a turn produces. */
export interface TurnResult {
  /** One report per pass — two for «двойной удар». */
  reports: SmashReport[];
  /** The move actually played (downgraded to `normal` when unaffordable). */
  move: MoveKind;
  /** Chips paid back into the pot for the move. */
  cost: number;
  /** The whole turn flipped nothing → the next player gets the «переход» bonus. */
  missed: boolean;
}

/**
 * One pass over the stack: rolls every chip, forces flips for «точный удар»
 * and clears the flipped chips out of the pot. Does **not** advance the turn,
 * shuffle or pay — `playTurn` owns the turn-level bookkeeping so a multi-hit
 * move stays atomic.
 */
function smashOnce(
  state: MatchState,
  rng: Rng,
  o: {
    powerMultiplier: number;
    focus?: number;
    focusBonus: number;
    minFlips: number;
    weakened: boolean;
    move: MoveKind;
  },
): SmashReport {
  const index = state.current;
  const { power, rareChance } = powerOf(state, index);
  const span = state.stack.length;
  const aim =
    o.focus === undefined ? undefined : { focus: o.focus, span, bonus: o.focusBonus };

  const flipped: ChipInstance[] = [];
  const flippedIndices: number[] = [];
  const survivors: { chip: ChipInstance; depth: number }[] = [];

  state.stack.forEach((chip, depth) => {
    const def: ChipDef = getChip(chip.defId);
    if (rng.chance(flipChance(power, def.weight, depth, o.powerMultiplier, aim))) {
      flipped.push({ defId: chip.defId, faceUp: true });
      flippedIndices.push(depth);
    } else {
      survivors.push({ chip, depth });
    }
  });

  // «Точный удар»: if the roll came up short, force the chips sitting closest
  // to the aim. Deterministic, so the server and every client agree.
  let precise = false;
  if (o.minFlips > 0 && flipped.length < o.minFlips && survivors.length > 0) {
    const need = Math.min(o.minFlips - flipped.length, survivors.length);
    const focus = clamp(o.focus ?? 0.5, 0, 1);
    const forced = survivors
      .map((s, i) => ({ i, d: Math.abs(s.depth / Math.max(1, span - 1) - focus) }))
      .sort((a, b) => a.d - b.d || a.i - b.i)
      .slice(0, need)
      .map((x) => x.i);
    const forcedSet = new Set(forced);
    const kept: { chip: ChipInstance; depth: number }[] = [];
    survivors.forEach((s, i) => {
      if (forcedSet.has(i)) {
        flipped.push({ defId: s.chip.defId, faceUp: true });
        flippedIndices.push(s.depth);
        precise = true;
      } else {
        kept.push(s);
      }
    });
    survivors.length = 0;
    survivors.push(...kept);
  }

  state.players[index].collected.push(...flipped);

  const bonus = rollBonus(rareChance, rng);

  // Survivors keep their order here; `playTurn` shuffles once, at the end.
  state.stack = survivors.map((s) => s.chip);

  const report: SmashReport = {
    playerIndex: index,
    flipped,
    flippedIndices,
    bonus,
    remaining: state.stack.length,
    outcome: flipped.length > 0 ? 'flipped' : 'none',
    move: o.move,
    weakened: o.weakened || undefined,
    precise: precise || undefined,
  };
  state.log.push(report);
  return report;
}

/**
 * Play a full turn: spend the special move, apply «переход»/«отбой» and hand
 * the turn over. Deterministic given the same `rng` seed + call order, which is
 * what makes the balance simulations in `tests/` reproducible.
 */
export function playTurn(state: MatchState, rng: Rng, opts: SmashOptions = {}): TurnResult {
  if (state.status !== 'active') {
    throw new Error('playTurn() called on a finished match');
  }

  const index = state.current;
  const me = state.players[index];

  let move: MoveKind = opts.move ?? 'normal';
  if (!canUseMove(state, index, move)) move = 'normal';

  // «Отбой» aimed at us last turn bites now, then wears off.
  const braced = clamp(me.brace, 0, 0.6);
  me.brace = 0;
  const basePm = opts.powerMultiplier ?? SMASH.POWER_MULT_DEFAULT;
  const pm = clamp(basePm * (1 - braced), SMASH.POWER_MULT_MIN, SMASH.POWER_MULT_MAX);

  // A leftover «переход» bonus is spent on this turn's very first pass.
  const focusBonus = clamp(me.focusBonus, 0, MISS.MAX_BONUS);
  me.focusBonus = 0;

  const hits = move === 'double' ? MOVES.DOUBLE.HITS : 1;
  const reports: SmashReport[] = [];
  for (let hit = 0; hit < hits; hit++) {
    reports.push(
      smashOnce(state, rng, {
        powerMultiplier: pm,
        focus: opts.focus,
        focusBonus: hit === 0 ? focusBonus : 0,
        minFlips: move === 'precise' ? MOVES.PRECISE.MIN_FLIPS : 0,
        weakened: braced > 0,
        move,
      }),
    );
    if (state.stack.length === 0) break;
  }

  const emptied = state.stack.length === 0 || state.turn >= MAX_TURNS;

  // One shuffle per turn. Keeping it *after* every pass lets a renderer replay
  // the reports one by one without re-syncing its column in between.
  state.stack = rng.shuffle(state.stack);

  // Pay for the move: the chips go back to the bottom of the pot, face-down.
  // On the finishing blow the move is free — there is no pot left to pay into.
  let cost = 0;
  if (move !== 'normal' && !emptied) {
    cost = Math.min(moveCost(move), me.collected.length);
    const paid = me.collected.splice(me.collected.length - cost, cost);
    for (const c of paid) state.stack.push({ defId: c.defId, faceUp: false });
  }

  const nextIndex = ((index + 1) % state.players.length) as 0 | 1;
  const nextPlayer = state.players[nextIndex];
  const missed = reports.every((r) => r.flipped.length === 0);

  if (emptied) {
    state.status = 'finished';
  } else {
    // «Переход» — a whiffed turn hands the next player an aim bonus.
    if (missed) {
      nextPlayer.focusBonus = Math.min(MISS.MAX_BONUS, nextPlayer.focusBonus + MISS.BONUS);
    }
    // «Отбой» — the next player smashes weaker.
    if (move === 'brace') {
      nextPlayer.brace = Math.min(0.5, nextPlayer.brace + MOVES.BRACE.WEAKEN);
    }
    state.current = nextIndex;
    state.turn += 1;
  }

  return { reports, move, cost, missed };
}

/**
 * Back-compat single-pass smash. Prefer `playTurn` whenever the move can be
 * «двойной удар» — it returns both reports.
 */
export function smash(state: MatchState, rng: Rng, opts: SmashOptions = {}): SmashReport {
  return playTurn(state, rng, opts).reports[0];
}

/* ───────────────────────── AI ───────────────────────── */

/**
 * Pick the aim the AI should use. Each candidate depth is scored with
 * `expectedFlips` (which already includes the aim band), so a weak AI picks a
 * random spot and a strong one picks a real sweet spot.
 */
export function pickAiFocus(
  state: MatchState,
  index: 0 | 1,
  rng: Rng,
  skill: number = AI.SKILL,
  powerMultiplier: number = SMASH.POWER_MULT_DEFAULT,
): number {
  const jitter = (): number => (rng.next() - 0.5) * AI.AIM_JITTER;
  if (state.stack.length <= 1) return clamp(0.5 + jitter(), 0, 1);
  if (!rng.chance(clamp(skill, 0, 1))) {
    return clamp(0.1 + rng.next() * 0.8 + jitter(), 0, 1);
  }
  const power = powerOf(state, index).power;
  let bestFocus = 0.5;
  let bestEv = -1;
  for (let i = 0; i <= 10; i++) {
    const f = i / 10;
    const ev = expectedFlips(state.stack, power, powerMultiplier, f);
    if (ev > bestEv) {
      bestEv = ev;
      bestFocus = f;
    }
  }
  return clamp(bestFocus + jitter(), 0, 1);
}

/** Power the AI releases the charge at: better AI → closer to the top. */
export function pickAiPower(rng: Rng, skill: number = AI.SKILL): number {
  const s = clamp(skill, 0, 1);
  const t = Math.pow(rng.next(), 1 - 0.6 * s);
  return SMASH.POWER_MULT_MIN + t * (SMASH.POWER_MULT_MAX - SMASH.POWER_MULT_MIN);
}

/** Which special move (if any) the AI decides to spend this turn. */
export function pickAiMove(
  state: MatchState,
  index: 0 | 1,
  rng: Rng,
  chance: number = AI.MOVE_CHANCE,
): MoveKind {
  if (!rng.chance(clamp(chance, 0, 1))) return 'normal';
  const affordable = (['double', 'precise', 'brace'] as MoveKind[]).filter((m) =>
    canUseMove(state, index, m),
  );
  if (affordable.length === 0) return 'normal';
  // Big pot → more hits; thin pot → force the aim; hedge with «отбой» otherwise.
  if (state.stack.length > 12 && affordable.includes('double')) return 'double';
  if (state.stack.length <= 12 && affordable.includes('precise')) return 'precise';
  return rng.pick(affordable);
}

/** Winner index, or null on a tie. Only meaningful when finished. */
export function winner(state: MatchState): 0 | 1 | null {
  const [a, b] = state.players;
  if (a.collected.length === b.collected.length) return null;
  return a.collected.length > b.collected.length ? 0 : 1;
}

/** Net chips for a player: collected minus what they anted. */
export function net(state: MatchState, index: 0 | 1): number {
  return state.players[index].collected.length - state.players[index].anted;
}

/** Expected number of chips flipped by one smash (analytic, for the UI). */
export function expectedFlips(
  stack: readonly ChipInstance[],
  power: number,
  powerMultiplier = 1.0,
  focus?: number,
): number {
  const aim = focus === undefined ? undefined : { focus, span: stack.length };
  return stack.reduce(
    (sum, chip, depth) =>
      sum + flipChance(power, getChip(chip.defId).weight, depth, powerMultiplier, aim),
    0,
  );
}

/** Convenience: is the given rarity considered "premium" for the collection? */
export function isPremium(rarity: Rarity): boolean {
  return rarity !== 'common';
}
