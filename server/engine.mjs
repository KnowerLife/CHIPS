/**
 * Authoritative online (2–10 player) match engine — plain ESM, no deps.
 *
 * The browser's 1v1 engine lives in `src/game/systems/MatchEngine.ts`. This is
 * the same smash model (identical constants + RNG) generalised to a ring of N
 * players who ante a stake and smash the stack in turn, each keeping whatever
 * flips. The server is the single source of truth: clients only animate the
 * reports it broadcasts, so the outcome cannot be forged client-side.
 *
 * Rollback/compat: values mirror `server/gamedata.mjs`.
 */

import {
  AIM,
  AI,
  BARE_HAND_POWER,
  BITA_BY_ID,
  BONUS_FIND,
  CHIP_BY_ID,
  CHIP_RARITY,
  COMMON_BONUS_POOL,
  effectiveBita,
  MISS,
  MOVES,
  RARE_BONUS_POOL,
  RARITY_DROP_WEIGHT,
  SEEDS,
  SMASH,
} from './gamedata.mjs';

/** Never let a stuck stack run forever — games are capped by turn count. */
export const MAX_TURNS = 600;

/** Deterministic mulberry32 PRNG — byte-for-byte the same as `src/game/Rng.ts`. */
export class Rng {
  constructor(seed = 0x9e3779b9) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  next() {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  chance(p) {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  pick(arr) {
    if (arr.length === 0) throw new Error('Rng.pick: empty array');
    return arr[this.int(0, arr.length - 1)];
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  weighted(items, weight) {
    const total = items.reduce((sum, it) => sum + Math.max(0, weight(it)), 0);
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (const it of items) {
      roll -= Math.max(0, weight(it));
      if (roll <= 0) return it;
    }
    return items[items.length - 1];
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** The focus band: 1 exactly at the aimed depth, tapering to 0 outside it. */
function focusBand(depth, span, focus) {
  const f = Math.max(0, Math.min(1, focus));
  if (span <= 1) return 1;
  const d = depth / (span - 1);
  const t = 1 - Math.abs(d - f) / AIM.SPREAD;
  return t > 0 ? t * t : 0;
}

/**
 * Extra flip chance from aiming at a spot in the column — mirrors
 * `aimBonus()` in `src/game/systems/MatchEngine.ts`.
 *
 * The band is also reused at a smaller scale for «переход» (a miss hands the
 * next player a bonus *at their aim*), which is why `scale` exists.
 *
 * @param {number} depth
 * @param {number} span
 * @param {number} focus aimed depth in 0…1 (0 = top)
 * @param {number} [scale]
 */
export function aimBonus(depth, span, focus, scale = AIM.BONUS) {
  return scale * focusBand(depth, span, focus);
}

/**
 * @param {number} power
 * @param {number} weight
 * @param {number} depth
 * @param {number} [powerMultiplier]
 * @param {{focus:number, span:number, bonus?:number}} [aim]
 */
export function flipChance(power, weight, depth, powerMultiplier = 1.0, aim) {
  const totalPower = Math.max(0, power * powerMultiplier);
  const decay = SMASH.STACK_DECAY * (1.0 + SMASH.DECAY_POWER_SCALE * (1.0 - powerMultiplier));
  const shock = Math.max(SMASH.SHOCK_FLOOR, 1 - depth * decay);
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

/** Build the pot for an N-player match (each antes `stake`). */
export function buildPot(stake, playerCount, rng) {
  const total = Math.max(1, Math.floor(stake * playerCount));
  const pot = [];
  for (let i = 0; i < total; i++) {
    const seed = rng.weighted(SEEDS, ([, rarity]) => RARITY_DROP_WEIGHT[rarity]);
    pot.push({ defId: seed[0], faceUp: false });
  }
  return rng.shuffle(pot);
}

/** Roll a bonus chip for the collection (independent of the pot). */
export function rollBonus(rareChance, rng) {
  if (rng.chance(rareChance)) {
    return { defId: rng.pick(RARE_BONUS_POOL), faceUp: true };
  }
  if (rng.chance(BONUS_FIND.COMMON_BASE)) {
    return { defId: rng.pick(COMMON_BONUS_POOL), faceUp: true };
  }
  return null;
}

/**
 * @typedef {Object} OnlinePlayerSeed
 * @property {string} id
 * @property {string} name
 * @property {string} [photo]
 * @property {boolean} [isBot]
 * @property {string|null} bitaId
 * @property {number} [bitaLevel] 1…5 forge level (default 1)
 */

/**
 * Create a fresh N-player match.
 * @param {{stake:number, players:OnlinePlayerSeed[], firstPlayerIndex?:number, seed?:number}} cfg
 */
export function createMatch(cfg) {
  const players = cfg.players.map((p) => ({
    id: p.id,
    name: p.name,
    photo: p.photo ?? null,
    isBot: !!p.isBot,
    bitaId: p.bitaId ?? null,
    bitaLevel: Math.max(1, Math.min(5, Math.floor(p.bitaLevel) || 1)),
    collected: [],
    anted: cfg.stake,
    connected: true,
    focusBonus: 0,
    brace: 0,
  }));
  const rng = cfg.rng ?? new Rng(cfg.seed ?? ((Date.now() ^ 0x5f3759df) >>> 0));
  const first =
    typeof cfg.firstPlayerIndex === 'number'
      ? cfg.firstPlayerIndex % players.length
      : rng.int(0, players.length - 1);

  return {
    rng,
    status: 'active',
    seed: cfg.seed ?? null,
    players,
    stack: buildPot(cfg.stake, players.length, rng),
    current: first,
    stake: cfg.stake,
    turn: 1,
    log: [],
  };
}

/** Resolve a player's bita power (including forge level). */
export function powerOf(state, index) {
  const player = state.players[index];
  if (!player.bitaId || !BITA_BY_ID[player.bitaId]) return { power: BARE_HAND_POWER, rareChance: 0 };
  const stats = effectiveBita(BITA_BY_ID[player.bitaId], player.bitaLevel ?? 1);
  return { power: stats.power, rareChance: stats.rareChance };
}

/** Expected flips for the UI preview (deterministic, no RNG consumption). */
export function expectedFlips(stack, power, powerMultiplier = 1.0, focus) {
  const aim = focus === undefined || focus === null ? undefined : { focus, span: stack.length };
  return stack.reduce(
    (sum, chip, depth) =>
      sum + flipChance(power, CHIP_BY_ID[chip.defId].weight, depth, powerMultiplier, aim),
    0,
  );
}

/* ───────────────────────── special moves ───────────────────────── */

/** Chips a move costs (paid back into the pot). `normal` is free. */
export function moveCost(move) {
  if (move === 'precise') return MOVES.PRECISE.COST;
  if (move === 'brace') return MOVES.BRACE.COST;
  if (move === 'double') return MOVES.DOUBLE.COST;
  return 0;
}

/** Can this player pay for the move right now? */
export function canUseMove(state, index, move) {
  return move === 'normal' || state.players[index].collected.length >= moveCost(move);
}

/**
 * One pass over the stack: rolls every chip, forces flips for «точный удар»
 * and clears the flipped chips out of the pot. Turn-level bookkeeping (shuffle,
 * payment, turn advance) lives in `playTurn` so a multi-pass move stays atomic.
 *
 * @param {{powerMultiplier:number, focus?:number, focusBonus:number, minFlips:number, weakened:boolean, move:string}} o
 */
function smashOnce(state, o) {
  const rng = state.rng;
  const index = state.current;
  const { power, rareChance } = powerOf(state, index);
  const span = state.stack.length;
  const aim =
    o.focus === undefined || o.focus === null
      ? undefined
      : { focus: o.focus, span, bonus: o.focusBonus };

  const flipped = [];
  const flippedIndices = [];
  const survivors = [];

  state.stack.forEach((chip, depth) => {
    const weight = CHIP_BY_ID[chip.defId] ? CHIP_BY_ID[chip.defId].weight : 1.0;
    if (rng.chance(flipChance(power, weight, depth, o.powerMultiplier, aim))) {
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
    const focus = clamp(o.focus === undefined || o.focus === null ? 0.5 : o.focus, 0, 1);
    const forced = survivors
      .map((s, i) => ({ i, d: Math.abs(s.depth / Math.max(1, span - 1) - focus) }))
      .sort((a, b) => a.d - b.d || a.i - b.i)
      .slice(0, need)
      .map((x) => x.i);
    const forcedSet = new Set(forced);
    const kept = [];
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

  const report = {
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
 * the turn to the next player in the ring.
 *
 * @param {{powerMultiplier?:number, focus?:number, move?:string}} [opts]
 * @returns {{reports:object[], move:string, cost:number, missed:boolean}}
 */
export function playTurn(state, opts = {}) {
  if (state.status !== 'active') throw new Error('playTurn() on a finished match');

  const index = state.current;
  const me = state.players[index];

  let move = opts.move ?? 'normal';
  if (!canUseMove(state, index, move)) move = 'normal';

  // «Отбой» aimed at us last turn bites now, then wears off.
  const braced = clamp(me.brace || 0, 0, 0.6);
  me.brace = 0;
  const basePm = opts.powerMultiplier ?? SMASH.POWER_MULT_DEFAULT;
  const pm = clamp(basePm * (1 - braced), SMASH.POWER_MULT_MIN, SMASH.POWER_MULT_MAX);

  // A leftover «переход» bonus is spent on this turn's very first pass.
  const focusBonus = clamp(me.focusBonus || 0, 0, MISS.MAX_BONUS);
  me.focusBonus = 0;

  const hits = move === 'double' ? MOVES.DOUBLE.HITS : 1;
  const reports = [];
  for (let hit = 0; hit < hits; hit++) {
    reports.push(
      smashOnce(state, {
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
  state.rng.shuffle(state.stack);

  // Pay for the move: the chips go back to the bottom of the pot, face-down.
  // On the finishing blow the move is free — there is no pot left to pay into.
  let cost = 0;
  if (move !== 'normal' && !emptied) {
    cost = Math.min(moveCost(move), me.collected.length);
    const paid = me.collected.splice(me.collected.length - cost, cost);
    for (const c of paid) state.stack.push({ defId: c.defId, faceUp: false });
  }

  const nextIndex = (index + 1) % state.players.length;
  const nextPlayer = state.players[nextIndex];
  const missed = reports.every((r) => r.flipped.length === 0);

  if (emptied) {
    state.status = 'finished';
  } else {
    // «Переход» — a whiffed turn hands the next player an aim bonus.
    if (missed) {
      nextPlayer.focusBonus = Math.min(MISS.MAX_BONUS, (nextPlayer.focusBonus || 0) + MISS.BONUS);
    }
    // «Отбой» — the next player smashes weaker.
    if (move === 'brace') {
      nextPlayer.brace = Math.min(0.5, (nextPlayer.brace || 0) + MOVES.BRACE.WEAKEN);
    }
    state.current = nextIndex;
    state.turn += 1;
  }

  return { reports, move, cost, missed };
}

/**
 * Perform the current player's smash (single pass). Mutates `state`, returns a
 * report the clients replay. Throws if the match is not active.
 *
 * @param {{powerMultiplier?:number, focus?:number, move?:string}} [opts]
 */
export function smash(state, opts = {}) {
  return playTurn(state, opts).reports[0];
}

/* ───────────────────────── bot brain ───────────────────────── */

/**
 * Pick the aim a bot should use: each candidate depth is scored with
 * `expectedFlips` (which already includes the aim band). A weak bot picks a
 * random spot, a strong one finds a real sweet spot.
 *
 * @param {object} state
 * @param {number} index
 * @param {number} [skill]
 * @param {number} [powerMultiplier]
 */
export function pickAiFocus(state, index, skill = AI.SKILL, powerMultiplier = SMASH.POWER_MULT_DEFAULT) {
  const rng = state.rng;
  const jitter = () => (rng.next() - 0.5) * AI.AIM_JITTER;
  if (state.stack.length <= 1) return clamp(0.5 + jitter(), 0, 1);
  if (!rng.chance(clamp(skill, 0, 1))) return clamp(0.1 + rng.next() * 0.8 + jitter(), 0, 1);

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

/** Power the bot releases the charge at: better bot → closer to the top. */
export function pickAiPower(rng, skill = AI.SKILL) {
  const s = clamp(skill, 0, 1);
  const t = Math.pow(rng.next(), 1 - 0.6 * s);
  return SMASH.POWER_MULT_MIN + t * (SMASH.POWER_MULT_MAX - SMASH.POWER_MULT_MIN);
}

/** Which special move (if any) the bot decides to spend this turn. */
export function pickAiMove(state, index, rng, chance = AI.MOVE_CHANCE) {
  if (!rng.chance(clamp(chance, 0, 1))) return 'normal';
  const affordable = ['double', 'precise', 'brace'].filter((m) => canUseMove(state, index, m));
  if (affordable.length === 0) return 'normal';
  // Big pot → more hits; thin pot → force the aim; hedge with «отбой» otherwise.
  if (state.stack.length > 12 && affordable.includes('double')) return 'double';
  if (state.stack.length <= 12 && affordable.includes('precise')) return 'precise';
  return rng.pick(affordable);
}

/** Indices ranked by chips collected (desc); ties share the same position. */
export function ranking(state) {
  return state.players
    .map((p, i) => ({ i, won: p.collected.length }))
    .sort((a, b) => b.won - a.won || a.i - b.i);
}

/** Winner indices (everyone tied on the top collected count wins nothing extra elsewhere). */
export function winners(state) {
  if (state.players.length === 0) return [];
  const best = Math.max(...state.players.map((p) => p.collected.length));
  return state.players.map((p, i) => (p.collected.length === best ? i : -1)).filter((i) => i >= 0);
}

/** How many distinct/duplicate chips each player ends with (for the results UI). */
export function collectSummary(state) {
  return state.players.map((p) => {
    const byRarity = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (const c of p.collected) {
      const r = CHIP_RARITY[c.defId];
      if (r) byRarity[r] += 1;
    }
    return { id: p.id, name: p.name, won: p.collected.length, anted: p.anted, byRarity };
  });
}
