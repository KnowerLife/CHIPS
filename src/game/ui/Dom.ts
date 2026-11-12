import Phaser from 'phaser';
import { FONT_FAMILY } from './Theme';

/**
 * Real DOM `<input>` fields laid over the canvas.
 *
 * Phaser has no native text input, and on mobile (Telegram Mini App) we need the
 * OS keyboard to appear — so table names / passwords / custom stakes use actual
 * DOM inputs. Requires `dom.createContainer: true` in `main.ts`; if DOM support
 * is unavailable the helper returns `null` and callers fall back to sensible
 * defaults.
 */

export interface DomField {
  readonly el: Phaser.GameObjects.DOMElement;
  readonly input: HTMLInputElement;
  value(): string;
  number(): number;
  setValue(v: string): void;
  focus(): void;
  destroy(): void;
}

export interface DomFieldOpts {
  value?: string;
  placeholder?: string;
  /** `text` | `number` | `tel` */
  type?: string;
  maxLength?: number;
  align?: 'left' | 'center' | 'right';
  /** Accent colour for the border (0xRRGGBB). */
  accent?: number;
  fontSize?: number;
}

function css(accent: number): string {
  return [
    'box-sizing:border-box',
    'margin:0',
    'background:#160e38',
    'color:#f6f3ff',
    'border:2px solid #' + accent.toString(16).padStart(6, '0'),
    'border-radius:12px',
    'padding:0 14px',
    'outline:none',
    `font-family:${FONT_FAMILY}`,
    'box-shadow:0 0 14px rgba(111,47,208,0.35) inset',
  ].join(';');
}

export function domField(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: DomFieldOpts = {},
): DomField | null {
  try {
    const input = document.createElement('input');
    input.type = opts.type || 'text';
    if (opts.type === 'number' || opts.type === 'tel') input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = opts.maxLength ?? 40;
    input.placeholder = opts.placeholder ?? '';
    input.value = opts.value ?? '';
    const accent = opts.accent ?? 0x705cc8;
    input.style.cssText = `${css(accent)};width:${w}px;height:${h}px;font-size:${opts.fontSize ?? 18}px;text-align:${
      opts.align ?? 'left'
    }`;

    const el = scene.add.dom(x, y, input).setOrigin(0.5);
    el.setDepth(2100);

    return {
      el,
      input,
      value: () => input.value.trim(),
      number: () => {
        const n = Math.floor(Number(input.value.replace(/[^\d]/g, '')));
        return Number.isFinite(n) ? n : 0;
      },
      setValue: (v: string) => {
        input.value = v;
      },
      focus: () => input.focus(),
      destroy: () => el.destroy(),
    };
  } catch {
    return null;
  }
}

/** True when Phaser's DOM container is available. */
export function domReady(scene: Phaser.Scene): boolean {
  const cfg = scene.game?.config as { dom?: { createContainer?: boolean } } | undefined;
  return !!(cfg?.dom?.createContainer && scene.add.dom);
}
