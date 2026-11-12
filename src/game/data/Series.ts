import type { ChipDef } from '../Types';
import { CHIPS } from './Chips';

/**
 * Collection series. A series is complete when the player owns at least one
 * copy of every chip in it; the reward is derived from the catalog so the
 * collection can grow without a second hand-maintained price list.
 */
export interface SeriesDef {
  /** Stable id — the series name, e.g. `Chupa Caps`. */
  id: string;
  name: string;
  chips: ChipDef[];
  /** One-time reward in ordinary chips. */
  reward: number;
}

function rewardFor(chips: ChipDef[]): number {
  let reward = 25 * chips.length;
  for (const chip of chips) {
    if (chip.rarity === 'epic') reward += 20;
    else if (chip.rarity === 'legendary') reward += 50;
  }
  return reward;
}

/** All series, in the order they first appear in the catalog. */
export const SERIES: SeriesDef[] = (() => {
  const groups = new Map<string, ChipDef[]>();
  for (const chip of CHIPS) {
    const list = groups.get(chip.series);
    if (list) list.push(chip);
    else groups.set(chip.series, [chip]);
  }
  return [...groups.entries()].map(([name, chips]) => ({
    id: name,
    name,
    chips,
    reward: rewardFor(chips),
  }));
})();

export const SERIES_BY_ID: Record<string, SeriesDef> = Object.fromEntries(
  SERIES.map((s) => [s.id, s]),
);

export function getSeries(id: string): SeriesDef {
  const series = SERIES_BY_ID[id];
  if (!series) throw new Error(`Unknown series id: ${id}`);
  return series;
}
