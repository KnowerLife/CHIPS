/**
 * Pure keyboard mapping shared by desktop scenes.
 *
 * Kept free of Phaser so it can be unit-tested under Node (Phaser touches
 * `window` on import).
 */

export type KeyAction =
  | 'space'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'one'
  | 'two'
  | 'three'
  | 'esc'
  | 'fullscreen';

/** Map a `KeyboardEvent.code` to a game action (null when unbound). */
export function keyActionFor(code: string): KeyAction | null {
  switch (code) {
    case 'Space':
      return 'space';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Digit1':
    case 'Numpad1':
      return 'one';
    case 'Digit2':
    case 'Numpad2':
      return 'two';
    case 'Digit3':
    case 'Numpad3':
      return 'three';
    case 'Escape':
      return 'esc';
    case 'KeyF':
      return 'fullscreen';
    default:
      return null;
  }
}
