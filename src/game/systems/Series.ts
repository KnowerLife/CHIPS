import type { ChipDef, PlayerProfile } from '../Types';
import { SERIES, type SeriesDef } from '../data/Series';
import { addChips } from './Economy';

/**
 * Series progress + one-time completion rewards.
 *
 * Rewards are paid automatically the first time every chip of a series is
 * owned. `profile.seriesClaimed` makes the grant idempotent, including across
 * old saves that predate the feature.
 */
export interface SeriesChipProgress {
  def: ChipDef;
  owned: number;
}

export interface SeriesProgress {
  id: string;
  name: string;
  /** Chips owned out of the series total. */
  owned: number;
  total: number;
  complete: boolean;
  claimed: boolean;
  reward: number;
  chips: SeriesChipProgress[];
}

/** Snapshot of every series for the collection UI. */
export function seriesProgress(profile: PlayerProfile): SeriesProgress[] {
  return SERIES.map((series: SeriesDef) => {
    const chips = series.chips.map((def) => ({
      def,
      owned: profile.inventory[def.id] ?? 0,
    }));
    const owned = chips.filter((c) => c.owned > 0).length;
    return {
      id: series.id,
      name: series.name,
      owned,
      total: series.chips.length,
      complete: owned === series.chips.length,
      claimed: profile.seriesClaimed.includes(series.id),
      reward: series.reward,
      chips,
    };
  });
}

/**
 * Pay every newly completed series. Returns the series claimed by this call.
 * Safe to call after any collection change (settlement, wheel, forging…).
 */
export function syncSeries(profile: PlayerProfile): SeriesDef[] {
  const granted: SeriesDef[] = [];
  for (const series of SERIES) {
    if (profile.seriesClaimed.includes(series.id)) continue;
    const complete = series.chips.every((chip) => (profile.inventory[chip.id] ?? 0) > 0);
    if (!complete) continue;
    profile.seriesClaimed.push(series.id);
    addChips(profile, series.reward);
    granted.push(series);
  }
  return granted;
}
