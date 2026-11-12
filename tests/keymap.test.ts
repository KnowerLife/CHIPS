import { describe, it, expect } from 'vitest';
import { keyActionFor, type KeyAction } from '../src/game/ui/keymap';

describe('keyboard map', () => {
  it('maps the hold/smash key', () => {
    expect(keyActionFor('Space')).toBe('space');
  });

  it('maps arrows to aim nudges', () => {
    const cases: [string, KeyAction][] = [
      ['ArrowUp', 'up'],
      ['ArrowDown', 'down'],
      ['ArrowLeft', 'left'],
      ['ArrowRight', 'right'],
    ];
    for (const [code, action] of cases) expect(keyActionFor(code)).toBe(action);
  });

  it('maps both digit rows to the three special moves', () => {
    expect(keyActionFor('Digit1')).toBe('one');
    expect(keyActionFor('Numpad1')).toBe('one');
    expect(keyActionFor('Digit2')).toBe('two');
    expect(keyActionFor('Numpad2')).toBe('two');
    expect(keyActionFor('Digit3')).toBe('three');
    expect(keyActionFor('Numpad3')).toBe('three');
  });

  it('maps escape and fullscreen', () => {
    expect(keyActionFor('Escape')).toBe('esc');
    expect(keyActionFor('KeyF')).toBe('fullscreen');
  });

  it('ignores unbound keys (incl. text editing shortcuts)', () => {
    for (const code of ['KeyA', 'Enter', 'Tab', 'Backspace', 'F5', '']) {
      expect(keyActionFor(code)).toBeNull();
    }
  });
});
