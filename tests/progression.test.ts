import { describe, it, expect } from 'vitest';
import { createDefaultProfile } from '../src/game/systems/ProfileStore';
import {
  claimDaily,
  spinWheel,
  checkAchievements,
  settleMatch,
} from '../src/game/systems/Progression';
import { createMatch, smash } from '../src/game/systems/MatchEngine';
import { Rng } from '../src/game/Rng';

describe('Progression', () => {
  it('grants the daily reward and starts a streak', () => {
    const p = createDefaultProfile();
    const before = p.balance;
    const res = claimDaily(p, new Rng(1), 1_000_000_000_000);
    expect(res.ok).toBe(true);
    expect(res.streak).toBe(1);
    expect(p.balance).toBeGreaterThan(before);
  });

  it('blocks a second daily claim within 24h', () => {
    const p = createDefaultProfile();
    const now = 1_000_000_000_000;
    claimDaily(p, new Rng(2), now);
    const res = claimDaily(p, new Rng(2), now + 1000);
    expect(res.ok).toBe(false);
    expect(res.waitMs).toBeGreaterThan(0);
  });

  it('continues the streak within 48h', () => {
    const p = createDefaultProfile();
    const now = 1_000_000_000_000;
    claimDaily(p, new Rng(3), now);
    const res = claimDaily(p, new Rng(3), now + 36 * 3600 * 1000);
    expect(res.ok).toBe(true);
    expect(res.streak).toBe(2);
  });

  it('spins the wheel for a fee', () => {
    const p = createDefaultProfile();
    p.balance = 20;
    const ok = spinWheel(p, new Rng(4));
    expect(ok.ok).toBe(true);
    expect(ok.prize).toBeDefined();
    if (ok.prize && ok.prize.kind === 'chips') {
      expect(p.balance).toBe(20 + ok.prize.amount - 20);
    } else {
      expect(p.balance).toBeLessThan(20);
    }

    p.balance = 5;
    expect(spinWheel(p, new Rng(5)).ok).toBe(false);
  });

  it('grants achievements once', () => {
    const p = createDefaultProfile();
    p.stats.gamesPlayed = 1;
    const first = checkAchievements(p);
    expect(first.some((a) => a.id === 'first_game')).toBe(true);
    expect(checkAchievements(p).some((a) => a.id === 'first_game')).toBe(false);

    p.stats.gamesWon = 1;
    expect(checkAchievements(p).some((a) => a.id === 'first_win')).toBe(true);
  });

  it('settles a finished match', () => {
    const p = createDefaultProfile();
    p.balance = 100;
    const rng = new Rng(123);
    const m = createMatch(
      {
        stake: 5,
        playerName: 'P',
        opponentName: 'O',
        opponentIsAI: true,
        playerBitaId: null,
        firstPlayer: 0,
      },
      rng,
    );
    while (m.status === 'active') smash(m, rng);
    const res = settleMatch(p, m, 0);
    expect(res).toBeDefined();
    expect(p.stats.gamesPlayed).toBe(1);
    expect(p.balance).toBeGreaterThanOrEqual(100);
  });
});
