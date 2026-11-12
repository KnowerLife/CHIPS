import { Rng } from './Rng';
import type { PlayerProfile } from './Types';
import { loadProfile, saveProfile, resetProfile } from './systems/ProfileStore';

/**
 * Process-wide session state: the player's profile plus a shared RNG.
 *
 * Kept intentionally tiny and framework-free so scenes can read/write it and
 * tests can construct their own instances.
 */
export class Session {
  profile: PlayerProfile;
  rng: Rng;

  constructor() {
    this.profile = loadProfile();
    this.rng = new Rng((Date.now() ^ 0x5f3759df) >>> 0);
  }

  /** Persist the current profile. */
  save(): void {
    saveProfile(this.profile);
  }

  /** Wipe progress and return to a fresh profile. */
  reset(): void {
    this.profile = resetProfile();
    this.save();
  }
}

export const session = new Session();
