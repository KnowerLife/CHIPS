/**
 * Player-facing settings: sound, motion, UI size and hover tooltips.
 *
 * Stored under their own localStorage key (not inside the profile) so they
 * never take part in save migrations — losing a save must not unmute the game,
 * and a network profile sync must not overwrite a local preference.
 *
 * Readable from Node (tests) — every browser API is guarded.
 */

export type UiSize = 'compact' | 'normal' | 'large';

export interface GameSettings {
  /** Master mute for all synthesised SFX. */
  muted: boolean;
  /** Honour `prefers-reduced-motion`: no shakes, flashes or hit-stops. */
  reduceMotion: boolean;
  /** Portrait canvas size on wide (desktop) screens. */
  uiSize: UiSize;
  /** Show hover tooltips for chips (weight / value / flip chance). */
  tooltips: boolean;
}

export const SETTINGS_STORAGE_KEY = 'chips.settings.v1';

export const UI_SIZES: readonly UiSize[] = ['compact', 'normal', 'large'] as const;

/** The initial value, seeding `reduceMotion` from the OS preference. */
function defaults(): GameSettings {
  let reduceMotion = false;
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
  } catch {
    /* matchMedia can be unavailable / throw in odd embeddings */
  }
  return { muted: false, reduceMotion, uiSize: 'normal', tooltips: true };
}

/** Validate one unknown value as a `UiSize`. */
function asUiSize(value: unknown, fallback: UiSize): UiSize {
  return value === 'compact' || value === 'normal' || value === 'large' ? value : fallback;
}

/**
 * Merge an unknown parsed value with the defaults. Exported for tests: bad
 * localStorage entries must never break the game or leak a wrong type through.
 */
export function sanitizeSettings(
  parsed: Partial<Record<keyof GameSettings, unknown>> | null | undefined,
  base: GameSettings = defaults(),
): GameSettings {
  const p = parsed ?? {};
  return {
    muted: typeof p.muted === 'boolean' ? p.muted : base.muted,
    reduceMotion: typeof p.reduceMotion === 'boolean' ? p.reduceMotion : base.reduceMotion,
    uiSize: asUiSize(p.uiSize, base.uiSize),
    tooltips: typeof p.tooltips === 'boolean' ? p.tooltips : base.tooltips,
  };
}

function read(): GameSettings {
  const base = defaults();
  try {
    if (typeof localStorage === 'undefined') return base;
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<keyof GameSettings, unknown>>;
    return sanitizeSettings(parsed, base);
  } catch {
    return base;
  }
}

let current: GameSettings = read();

/** Reflect settings that CSS/HTML need (currently the desktop UI size). */
export function applySettings(s: GameSettings = current): void {
  try {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.uiSize = s.uiSize;
    // Phaser's ScaleManager listens to `window.resize`; the canvas size is
    // driven by CSS, so nudge it after the new `data-ui-size` has been laid
    // out. Guarded for non-browser embeds.
    if (typeof window !== 'undefined') {
      const notify = (): void => {
        window.dispatchEvent(new Event('resize'));
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(notify));
      else notify();
    }
  } catch {
    /* non-DOM embedding */
  }
}

/** The live settings object. Treat as read-only; use `updateSettings`. */
export function getSettings(): GameSettings {
  return current;
}

/** Merge a patch, persist it and return the new settings. Never throws. */
export function updateSettings(patch: Partial<GameSettings>): GameSettings {
  current = sanitizeSettings({ ...current, ...patch }, current);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(current));
    }
  } catch {
    /* quota / private mode — keep the in-memory value */
  }
  applySettings(current);
  return current;
}

/** Flip the master mute and persist it. Returns true when now muted. */
export function toggleMuted(): boolean {
  return updateSettings({ muted: !current.muted }).muted;
}

/** Cycle the desktop portrait size and persist it. */
export function cycleUiSize(): UiSize {
  const at = UI_SIZES.indexOf(current.uiSize);
  const next = UI_SIZES[(at + 1) % UI_SIZES.length];
  return updateSettings({ uiSize: next }).uiSize;
}

/** Apply the persisted size at boot. */
applySettings(current);

/** Test/teardown hook: re-read from storage. */
export function reloadSettings(): GameSettings {
  current = read();
  applySettings(current);
  return current;
}
