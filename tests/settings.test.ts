import { describe, it, expect } from 'vitest';
import {
  SETTINGS_STORAGE_KEY,
  UI_SIZES,
  cycleUiSize,
  getSettings,
  sanitizeSettings,
  updateSettings,
  type GameSettings,
} from '../src/game/systems/Settings';

const base: GameSettings = { muted: false, reduceMotion: false, uiSize: 'normal', tooltips: true };

describe('Settings', () => {
  it('keeps the base values for an empty / missing record', () => {
    expect(sanitizeSettings(null, base)).toEqual(base);
    expect(sanitizeSettings(undefined, base)).toEqual(base);
    expect(sanitizeSettings({}, base)).toEqual(base);
  });

  it('keeps valid fields and rejects wrong types', () => {
    const parsed = {
      muted: true,
      reduceMotion: 'yes',
      uiSize: 'huge',
      tooltips: 0,
    };
    expect(sanitizeSettings(parsed, base)).toEqual({
      muted: true,
      reduceMotion: base.reduceMotion,
      uiSize: base.uiSize,
      tooltips: base.tooltips,
    });
  });

  it('accepts every declared UI size', () => {
    for (const size of UI_SIZES) {
      expect(sanitizeSettings({ uiSize: size }, base).uiSize).toBe(size);
    }
  });

  it('merges patches and cycles the UI size', () => {
    updateSettings({ ...base });
    const start = getSettings().uiSize;
    const order = [start];
    for (let i = 0; i < UI_SIZES.length; i++) order.push(cycleUiSize());
    // After a full lap we are back where we started.
    expect(order[order.length - 1]).toBe(start);
    for (let i = 0; i < UI_SIZES.length; i++) {
      expect(order[i + 1]).toBe(UI_SIZES[(UI_SIZES.indexOf(order[i]) + 1) % UI_SIZES.length]);
    }
  });

  it('uses a dedicated storage key', () => {
    expect(SETTINGS_STORAGE_KEY).toBe('chips.settings.v1');
  });
});
