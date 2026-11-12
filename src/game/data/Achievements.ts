import type { PlayerProfile } from '../Types';

/**
 * Achievements. Each has a predicate evaluated against the profile; the
 * `Progression` system grants the reward once and records the id.
 */
export interface Achievement {
  id: string;
  name: string;
  desc: string;
  /** Reward in ordinary chips. */
  reward: number;
  /** Returns true when the achievement should be granted. */
  check: (p: PlayerProfile) => boolean;
}

function uniqueCount(p: PlayerProfile): number {
  return Object.values(p.inventory).filter((n) => n > 0).length;
}

function totalChips(p: PlayerProfile): number {
  return Object.values(p.inventory).reduce((sum, n) => sum + n, 0);
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_game',
    name: 'Новичок',
    desc: 'Сыграть первую партию',
    reward: 50,
    check: (p) => p.stats.gamesPlayed >= 1,
  },
  {
    id: 'first_win',
    name: 'Первая победа',
    desc: 'Выиграть первую партию',
    reward: 75,
    check: (p) => p.stats.gamesWon >= 1,
  },
  {
    id: 'collector_5',
    name: 'Коллекционер',
    desc: 'Собрать 5 разных фишек',
    reward: 100,
    check: (p) => uniqueCount(p) >= 5,
  },
  {
    id: 'collector_15',
    name: 'Заядлый коллекционер',
    desc: 'Собрать 15 разных фишек',
    reward: 250,
    check: (p) => uniqueCount(p) >= 15,
  },
  {
    id: 'rich',
    name: 'Богач',
    desc: 'Накопить 1000 фишек на балансе',
    reward: 200,
    check: (p) => p.balance >= 1000,
  },
  {
    id: 'hoarder',
    name: 'Барахольщик',
    desc: 'Держать в коллекции 100 фишек',
    reward: 150,
    check: (p) => totalChips(p) >= 100,
  },
  {
    id: 'champion',
    name: 'Чемпион',
    desc: 'Выиграть 10 партий',
    reward: 300,
    check: (p) => p.stats.gamesWon >= 10,
  },
  {
    id: 'streak_5',
    name: 'На волне',
    desc: 'Выиграть 5 партий подряд',
    reward: 200,
    check: (p) => p.stats.bestWinStreak >= 5,
  },
  {
    id: 'armory',
    name: 'Арсенал',
    desc: 'Владеть тремя битами',
    reward: 150,
    check: (p) => p.ownedBitas.length >= 3,
  },
];

export const ACHIEVEMENT_BY_ID: Record<string, Achievement> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);
