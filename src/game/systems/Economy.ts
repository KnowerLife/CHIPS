import { getBita } from '../data/Bitas';
import { getChip } from '../data/Chips';
import type { PlayerProfile } from '../Types';

/**
 * Pure economy helpers operating on a `PlayerProfile`. No I/O — persistence is
 * handled by `ProfileStore`, so these are trivially unit-testable.
 */

export function addChips(profile: PlayerProfile, amount: number): void {
  if (amount <= 0) return;
  profile.balance += Math.floor(amount);
}

export function canAfford(profile: PlayerProfile, amount: number): boolean {
  return profile.balance >= amount;
}

/** Spend chips atomically; returns false (and changes nothing) if too poor. */
export function spendChips(profile: PlayerProfile, amount: number): boolean {
  if (amount <= 0) return true;
  if (!canAfford(profile, amount)) return false;
  profile.balance -= Math.floor(amount);
  return true;
}

/** Add `count` copies of a chip to the collection. */
export function addChip(profile: PlayerProfile, defId: string, count = 1): void {
  getChip(defId); // validate id
  profile.inventory[defId] = (profile.inventory[defId] ?? 0) + count;
}

/** Remove up to `count` copies; returns how many were actually removed. */
export function removeChip(profile: PlayerProfile, defId: string, count = 1): number {
  const have = profile.inventory[defId] ?? 0;
  const removed = Math.min(have, count);
  const left = have - removed;
  if (left > 0) profile.inventory[defId] = left;
  else delete profile.inventory[defId];
  return removed;
}

/** Total number of chips held (all copies). */
export function totalChips(profile: PlayerProfile): number {
  return Object.values(profile.inventory).reduce((sum, n) => sum + n, 0);
}

/** Number of distinct chip ids held. */
export function uniqueChips(profile: PlayerProfile): number {
  return Object.values(profile.inventory).filter((n) => n > 0).length;
}

export type BuyResult =
  | { ok: true }
  | { ok: false; reason: 'owned' | 'poor' | 'unknown' };

/** Buy a bita from the market. */
export function buyBita(profile: PlayerProfile, bitaId: string): BuyResult {
  let bita;
  try {
    bita = getBita(bitaId);
  } catch {
    return { ok: false, reason: 'unknown' };
  }
  if (profile.ownedBitas.includes(bitaId)) return { ok: false, reason: 'owned' };
  if (!spendChips(profile, bita.price)) return { ok: false, reason: 'poor' };
  profile.ownedBitas.push(bitaId);
  if (!profile.equippedBita) profile.equippedBita = bitaId;
  return { ok: true };
}

/** Equip an owned bita, or pass null to use the bare hand. */
export function equipBita(profile: PlayerProfile, bitaId: string | null): boolean {
  if (bitaId === null) {
    profile.equippedBita = null;
    return true;
  }
  if (!profile.ownedBitas.includes(bitaId)) return false;
  profile.equippedBita = bitaId;
  return true;
}

/** Sell rate: fraction of a chip's collector value paid out in balance. */
export const SELL_RATE = 0.5;

/**
 * Sell `count` copies of a chip for balance. Returns chips actually removed and
 * the balance credited.
 */
export function sellChip(
  profile: PlayerProfile,
  defId: string,
  count = 1,
): { sold: number; credited: number } {
  const def = getChip(defId);
  const sold = removeChip(profile, defId, count);
  const credited = Math.floor(sold * def.value * SELL_RATE);
  addChips(profile, credited);
  return { sold, credited };
}

/** Economy snapshot for the HUD. */
export interface EconomySnapshot {
  balance: number;
  total: number;
  unique: number;
  bitas: number;
}

export function snapshot(profile: PlayerProfile): EconomySnapshot {
  return {
    balance: profile.balance,
    total: totalChips(profile),
    unique: uniqueChips(profile),
    bitas: profile.ownedBitas.length,
  };
}
