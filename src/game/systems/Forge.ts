import { FORGE } from '../Constants';
import { BITAS, clampBitaLevel, getBita } from '../data/Bitas';
import type { BitaDef, PlayerProfile } from '../Types';
import { getChip } from '../data/Chips';

/**
 * Кузница: duplicate chips are the currency for bita crafting and upgrades.
 *
 * A duplicate is every copy beyond the first one (`count - 1`), valued at
 * `ChipDef.value`. Spending always melts the cheapest duplicates first, so a
 * player never loses a legendary copy while a common one is available.
 */

/** Forge points currently available in duplicate chips. */
export function forgePoints(profile: PlayerProfile): number {
  let points = 0;
  for (const [defId, count] of Object.entries(profile.inventory)) {
    const extra = Math.max(0, count - 1);
    if (extra === 0) continue;
    try {
      points += extra * getChip(defId).value;
    } catch {
      /* unknown id in a legacy save — ignore */
    }
  }
  return points;
}

/** Craft price for an unowned bita. */
export function craftCost(bita: BitaDef): number {
  return Math.max(1, Math.ceil(bita.price / FORGE.CRAFT_DIVISOR));
}

/** Upgrade price for `level → level + 1`. */
export function upgradeCost(level: number): number {
  const lv = clampBitaLevel(level);
  return FORGE.LEVEL_BASE_COST + FORGE.LEVEL_STEP * (lv - 1);
}

/** Level of an owned bita (1 when never upgraded). */
export function bitaLevel(profile: PlayerProfile, bitaId: string | null): number {
  if (!bitaId) return 1;
  return clampBitaLevel(profile.bitaLevels[bitaId] ?? 1);
}

/**
 * Melt duplicate chips until at least `points` worth is spent.
 * Returns the number of chips consumed, or null when there are not enough.
 */
export function consumeDuplicates(profile: PlayerProfile, points: number): number | null {
  if (points <= 0) return 0;
  if (forgePoints(profile) < points) return null;

  const candidates = Object.entries(profile.inventory)
    .map(([defId, count]) => {
      const extra = Math.max(0, count - 1);
      const def = extra > 0 ? getChip(defId) : null;
      return { defId, extra, value: def ? def.value : 0 };
    })
    .filter((c) => c.extra > 0)
    .sort((a, b) => a.value - b.value || a.defId.localeCompare(b.defId));

  let banked = 0;
  let consumed = 0;
  for (const c of candidates) {
    if (banked >= points) break;
    for (let i = 0; i < c.extra && banked < points; i++) {
      profile.inventory[c.defId] -= 1;
      if (profile.inventory[c.defId] <= 0) delete profile.inventory[c.defId];
      banked += c.value;
      consumed += 1;
    }
  }
  return banked >= points ? consumed : null;
}

export type ForgeResult =
  | { ok: true; bita: BitaDef; consumed: number }
  | { ok: false; reason: 'unknown' | 'owned' | 'poor' | 'max' | 'not_owned' };

/** Craft an unowned bita from duplicate chips. */
export function craftBita(profile: PlayerProfile, bitaId: string): ForgeResult {
  let bita: BitaDef;
  try {
    bita = getBita(bitaId);
  } catch {
    return { ok: false, reason: 'unknown' };
  }
  if (profile.ownedBitas.includes(bitaId)) return { ok: false, reason: 'owned' };
  const cost = craftCost(bita);
  const consumed = consumeDuplicates(profile, cost);
  if (consumed === null) return { ok: false, reason: 'poor' };
  profile.ownedBitas.push(bitaId);
  profile.bitaLevels[bitaId] = 1;
  if (!profile.equippedBita) profile.equippedBita = bitaId;
  return { ok: true, bita, consumed };
}

/** Upgrade an owned bita by one forge level. */
export function upgradeBita(profile: PlayerProfile, bitaId: string): ForgeResult {
  let bita: BitaDef;
  try {
    bita = getBita(bitaId);
  } catch {
    return { ok: false, reason: 'unknown' };
  }
  if (!profile.ownedBitas.includes(bitaId)) return { ok: false, reason: 'not_owned' };
  const level = bitaLevel(profile, bitaId);
  if (level >= FORGE.MAX_LEVEL) return { ok: false, reason: 'max' };
  const consumed = consumeDuplicates(profile, upgradeCost(level));
  if (consumed === null) return { ok: false, reason: 'poor' };
  profile.bitaLevels[bitaId] = clampBitaLevel(level + 1);
  return { ok: true, bita, consumed };
}

export interface CraftOption {
  bita: BitaDef;
  cost: number;
  affordable: boolean;
}

/** Every bita the player does not own yet, with its crafting price. */
export function craftOptions(profile: PlayerProfile): CraftOption[] {
  const points = forgePoints(profile);
  return BITAS.filter((b) => !profile.ownedBitas.includes(b.id)).map((bita) => {
    const cost = craftCost(bita);
    return { bita, cost, affordable: points >= cost };
  });
}
