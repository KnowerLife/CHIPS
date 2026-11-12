import Phaser from 'phaser';
import { MOVES } from '../Constants';
import type { MoveKind } from '../Types';
import { COLORS, FONT_FAMILY, darken, heatColor, lighten } from './Theme';
import { audio } from './Audio';

/* ───────────────────────── buttons ───────────────────────── */

export type ButtonVariant = 'gold' | 'success' | 'danger' | 'cyan' | 'magenta' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonOptions {
  width?: number;
  height?: number;
  /** Explicit base colour; overrides `variant`. */
  fill?: number;
  variant?: ButtonVariant;
  size?: ButtonSize;
  textColor?: string;
  fontSize?: number;
  radius?: number;
  disabled?: boolean;
  /** Soft outer glow behind the button. */
  glow?: boolean;
}

const VARIANT_FILL: Record<ButtonVariant, number> = {
  gold: COLORS.goldDeep,
  success: COLORS.emeraldDeep,
  danger: COLORS.redDeep,
  cyan: COLORS.cyanDeep,
  magenta: COLORS.magentaDeep,
  ghost: COLORS.panelAlt,
};

const SIZE_H: Record<ButtonSize, number> = { sm: 40, md: 54, lg: 68 };
const SIZE_FONT: Record<ButtonSize, number> = { sm: 13, md: 17, lg: 22 };

/**
 * Minimum touch/click target per platform guidance (Apple HIG / Material / our
 * design-review pass): interactive controls never smaller than 44px — anything
 * rendered smaller is bumped so the whole contour stays tappable.
 */
const MIN_TOUCH_TARGET = 44;

/**
 * A glossy, tactile casino button: gradient body, 3D bottom edge, top gloss,
 * glow, hover brighten and a springy press. Returns a Container.
 */
export class Button extends Phaser.GameObjects.Container {
  readonly label: Phaser.GameObjects.Text;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly btnWidth: number;
  private readonly btnHeight: number;
  private readonly radius: number;
  private readonly baseFill: number;
  private readonly hasGlow: boolean;
  private disabled = false;
  private pressed = false;
  private hovered = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    onClick: () => void,
    opts: ButtonOptions = {},
  ) {
    super(scene, x, y);

    const size = opts.size ?? 'md';
    this.btnWidth = opts.width ?? 220;
    this.btnHeight = Math.max(opts.height ?? SIZE_H[size], MIN_TOUCH_TARGET);
    this.radius = opts.radius ?? Math.min(18, this.btnHeight / 2.6);
    this.baseFill = opts.fill ?? VARIANT_FILL[opts.variant ?? 'ghost'];
    this.hasGlow = opts.glow ?? (opts.variant ?? 'ghost') !== 'ghost';

    this.bg = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, text, {
        fontFamily: FONT_FAMILY,
        fontSize: `${opts.fontSize ?? SIZE_FONT[size]}px`,
        color: opts.textColor ?? COLORS.text,
        align: 'center',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.label.setShadow(0, 2, '#00000099', 3);

    this.add([this.bg, this.label]);
    this.redraw();
    this.setSize(this.btnWidth, this.btnHeight);
    this.setInteractive(
      new Phaser.Geom.Rectangle(-this.btnWidth / 2, -this.btnHeight / 2, this.btnWidth, this.btnHeight),
      Phaser.Geom.Rectangle.Contains,
    );
    if (this.input) this.input.cursor = 'pointer';

    if (opts.disabled) {
      this.setDisabled();
    } else {
      this.on('pointerover', () => {
        this.hovered = true;
        this.redraw();
      });
      this.on('pointerout', () => {
        this.hovered = false;
        this.pressed = false;
        this.setScale(1);
        this.redraw();
      });
      this.on('pointerdown', () => {
        this.pressed = true;
        this.setScale(0.96);
        this.redraw();
        audio.click();
      });
      this.on('pointerup', () => {
        if (!this.pressed) return;
        this.pressed = false;
        this.setScale(1);
        this.redraw();
        onClick();
      });
    }

    scene.add.existing(this);
  }

  private redraw(): void {
    const g = this.bg;
    const w = this.btnWidth;
    const h = this.btnHeight;
    const r = this.radius;
    const x = -w / 2;
    const y = -h / 2;

    let fill = this.baseFill;
    if (this.disabled) fill = COLORS.panel;
    else if (this.hovered) fill = lighten(fill, 0.1);
    if (this.pressed) fill = darken(fill, 0.1);

    g.clear();

    // Soft outer glow (modern, restrained).
    if (this.hasGlow && !this.disabled) {
      g.fillStyle(fill, 0.18);
      g.fillRoundedRect(x - 5, y - 2, w + 10, h + 8, r + 6);
    }

    // Subtle depth shadow.
    g.fillStyle(0x000000, 0.28);
    g.fillRoundedRect(x, y + 4, w, h, r);

    // Body gradient (cleaner, more modern).
    g.fillGradientStyle(lighten(fill, 0.22), lighten(fill, 0.08), darken(fill, 0.08), darken(fill, 0.22), 1);
    g.fillRoundedRect(x, y, w, h, r);

    // Top highlight.
    g.fillStyle(0xffffff, this.disabled ? 0.04 : 0.12);
    g.fillRoundedRect(x + 3, y + 3, w - 6, h * 0.38, Math.max(6, r - 3));

    // Inner rim.
    g.lineStyle(1.5, this.disabled ? COLORS.stroke : lighten(fill, 0.45), 0.75);
    g.strokeRoundedRect(x + 1, y + 1, w - 2, h - 2, Math.max(4, r - 1));

    // Outer rim.
    g.lineStyle(1.5, this.disabled ? COLORS.stroke : lighten(fill, 0.6), 0.95);
    g.strokeRoundedRect(x, y, w, h, r);

    this.label.setY(this.pressed ? 1 : 0);
  }

  setText(text: string): this {
    this.label.setText(text);
    return this;
  }

  setFill(fill: number): this {
    (this as unknown as { baseFill: number }).baseFill = fill;
    this.redraw();
    return this;
  }

  setDisabled(): this {
    this.disabled = true;
    this.disableInteractive();
    this.setAlpha(0.85);
    this.label.setColor(COLORS.dim);
    this.redraw();
    return this;
  }

  setEnabled(): this {
    this.disabled = false;
    this.setAlpha(1);
    this.label.setColor(COLORS.text);
    this.setInteractive(
      new Phaser.Geom.Rectangle(-this.btnWidth / 2, -this.btnHeight / 2, this.btnWidth, this.btnHeight),
      Phaser.Geom.Rectangle.Contains,
    );
    this.input!.cursor = 'pointer';
    this.redraw();
    return this;
  }

  /** Endless attention pulse (primary CTA). */
  pulse(): this {
    this.scene.tweens.add({
      targets: this,
      scaleX: { from: 1, to: 1.035 },
      scaleY: { from: 1, to: 1.05 },
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    return this;
  }
}

/* ───────────────────────── hold pads ───────────────────────── */

export interface HoldPadOptions {
  width?: number;
  height?: number;
  radius?: number;
  variant?: ButtonVariant;
  /** Explicit base colour; overrides `variant`. */
  fill?: number;
  fontSize?: number;
  textColor?: string;
  glow?: boolean;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * A glossy "press-and-hold" pad with a live charge fill.
 *
 * Unlike `Button`, it never *fires* on a tap: the owning scene owns the global
 * pointer stream (`pointerdown`/`pointerup`/`pointermove`) and pushes the sweep
 * here with `setProgress()`. That makes the same control work for mouse *and*
 * touch — the core of the "hold to wind up, release to hit" smash.
 */
export class HoldPad extends Phaser.GameObjects.Container {
  readonly label: Phaser.GameObjects.Text;
  readonly hint: Phaser.GameObjects.Text;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly padWidth: number;
  private readonly padHeight: number;
  private readonly padRadius: number;
  private readonly baseFill: number;
  private readonly hasGlow: boolean;
  private progress = 0;
  private charged = false;
  private enabled = true;

  constructor(scene: Phaser.Scene, x: number, y: number, text: string, opts: HoldPadOptions = {}) {
    super(scene, x, y);
    this.padWidth = opts.width ?? 340;
    this.padHeight = opts.height ?? 74;
    this.padRadius = opts.radius ?? 20;
    this.baseFill = opts.fill ?? VARIANT_FILL[opts.variant ?? 'danger'];
    this.hasGlow = opts.glow ?? true;

    this.bg = scene.add.graphics();
    this.label = scene.add
      .text(0, -10, text, {
        fontFamily: FONT_FAMILY,
        fontSize: `${opts.fontSize ?? 23}px`,
        color: opts.textColor ?? COLORS.text,
        align: 'center',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.label.setShadow(0, 2, '#00000099', 3);
    this.hint = scene.add
      .text(0, 17, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        color: COLORS.dim,
        align: 'center',
      })
      .setOrigin(0.5);

    this.add([this.bg, this.label, this.hint]);
    this.redraw();
    scene.add.existing(this);
  }

  /** Charge in `0…1`; `charging` lights the fill when the pad is being held. */
  setProgress(t: number, charging = true): this {
    this.progress = clamp01(t);
    this.charged = charging;
    this.redraw();
    return this;
  }

  setText(text: string): this {
    this.label.setText(text);
    return this;
  }

  setHint(text: string): this {
    this.hint.setText(text);
    return this;
  }

  setPadEnabled(on: boolean): this {
    this.enabled = on;
    this.setAlpha(on ? 1 : 0.62);
    this.redraw();
    return this;
  }

  private redraw(): void {
    const g = this.bg;
    const w = this.padWidth;
    const h = this.padHeight;
    const r = this.padRadius;
    const x = -w / 2;
    const y = -h / 2;
    const fill = this.enabled ? this.baseFill : COLORS.panel;
    const heat = heatColor(this.progress);

    g.clear();

    if (this.hasGlow && this.enabled) {
      g.fillStyle(this.charged ? heat : fill, 0.2);
      g.fillRoundedRect(x - 6, y - 2, w + 12, h + 10, r + 6);
    }

    // Subtle depth shadow.
    g.fillStyle(0x000000, 0.3);
    g.fillRoundedRect(x, y + 4, w, h, r);

    // Body gradient.
    g.fillGradientStyle(lighten(fill, 0.22), lighten(fill, 0.08), darken(fill, 0.08), darken(fill, 0.22), 1);
    g.fillRoundedRect(x, y, w, h, r);

    // Live charge fill (sweeps with the held power).
    if (this.enabled && this.progress > 0.001) {
      const cw = Math.max(w * this.progress, 12);
      g.fillStyle(heat, this.charged ? 0.92 : 0.5);
      g.fillRoundedRect(x, y, cw, h, r);
      g.fillStyle(0xffffff, 0.12);
      g.fillRoundedRect(x + 3, y + 3, Math.max(cw - 6, 6), h * 0.36, Math.max(6, r - 3));
    }

    // Top highlight.
    g.fillStyle(0xffffff, this.enabled ? 0.11 : 0.04);
    g.fillRoundedRect(x + 3, y + 3, w - 6, h * 0.36, Math.max(6, r - 3));

    // Rims.
    g.lineStyle(1.5, this.enabled ? lighten(fill, 0.45) : COLORS.stroke, 0.75);
    g.strokeRoundedRect(x + 1, y + 1, w - 2, h - 2, Math.max(4, r - 1));
    g.lineStyle(1.5, this.enabled ? lighten(fill, 0.6) : COLORS.stroke, 0.95);
    g.strokeRoundedRect(x, y, w, h, r);
  }
}

/* ───────────────────────── panels ───────────────────────── */

export interface PanelOptions {
  fill?: number;
  radius?: number;
  glow?: number;
  rim?: number;
  rimAlpha?: number;
  /** Draw an inner top highlight (glass look). */
  glass?: boolean;
}

/** A glassy rounded panel with an optional lit rim and glow. */
export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number = COLORS.panel,
  radius = 18,
  opts: PanelOptions = {},
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const gx = x - w / 2;
  const gy = y - h / 2;

  if (opts.glow !== undefined) {
    g.fillStyle(opts.glow, 0.16);
    g.fillRoundedRect(gx - 6, gy - 4, w + 12, h + 12, radius + 6);
  }

  // Subtle drop shadow for depth.
  g.fillStyle(0x000000, 0.22);
  g.fillRoundedRect(gx, gy + 5, w, h, radius);

  g.fillGradientStyle(lighten(fill, 0.08), fill, darken(fill, 0.12), darken(fill, 0.18), 1);
  g.fillRoundedRect(gx, gy, w, h, radius);

  if (opts.glass !== false) {
    g.fillStyle(0xffffff, 0.045);
    g.fillRoundedRect(gx + 3, gy + 3, w - 6, h * 0.38, Math.max(6, radius - 4));
  }

  g.lineStyle(1.5, opts.rim ?? COLORS.strokeHi, opts.rimAlpha ?? 0.55);
  g.strokeRoundedRect(gx, gy, w, h, radius);
  g.lineStyle(1, lighten(fill, 0.25), 0.22);
  g.strokeRoundedRect(gx + 1, gy + 1, w - 2, h - 2, Math.max(4, radius - 1));
  return g;
}

/* ───────────────────────── labels ───────────────────────── */

/** A text label with project defaults. */
export function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size = 16,
  color: string = COLORS.text,
  origin = 0.5,
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, { fontFamily: FONT_FAMILY, fontSize: `${size}px`, color })
    .setOrigin(origin);
}

/** A bold heading label with a soft shadow. */
export function heading(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size = 26,
  color: string = COLORS.goldText,
): Phaser.GameObjects.Text {
  const t = scene.add
    .text(x, y, text, {
      fontFamily: FONT_FAMILY,
      fontSize: `${size}px`,
      color,
      fontStyle: 'bold',
    })
    .setOrigin(0.5);
  t.setShadow(0, 3, '#000000aa', 6);
  return t;
}

/* ───────────────────────── modal + toast ───────────────────────── */

export interface Modal {
  root: Phaser.GameObjects.Container;
  close: () => void;
}

/**
 * A centered modal with a dimmed, interactive backdrop and a glassy frame.
 * Everything added to `root` is positioned relative to the panel centre.
 */
export function modal(
  scene: Phaser.Scene,
  title: string,
  opts: { width?: number; height?: number; onClose?: () => void } = {},
): Modal {
  const W = scene.scale.width;
  const H = scene.scale.height;
  const mw = opts.width ?? W - 56;
  const mh = opts.height ?? 460;

  const backdrop = scene.add
    .rectangle(W / 2, H / 2, W, H, 0x05030f, 0.78)
    .setInteractive()
    .setDepth(2000);

  const root = scene.add.container(W / 2, H / 2).setDepth(2010);
  const frame = panel(scene, 0, 0, mw, mh, COLORS.panel, 24, {
    glow: COLORS.violetDeep,
    rim: COLORS.strokeGold,
    rimAlpha: 0.5,
  });
  root.add(frame);
  const t = heading(scene, 0, -mh / 2 + 34, title, 20, COLORS.goldText);
  t.setWordWrapWidth(mw - 48, false);
  if (t.width > mw - 48) t.setFontSize(17);
  root.add(t);

  const close = (): void => {
    if (!root.active) return;
    audio.close();
    root.destroy(true);
    backdrop.destroy();
    opts.onClose?.();
  };
  backdrop.on('pointerdown', close);

  // Pop-in.
  root.setScale(0.85);
  root.setAlpha(0);
  scene.tweens.add({ targets: root, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
  audio.open();

  return { root, close };
}

/* ───────────────────────── special moves ───────────────────────── */

/** The three special moves, in display order. */
const MOVE_DEFS: { move: MoveKind; label: string; cost: number }[] = [
  { move: 'precise', label: '🎯 Точный', cost: MOVES.PRECISE.COST },
  { move: 'brace', label: '🛡 Отбой', cost: MOVES.BRACE.COST },
  { move: 'double', label: '⚡ Двойной', cost: MOVES.DOUBLE.COST },
];

export interface MoveBarOptions {
  /** Width of a single pill. */
  width?: number;
  height?: number;
  /** Horizontal gap between pills. */
  gap?: number;
  /** Called when the player arms (or disarms) a move. */
  onPick?: (move: MoveKind) => void;
  /** Called when the player taps a move they cannot afford. */
  onDenied?: (move: MoveKind) => void;
}

/**
 * The special-move picker («спец-удары»): three pills that sit above the smash
 * pad. Tapping arms a move for the *next* smash; tapping it again disarms it.
 *
 * Moves the player cannot afford stay clickable but dimmed, so the scene can
 * explain *why* nothing happened instead of silently swallowing the tap.
 */
export class MoveBar extends Phaser.GameObjects.Container {
  private readonly pills: { move: MoveKind; cost: number; btn: Button }[] = [];
  private chosen: MoveKind = 'normal';
  private chips = 0;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly opts: MoveBarOptions = {},
  ) {
    super(scene, x, y);

    const width = opts.width ?? 130;
    const height = opts.height ?? 34;
    const gap = opts.gap ?? 15;
    const step = width + gap;
    const left = -((MOVE_DEFS.length - 1) * step) / 2;

    MOVE_DEFS.forEach((def, i) => {
      const btn = new Button(
        scene,
        left + i * step,
        0,
        `${def.label} ${def.cost}🪙`,
        () => this.toggle(def.move),
        { width, height, variant: 'ghost', fontSize: 12, radius: 12 },
      );
      this.pills.push({ move: def.move, cost: def.cost, btn });
      this.add(btn);
    });

    scene.add.existing(this);
    this.setAffordable(0);
  }

  /** Tell the bar how many chips the current player has flipped so far. */
  setAffordable(chips: number): void {
    this.chips = Math.max(0, chips);
    for (const p of this.pills) {
      const ok = this.chips >= p.cost;
      p.btn.setAlpha(ok ? 1 : 0.42);
      p.btn.label.setColor(ok ? COLORS.text : COLORS.dim);
    }
    if (this.chosen !== 'normal' && !this.canAfford(this.chosen)) this.chosen = 'normal';
    this.redraw();
  }

  /** The move armed for the next smash (`normal` = no move). */
  get picked(): MoveKind {
    return this.chosen;
  }

  /** Disable the whole picker (e.g. while it is not the player's turn). */
  setEnabled(enabled: boolean): void {
    for (const p of this.pills) {
      if (enabled) p.btn.setEnabled();
      else p.btn.setDisabled();
    }
    if (enabled) this.setAffordable(this.chips);
  }

  /** Disarm (called after a turn has been played). */
  clear(): void {
    this.chosen = 'normal';
    this.redraw();
  }

  /** Arm one move programmatically (used by the AI). */
  select(move: MoveKind): void {
    this.chosen = this.canAfford(move) ? move : 'normal';
    this.redraw();
  }

  /**
   * Player-facing programmatic pick (keyboard `1…3`). Unlike `select`, it
   * reports denial and fires `onPick`, exactly like tapping the pill.
   */
  choose(move: MoveKind): void {
    this.toggle(move);
  }

  private canAfford(move: MoveKind): boolean {
    const pill = this.pills.find((p) => p.move === move);
    return !!pill && this.chips >= pill.cost;
  }

  private toggle(move: MoveKind): void {
    if (!this.canAfford(move)) {
      audio.error();
      this.opts.onDenied?.(move);
      return;
    }
    this.chosen = this.chosen === move ? 'normal' : move;
    this.redraw();
    this.opts.onPick?.(this.chosen);
  }

  private redraw(): void {
    for (const p of this.pills) {
      const armed = p.move === this.chosen;
      p.btn.setFill(armed ? COLORS.goldDeep : COLORS.panelAlt);
      p.btn.label.setColor(armed ? '#2a1a00' : COLORS.text);
    }
  }
}

/**
 * Bottom pill toast. Returns the container so callers may replace it.
 * `y` is the vertical centre (defaults to just above the controls); a scene can
 * raise it with `raise` when its own controls live at the very bottom.
 */
export function toast(
  scene: Phaser.Scene,
  message: string,
  color: number = COLORS.goldDeep,
  y: number = scene.scale.height - 118,
): Phaser.GameObjects.Container {
  const W = scene.scale.width;
  const c = scene.add.container(W / 2, y).setDepth(2500);
  const w = Math.min(W - 32, message.length * 9.5 + 60);
  const h = 46;
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.45);
  g.fillRoundedRect(-w / 2 - 3, -h / 2 + 3, w + 6, h, h / 2);
  g.fillGradientStyle(lighten(color, 0.08), color, darken(color, 0.12), darken(color, 0.2), 1);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  g.fillStyle(0xffffff, 0.1);
  g.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h * 0.34, h / 2);
  g.lineStyle(1.5, lighten(color, 0.5), 0.9);
  g.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  const t = scene.add
    .text(0, 0, message, {
      fontFamily: FONT_FAMILY,
      fontSize: '14px',
      color: '#ffffff',
      align: 'center',
      fontStyle: 'bold',
      wordWrap: { width: w - 28 },
    })
    .setOrigin(0.5);
  t.setShadow(0, 2, '#00000088', 3);
  c.add([g, t]);
  c.setScale(0.92);
  scene.tweens.add({ targets: c, scale: 1, duration: 160, ease: 'Back.easeOut' });
  scene.tweens.add({ targets: c, alpha: 0, delay: 2100, duration: 350, onComplete: () => c.destroy(true) });
  return c;
}

/* ───────────────────────── misc widgets ───────────────────────── */

/** A horizontal progress bar. Returns the graphics (redraw to update). */
export function progressBar(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  color: number = COLORS.emeraldDeep,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const r = h / 2;
  g.fillStyle(0x000000, 0.35);
  g.fillRoundedRect(x - w / 2, y - h / 2, w, h, r);
  const fw = Math.max(0, Math.min(1, ratio)) * w;
  if (fw > 0) {
    g.fillGradientStyle(lighten(color, 0.3), color, darken(color, 0.2), darken(color, 0.3), 1);
    g.fillRoundedRect(x - w / 2, y - h / 2, Math.max(fw, h), h, r);
    g.fillStyle(0xffffff, 0.18);
    g.fillRoundedRect(x - w / 2 + 2, y - h / 2 + 2, Math.max(fw - 4, 2), h * 0.4, r / 2);
  }
  g.lineStyle(1.5, COLORS.strokeHi, 0.5);
  g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, r);
  return g;
}

/** A small circular "chip token" with a value — used for stakes. */
export class ChipToken extends Phaser.GameObjects.Container {
  readonly value: string;
  private readonly color: number;
  private readonly ring: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number, value: string, color: number = COLORS.goldDeep, radius = 30, onClick?: () => void) {
    super(scene, x, y);
    this.value = value;
    this.color = color;
    this.ring = scene.add.graphics();
    const body = scene.add.circle(0, 0, radius, color, 1);
    body.setStrokeStyle(3, lighten(color, 0.6), 1);
    const inner = scene.add.circle(0, 0, radius * 0.72, 0x000000, 0.18);
    inner.setStrokeStyle(2, 0xffffff, 0.35);
    const dash = scene.add.graphics();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      dash.fillStyle(0xffffff, 0.5);
      dash.fillCircle(Math.cos(a) * radius * 0.86, Math.sin(a) * radius * 0.86, 1.6);
    }
    const t = scene.add
      .text(0, 0, value, { fontFamily: FONT_FAMILY, fontSize: `${Math.round(radius * 0.7)}px`, color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5);
    t.setShadow(0, 2, '#000000aa', 3);
    this.add([this.ring, body, inner, dash, t]);
    this.setSize(radius * 2, radius * 2);
    if (onClick) {
      this.setInteractive(new Phaser.Geom.Circle(0, 0, radius), Phaser.Geom.Circle.Contains);
      if (scene.input) this.input!.cursor = 'pointer';
      this.on('pointerover', () => this.setScale(1.08));
      this.on('pointerout', () => this.setScale(1));
      this.on('pointerdown', () => this.setScale(0.94));
      this.on('pointerup', () => {
        this.setScale(1);
        onClick();
      });
    }
    scene.add.existing(this);
  }

  /** Highlight this token as selected. */
  setSelected(on: boolean): this {
    this.ring.clear();
    if (on) {
      this.ring.lineStyle(4, COLORS.goldNum, 1);
      this.ring.strokeCircle(0, 0, 34);
      this.setScale(1.06);
    } else {
      this.setScale(1);
    }
    void this.color;
    return this;
  }
}
