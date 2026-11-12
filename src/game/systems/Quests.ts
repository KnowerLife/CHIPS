import type { PlayerProfile, QuestProgress } from '../Types';
import {
  DAILY_QUEST_COUNT,
  QUEST_BY_ID,
  QUEST_POOL,
  type QuestDef,
  type QuestKind,
} from '../data/Quests';
import { Rng } from '../Rng';
import { addChips } from './Economy';

/** Local calendar day key, e.g. `2026-11-12`. */
export function questDayKey(now = Date.now()): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** FNV-1a — a tiny deterministic seed from the date string. */
function daySeed(day: string): number {
  let hash = 2166136261;
  for (let i = 0; i < day.length; i++) {
    hash ^= day.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Roll `DAILY_QUEST_COUNT` distinct quests for a day (deterministic). */
export function rollQuestIds(day: string): string[] {
  const rng = new Rng(daySeed(day));
  const pool = QUEST_POOL.slice();
  rng.shuffle(pool);
  return pool.slice(0, Math.min(DAILY_QUEST_COUNT, pool.length)).map((q) => q.id);
}

/** Make sure the profile holds today's slate; rolls it at midnight. */
export function ensureQuests(profile: PlayerProfile, now = Date.now()): QuestProgress[] {
  const day = questDayKey(now);
  if (profile.quests.day === day && profile.quests.items.length > 0) {
    return profile.quests.items;
  }
  profile.quests = {
    day,
    items: rollQuestIds(day).map((id) => ({ id, progress: 0, claimed: false })),
  };
  return profile.quests.items;
}

/** Quest + current progress, ready for the UI. */
export interface QuestView {
  def: QuestDef;
  progress: number;
  target: number;
  complete: boolean;
  claimed: boolean;
}

export function questViews(profile: PlayerProfile, now = Date.now()): QuestView[] {
  const items = ensureQuests(profile, now);
  const views: QuestView[] = [];
  for (const item of items) {
    const def = QUEST_BY_ID[item.id];
    if (!def) continue;
    views.push({
      def,
      progress: Math.min(item.progress, def.target),
      target: def.target,
      complete: item.progress >= def.target,
      claimed: item.claimed,
    });
  }
  return views;
}

/**
 * Advance every quest of `kind`. Amounts are clamped to the target, so a big
 * match cannot overshoot and a repeated call is harmless.
 */
export function questEvent(
  profile: PlayerProfile,
  kind: QuestKind,
  amount = 1,
  now = Date.now(),
): void {
  if (amount <= 0) return;
  for (const item of ensureQuests(profile, now)) {
    const def = QUEST_BY_ID[item.id];
    if (!def || def.kind !== kind || item.claimed) continue;
    item.progress = Math.min(def.target, item.progress + amount);
  }
}

export type ClaimResult =
  | { ok: true; reward: number; def: QuestDef }
  | { ok: false; reason: 'unknown' | 'incomplete' | 'claimed' };

/** Collect a completed quest's reward. */
export function claimQuest(profile: PlayerProfile, id: string, now = Date.now()): ClaimResult {
  const def = QUEST_BY_ID[id];
  if (!def) return { ok: false, reason: 'unknown' };
  const item = ensureQuests(profile, now).find((q) => q.id === id);
  if (!item) return { ok: false, reason: 'unknown' };
  if (item.claimed) return { ok: false, reason: 'claimed' };
  if (item.progress < def.target) return { ok: false, reason: 'incomplete' };
  item.claimed = true;
  addChips(profile, def.reward);
  return { ok: true, reward: def.reward, def };
}

/** Header line for the menu card: `2/3 готово`. */
export function questSummary(profile: PlayerProfile, now = Date.now()): {
  done: number;
  total: number;
  claimable: number;
} {
  const views = questViews(profile, now);
  return {
    done: views.filter((v) => v.complete).length,
    total: views.length,
    claimable: views.filter((v) => v.complete && !v.claimed).length,
  };
}
