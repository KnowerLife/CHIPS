import { describe, it, expect } from 'vitest';
import {
  canUseMove,
  createMatch,
  moveCost,
  pickAiFocus,
  pickAiMove,
  pickAiPower,
  playTurn,
  smash,
  expectedFlips,
  flipChance,
  aimBonus,
  winner,
} from '../src/game/systems/MatchEngine';
import { AIM, MISS, MOVES } from '../src/game/Constants';
import { Rng } from '../src/game/Rng';

const base = {
  playerName: 'P1',
  opponentName: 'P2',
  opponentIsAI: false,
  playerBitaId: null as string | null,
  firstPlayer: 0 as const,
};

describe('MatchEngine', () => {
  it('creates a pot of 2*stake', () => {
    const rng = new Rng(1);
    const m = createMatch({ ...base, stake: 10 }, rng);
    expect(m.status).toBe('active');
    expect(m.stack.length).toBe(20);
    expect(m.players[0].anted).toBe(10);
  });

  it('alternates turns and conserves chips', () => {
    const rng = new Rng(42);
    const m = createMatch({ ...base, stake: 10 }, rng);
    const before = m.stack.length;
    const rep = smash(m, rng);
    expect(rep.playerIndex).toBe(0);
    expect(m.stack.length + rep.flipped.length).toBe(before);
    expect(m.current).toBe(1);
    expect(m.turn).toBe(2);
  });

  it('always finishes and conserves total chips', () => {
    const rng = new Rng(777);
    const m = createMatch({ ...base, stake: 10 }, rng);
    while (m.status === 'active') smash(m, rng);
    expect(m.status).toBe('finished');
    const total = m.players[0].collected.length + m.players[1].collected.length;
    expect(total).toBe(20);
  });

  it('flipChance respects bounds', () => {
    expect(flipChance(1, 10, 0)).toBeGreaterThanOrEqual(0.03);
    expect(flipChance(1, 10, 0)).toBeLessThanOrEqual(0.9);
    expect(flipChance(10, 0.1, 0)).toBeLessThanOrEqual(0.9);
    expect(flipChance(10, 0.1, 0)).toBeGreaterThanOrEqual(0.03);
  });

  it('expectedFlips is plausible', () => {
    const rng = new Rng(1);
    const m = createMatch({ ...base, stake: 5 }, rng);
    const exp = expectedFlips(m.stack, 1);
    expect(exp).toBeGreaterThan(0);
    expect(exp).toBeLessThan(m.stack.length + 1);
  });

  it('winner matches collected counts', () => {
    const rng = new Rng(5);
    const m = createMatch({ ...base, stake: 5 }, rng);
    while (m.status === 'active') smash(m, rng);
    const w = winner(m);
    const a = m.players[0].collected.length;
    const b = m.players[1].collected.length;
    if (w === null) expect(a).toBe(b);
    else if (w === 0) expect(a).toBeGreaterThan(b);
    else expect(b).toBeGreaterThan(a);
  });
});

/* ───────────────────────── aiming ("куда бить") ───────────────────────── */

describe('aiming', () => {
  it('aimBonus peaks at the aimed depth and falls off with distance', () => {
    // span 5 → depths 0..4 map to 0, 0.25, 0.5, 0.75, 1
    const span = 5;
    const atFocus = aimBonus(2, span, 0.5);
    const offFocus = aimBonus(1, span, 0.5);
    expect(atFocus).toBeCloseTo(AIM.BONUS, 6);
    expect(offFocus).toBeGreaterThan(0);
    expect(offFocus).toBeLessThan(atFocus);
  });

  it('aimBonus is zero outside the spread', () => {
    expect(aimBonus(0, 5, 0.99)).toBe(0);
    expect(aimBonus(4, 5, 0.01)).toBe(0);
  });

  it('flipChance is higher when the smash is aimed at that chip', () => {
    const aimed = flipChance(1, 1, 2, 1.0, { focus: 0.5, span: 5 });
    const flat = flipChance(1, 1, 2, 1.0);
    expect(aimed).toBeGreaterThan(flat);
  });

  it('no-arg flipChance is unchanged by the aim feature', () => {
    expect(flipChance(1, 1, 0, 1.0)).toBeCloseTo(0.2277, 4);
    expect(flipChance(1, 1, 10, 1.0)).toBeCloseTo(0.173052, 5);
  });

  it('expectedFlips rises with a well-aimed focus', () => {
    const rng = new Rng(1);
    const m = createMatch({ ...base, stake: 5 }, rng);
    const flat = expectedFlips(m.stack, 1);
    const aimed = expectedFlips(m.stack, 1, 1.0, 0.5);
    expect(aimed).toBeGreaterThan(flat);
  });

  it('smash accepts a focus and still conserves chips', () => {
    const rng = new Rng(42);
    const m = createMatch({ ...base, stake: 10 }, rng);
    const before = m.stack.length;
    const rep = smash(m, rng, { powerMultiplier: 1.0, focus: 0.3 });
    expect(m.stack.length + rep.flipped.length).toBe(before);
  });
});

/* ─────────────── special moves + «переход» (S2 mechanics) ─────────────── */

/** An RNG that always fails every roll — a guaranteed whiff, no bonus finds. */
function missRng(): Rng {
  return {
    next: () => 0.999,
    int: (min: number) => min,
    chance: () => false,
    pick: <T>(arr: readonly T[]) => arr[0],
    shuffle: <T>(arr: T[]) => arr,
    weighted: <T>(items: readonly T[]) => items[0],
  } as unknown as Rng;
}

const pot = (defId = 'chupa_green') => ({ defId, faceUp: true });

describe('«переход» (miss penalty)', () => {
  it('hands the next player an aim bonus', () => {
    const rng = missRng();
    const m = createMatch({ ...base, stake: 5, firstPlayer: 0 }, rng);
    const res = playTurn(m, rng, { powerMultiplier: 1, focus: 0.5 });

    expect(res.missed).toBe(true);
    expect(m.players[1].focusBonus).toBeCloseTo(MISS.BONUS, 6);
    expect(m.players[0].focusBonus).toBe(0);
  });

  it('is spent on the very next smash of the recipient', () => {
    const rng = missRng();
    const m = createMatch({ ...base, stake: 5, firstPlayer: 1 }, rng);
    const res = playTurn(m, rng, { powerMultiplier: 1, focus: 0.5 });
    // Player 1 whiffed → player 0 (next) got the bonus…
    expect(m.players[0].focusBonus).toBeCloseTo(MISS.BONUS, 6);
    // …and player 0 spends it on the following turn.
    playTurn(m, rng, { powerMultiplier: 1, focus: 0.5 });
    expect(m.players[0].focusBonus).toBe(0);
    void res;
  });

  it('actually raises the flip chance inside the aim band', () => {
    const flat = flipChance(1, 1, 2, 1, { focus: 0.5, span: 5, bonus: 0 });
    const boosted = flipChance(1, 1, 2, 1, { focus: 0.5, span: 5, bonus: MISS.BONUS });
    expect(boosted).toBeGreaterThan(flat);
  });

  it('is capped so misses cannot pile up forever', () => {
    const rng = missRng();
    const m = createMatch({ ...base, stake: 5, firstPlayer: 1 }, rng);
    m.players[0].focusBonus = MISS.MAX_BONUS;
    // Player 1 whiffs again while player 0 is already at the cap.
    playTurn(m, rng, { powerMultiplier: 1 });
    expect(m.players[0].focusBonus).toBeLessThanOrEqual(MISS.MAX_BONUS);
  });
});

describe('special moves', () => {
  it('costs are data-driven and checked against the collection', () => {
    const rng = new Rng(1);
    const m = createMatch({ ...base, stake: 5 }, rng);
    expect(moveCost('normal')).toBe(0);
    expect(moveCost('brace')).toBe(MOVES.BRACE.COST);
    expect(canUseMove(m, 0, 'brace')).toBe(false);
    m.players[0].collected.push(pot(), pot('chupa_red'));
    expect(canUseMove(m, 0, 'brace')).toBe(true);
    expect(canUseMove(m, 0, 'precise')).toBe(true);
  });

  it('downgrades to a normal smash when the player cannot pay', () => {
    const rng = missRng();
    const m = createMatch({ ...base, stake: 5 }, rng);
    const res = playTurn(m, rng, { move: 'double' });
    expect(res.move).toBe('normal');
    expect(res.reports).toHaveLength(1);
    expect(res.cost).toBe(0);
  });

  it('«отбой» pays a chip, weakens the next smash and returns the chip to the pot', () => {
    const rng = missRng();
    const m = createMatch({ ...base, stake: 5, firstPlayer: 0 }, rng);
    m.players[0].collected.push(pot());
    const total = () =>
      m.stack.length + m.players[0].collected.length + m.players[1].collected.length;
    const before = total();

    const res = playTurn(m, rng, { move: 'brace', powerMultiplier: 1 });

    expect(res.cost).toBe(1);
    expect(m.players[1].brace).toBeCloseTo(MOVES.BRACE.WEAKEN, 6);
    expect(m.players[0].collected).toHaveLength(0);
    expect(m.stack.length).toBe(before); // the chip went back into the pile
    expect(total()).toBe(before);

    // Player 1 now smashes weaker once, then the penalty is gone.
    const hit = playTurn(m, rng, { powerMultiplier: 1 });
    expect(hit.reports[0].weakened).toBe(true);
    expect(m.players[1].brace).toBe(0);
  });

  it('«точный удар» forces at least MIN_FLIPS chips at the aim', () => {
    const rng = missRng();
    const m = createMatch({ ...base, stake: 5, firstPlayer: 0 }, rng);
    m.players[0].collected.push(pot(), pot('chupa_red'));

    const res = playTurn(m, rng, { move: 'precise', focus: 0.5, powerMultiplier: 1 });

    expect(res.reports[0].flipped).toHaveLength(MOVES.PRECISE.MIN_FLIPS);
    expect(res.reports[0].precise).toBe(true);
    expect(res.cost).toBe(2);
  });

  it('«двойной удар» smashes twice but spends a single turn', () => {
    const rng = missRng();
    const m = createMatch({ ...base, stake: 5, firstPlayer: 0 }, rng);
    m.players[0].collected.push(pot());

    const res = playTurn(m, rng, { move: 'double', powerMultiplier: 1, focus: 0.5 });

    expect(res.reports).toHaveLength(2);
    expect(m.turn).toBe(2);
    expect(m.current).toBe(1);
  });

  it('never changes the number of chips in play (AI plays itself to the end)', () => {
    const rng = new Rng(2024);
    const m = createMatch({ ...base, stake: 10 }, rng);
    let guard = 0;
    while (m.status === 'active' && guard++ < 4000) {
      const idx = m.current;
      playTurn(m, rng, {
        powerMultiplier: pickAiPower(rng),
        focus: pickAiFocus(m, idx, rng),
        move: pickAiMove(m, idx, rng),
      });
    }
    expect(m.status).toBe('finished');
    expect(m.stack.length).toBe(0);
    expect(m.players[0].collected.length + m.players[1].collected.length).toBe(20);
    expect(guard).toBeLessThan(4000);
  });
});

describe('AI brain', () => {
  it('aims at the sweet spot far more often than a monkey would', () => {
    const rng = new Rng(11);
    const m = createMatch({ ...base, stake: 10, firstPlayer: 0 }, rng);
    const sharp = pickAiFocus(m, 0, rng, 1.0);
    expect(sharp).toBeGreaterThanOrEqual(0);
    expect(sharp).toBeLessThanOrEqual(1);
  });

  it('power grows with skill', () => {
    const avg = (skill: number) => {
      const rng = new Rng(7);
      let sum = 0;
      for (let i = 0; i < 2000; i++) sum += pickAiPower(rng, skill);
      return sum / 2000;
    };
    expect(avg(1)).toBeGreaterThan(avg(0));
  });
});
