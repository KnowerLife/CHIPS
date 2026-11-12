import { PROFILE_STORAGE_KEY, STARTING_BALANCE } from '../Constants';
import type { PlayerProfile } from '../Types';

/** Minimal storage interface so the store is testable under Node. */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Profile schema version — bump when the shape changes and migrate below. */
export const PROFILE_VERSION = 2;

/** A fresh profile for a new player. */
export function createDefaultProfile(name = 'Игрок'): PlayerProfile {
  return {
    version: PROFILE_VERSION,
    name,
    balance: STARTING_BALANCE,
    inventory: {},
    ownedBitas: [],
    bitaLevels: {},
    equippedBita: null,
    achievements: [],
    seriesClaimed: [],
    quests: { day: '', items: [] },
    stats: {
      gamesPlayed: 0,
      gamesWon: 0,
      chipsWon: 0,
      chipsLost: 0,
      bitsCollected: 0,
      dailyStreak: 0,
      lastDaily: 0,
      winStreak: 0,
      bestWinStreak: 0,
    },
    leaderboard: [],
  };
}

/** Resolve a usable storage backend, or null when unavailable (SSR/tests). */
function resolveStorage(explicit?: KVStorage): KVStorage | null {
  if (explicit) return explicit;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* access can throw in privacy modes */
  }
  return null;
}

/** Merge a loaded (possibly partial/older) profile with defaults. */
function reconcile(raw: Partial<PlayerProfile>): PlayerProfile {
  const base = createDefaultProfile();
  const quests = raw.quests && typeof raw.quests === 'object' ? raw.quests : base.quests;
  return {
    ...base,
    ...raw,
    stats: { ...base.stats, ...(raw.stats ?? {}) },
    inventory: { ...(raw.inventory ?? {}) },
    ownedBitas: [...(raw.ownedBitas ?? [])],
    bitaLevels: { ...(raw.bitaLevels ?? {}) },
    achievements: [...(raw.achievements ?? [])],
    seriesClaimed: [...(raw.seriesClaimed ?? [])],
    quests: {
      day: typeof quests.day === 'string' ? quests.day : '',
      items: Array.isArray(quests.items) ? quests.items.filter((q) => q && typeof q.id === 'string') : [],
    },
    leaderboard: [...(raw.leaderboard ?? [])],
    version: PROFILE_VERSION,
  };
}

/** Load the profile, creating a default one when nothing is stored. */
export function loadProfile(storage?: KVStorage): PlayerProfile {
  const store = resolveStorage(storage);
  if (!store) return createDefaultProfile();
  try {
    const raw = store.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return createDefaultProfile();
    return reconcile(JSON.parse(raw) as Partial<PlayerProfile>);
  } catch {
    return createDefaultProfile();
  }
}

/** Persist the profile. Never throws. */
export function saveProfile(profile: PlayerProfile, storage?: KVStorage): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    /* quota / private mode — ignore */
  }
}

/** Wipe the saved profile. */
export function resetProfile(storage?: KVStorage): PlayerProfile {
  const store = resolveStorage(storage);
  store?.removeItem(PROFILE_STORAGE_KEY);
  return createDefaultProfile();
}
