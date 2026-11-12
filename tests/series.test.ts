import { describe, it, expect } from 'vitest';
import { createDefaultProfile, loadProfile, PROFILE_VERSION, type KVStorage } from '../src/game/systems/ProfileStore';
import { addChip } from '../src/game/systems/Economy';
import { seriesProgress, syncSeries } from '../src/game/systems/Series';
import { SERIES } from '../src/game/data/Series';

describe('Series (S4 meta)', () => {
  it('marks progress per series and derives the reward', () => {
    const p = createDefaultProfile();
    const chupa = SERIES.find((s) => s.id === 'Chupa Caps')!;
    expect(chupa.chips.length).toBeGreaterThan(0);
    for (const chip of chupa.chips) addChip(p, chip.id);

    const progress = seriesProgress(p);
    const chupaProgress = progress.find((s) => s.id === 'Chupa Caps')!;
    expect(chupaProgress.complete).toBe(true);
    expect(chupaProgress.claimed).toBe(false);
    expect(chupaProgress.owned).toBe(chupa.chips.length);
    expect(chupaProgress.reward).toBe(
      chupa.chips.reduce((sum, c) => sum + 25 + (c.rarity === 'epic' ? 20 : c.rarity === 'legendary' ? 50 : 0), 0),
    );
  });

  it('grants the completion reward once and only once', () => {
    const p = createDefaultProfile();
    const series = SERIES[0];
    for (const chip of series.chips) addChip(p, chip.id);
    const granted = syncSeries(p);
    expect(granted.map((s) => s.id)).toContain(series.id);
    const balance = p.balance;
    expect(syncSeries(p)).toHaveLength(0);
    expect(p.balance).toBe(balance);
    expect(p.seriesClaimed).toHaveLength(1);
  });
});

describe('ProfileStore (S4 schema)', () => {
  it('migrates a v1 profile with defaults for the new fields', () => {
    const storage: KVStorage = {
      getItem: () =>
        JSON.stringify({
          version: 1,
          name: 'Старый',
          balance: 55,
          inventory: { chupa_red: 1 },
          ownedBitas: ['bit_plastic'],
          equippedBita: 'bit_plastic',
          achievements: [],
          stats: { gamesPlayed: 3, gamesWon: 1, chipsWon: 9, chipsLost: 4, bitsCollected: 0, dailyStreak: 0, lastDaily: 0, winStreak: 0, bestWinStreak: 0 },
          leaderboard: [],
        }),
      setItem: () => {},
      removeItem: () => {},
    };
    const p = loadProfile(storage);
    expect(p.version).toBe(PROFILE_VERSION);
    expect(p.bitaLevels).toEqual({});
    expect(p.seriesClaimed).toEqual([]);
    expect(p.quests.day).toBe('');
    expect(p.quests.items).toEqual([]);
    expect(p.balance).toBe(55);
  });

  it('creates a fresh default profile', () => {
    const p = createDefaultProfile('Тест');
    expect(p.version).toBe(PROFILE_VERSION);
    expect(p.bitaLevels).toEqual({});
    expect(p.quests.items).toEqual([]);
    expect(p.leaderboard).toEqual([]);
  });
});
