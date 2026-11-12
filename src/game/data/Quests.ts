/**
 * Daily quest pool.
 *
 * Three distinct quests are rolled from this list each day, seeded by the date
 * (see `systems/Quests.ts`), so a restart never re-rolls them. Adding a quest
 * here is enough — UI and progress tracking are data-driven.
 */

export type QuestKind = 'wins' | 'flips' | 'special' | 'sells' | 'wheel' | 'unique';

export interface QuestDef {
  id: string;
  kind: QuestKind;
  /** Short line shown in the quest list. */
  title: string;
  /** How much progress is needed. */
  target: number;
  /** Reward in ordinary chips. */
  reward: number;
  /** Emoji for the quest card. */
  icon: string;
}

export const QUEST_POOL: QuestDef[] = [
  { id: 'win2', kind: 'wins', title: 'Выиграть 2 партии', target: 2, reward: 60, icon: '🏆' },
  { id: 'flip25', kind: 'flips', title: 'Выбить 25 фишек', target: 25, reward: 50, icon: '🪙' },
  { id: 'special3', kind: 'special', title: 'Сделать 3 спец-удара', target: 3, reward: 45, icon: '⚡' },
  { id: 'sell4', kind: 'sells', title: 'Продать 4 дубликата', target: 4, reward: 30, icon: '♻️' },
  { id: 'spin1', kind: 'wheel', title: 'Крутить колесо фортуны', target: 1, reward: 25, icon: '🎡' },
  { id: 'unique2', kind: 'unique', title: 'Найти 2 новые фишки', target: 2, reward: 55, icon: '✨' },
];

export const QUEST_BY_ID: Record<string, QuestDef> = Object.fromEntries(
  QUEST_POOL.map((q) => [q.id, q]),
);

export function getQuest(id: string): QuestDef | undefined {
  return QUEST_BY_ID[id];
}

/** How many quests are offered per day. */
export const DAILY_QUEST_COUNT = 3;
