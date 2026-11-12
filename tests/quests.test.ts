import { describe, it, expect } from 'vitest';
import { createDefaultProfile } from '../src/game/systems/ProfileStore';
import { claimQuest, ensureQuests, questEvent, questSummary, questViews } from '../src/game/systems/Quests';
import { QUEST_POOL, DAILY_QUEST_COUNT } from '../src/game/data/Quests';

describe('Quests (S4 meta)', () => {
  it('rolls three distinct quests for a day', () => {
    const ids = new Set(ensureQuests(createDefaultProfile(), 1_700_000_000_000).map((q) => q.id));
    expect(ensureQuests(createDefaultProfile(), 1_700_000_000_000).length).toBe(DAILY_QUEST_COUNT);
    expect(ids.size).toBe(DAILY_QUEST_COUNT);
    for (const id of ids) expect(QUEST_POOL.some((q) => q.id === id)).toBe(true);
  });

  it('rolls the same slate for the same day and a new one for the next day', () => {
    const p = createDefaultProfile();
    const first = questViews(p, 1_700_000_000_000);
    const again = questViews(p, 1_700_000_000_000);
    expect(first.map((v) => v.def.id)).toEqual(again.map((v) => v.def.id));
    const next = questViews(p, 1_700_000_000_000 + 48 * 3600 * 1000);
    expect(next.map((v) => v.def.id)).not.toEqual(first.map((v) => v.def.id));
  });

  it('accumulates progress per kind and clamps at the target', () => {
    const p = createDefaultProfile();
    for (const v of questViews(p)) {
      if (v.def.kind === 'flips') questEvent(p, 'flips', v.def.target + 100);
    }
    const flipsQuest = questViews(p).find((v) => v.def.kind === 'flips')!;
    expect(flipsQuest.progress).toBe(flipsQuest.def.target);
    questEvent(p, 'flips', 5);
    expect(questViews(p).find((v) => v.def.kind === 'flips')!.progress).toBe(flipsQuest.def.target);
  });

  it('claims a completed quest exactly once and pays the reward', () => {
    const p = createDefaultProfile();
    const views = questViews(p);
    const target = views[0];
    questEvent(p, target.def.kind, target.def.target);
    const claim = claimQuest(p, target.def.id);
    expect(claim.ok).toBe(true);
    expect(p.balance).toBeGreaterThan(0);
    const claimAgain = claimQuest(p, target.def.id);
    expect(claimAgain.ok).toBe(false);
    if (!claimAgain.ok) expect(claimAgain.reason).toBe('claimed');
    const unknown = claimQuest(p, 'nope');
    if (!unknown.ok) expect(unknown.reason).toBe('unknown');
  });

  it('keeps incomplete quests unclaimable', () => {
    const p = createDefaultProfile();
    const views = questViews(p);
    expect(claimQuest(p, views[0].def.id).ok).toBe(false);
  });

  it('summarises the daily slate', () => {
    const p = createDefaultProfile();
    const s = questSummary(p);
    expect(s.total).toBe(3);
    expect(s.done).toBe(0);
    expect(s.claimable).toBe(0);
    const views = questViews(p);
    const target = views[0];
    questEvent(p, target.def.kind, target.def.target);
    expect(questSummary(p).done).toBe(1);
    expect(questSummary(p).claimable).toBe(1);
  });
});
