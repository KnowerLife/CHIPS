import Phaser from 'phaser';
import { keyActionFor, type KeyAction } from './keymap';

export { keyActionFor, type KeyAction } from './keymap';

/**
 * Desktop keyboard bindings shared by the match scenes.
 *
 * `Space` is press-and-hold (charge) + release (smash); arrows nudge the aim;
 * `1…3` arm a special move; `Esc` backs out. The helper keeps the mapping in
 * one place so the single-player match, the online table and any future scene
 * behave identically.
 */

export interface KeyHandlers {
  /** A key went down. `event.repeat` is true for auto-repeat. */
  down(action: KeyAction, event: KeyboardEvent): void;
  /** A key went up (only ever fired for keys that were bound). */
  up?(action: KeyAction, event: KeyboardEvent): void;
}

/**
 * Capture the desktop keys on a scene. Returns an unbind function; call it from
 * the scene's `SHUTDOWN` hook.
 */
export function bindKeys(scene: Phaser.Scene, handlers: KeyHandlers): () => void {
  const kb = scene.input.keyboard;
  if (!kb) return () => {};

  const onDown = (event: KeyboardEvent): void => {
    const action = keyActionFor(event.code);
    if (!action) return;
    // Space/arrows would scroll or trigger browser shortcuts without this.
    event.preventDefault();
    handlers.down(action, event);
  };
  const onUp = (event: KeyboardEvent): void => {
    const action = keyActionFor(event.code);
    if (!action || !handlers.up) return;
    event.preventDefault();
    handlers.up(action, event);
  };

  kb.on('keydown', onDown);
  kb.on('keyup', onUp);
  kb.addCapture([
    Phaser.Input.Keyboard.KeyCodes.SPACE,
    Phaser.Input.Keyboard.KeyCodes.UP,
    Phaser.Input.Keyboard.KeyCodes.DOWN,
    Phaser.Input.Keyboard.KeyCodes.LEFT,
    Phaser.Input.Keyboard.KeyCodes.RIGHT,
    Phaser.Input.Keyboard.KeyCodes.ONE,
    Phaser.Input.Keyboard.KeyCodes.TWO,
    Phaser.Input.Keyboard.KeyCodes.THREE,
    Phaser.Input.Keyboard.KeyCodes.ESC,
    Phaser.Input.Keyboard.KeyCodes.F,
  ]);

  return () => {
    kb.off('keydown', onDown);
    kb.off('keyup', onUp);
  };
}
