import Phaser from 'phaser';
import { COLORS, FONT_FAMILY, css, lighten } from './Theme';
import { getSettings } from '../systems/Settings';

/**
 * Reusable "juice" helpers that give the game its neon-casino feel:
 * animated backgrounds, particle bursts, coin rain, glow pulses, animated
 * counters, floating reward text and scrollable content.
 *
 * These are purely presentational — they never touch the simulation in
 * `src/game/systems/*`. Particle textures ('spark', 'glow', 'coin', 'star')
 * are generated in `BootScene`.
 */

/* ───────────────────────── background ───────────────────────── */

/**
 * Paint an animated casino background: a purple nebula gradient, slow-drifting
 * glow orbs, faint floating chip glyphs and a vignette. Returns nothing — the
 * objects live on the scene and are cleaned up automatically.
 */
export function installBackground(scene: Phaser.Scene, opts: { chips?: boolean } = {}): void {
  const W = scene.scale.width;
  const H = scene.scale.height;

  // Base gradient.
  const g = scene.add.graphics().setDepth(-100);
  g.fillGradientStyle(COLORS.bg1, COLORS.bg0, COLORS.bg2, COLORS.bg0, 1);
  g.fillRect(0, 0, W, H);

  // Corner glows.
  const glowA = scene.add.image(W * 0.2, H * 0.12, 'glow');
  glowA.setTint(COLORS.violetDeep).setAlpha(0.5).setScale(6).setDepth(-99);
  const glowB = scene.add.image(W * 0.85, H * 0.3, 'glow');
  glowB.setTint(COLORS.cyanDeep).setAlpha(0.3).setScale(5).setDepth(-99);
  const glowC = scene.add.image(W * 0.5, H * 0.95, 'glow');
  glowC.setTint(COLORS.magentaDeep).setAlpha(0.28).setScale(7).setDepth(-99);

  for (const [orb, dur, dist] of [
    [glowA, 5200, 26],
    [glowB, 6400, 34],
    [glowC, 7800, 22],
  ] as const) {
    scene.tweens.add({
      targets: orb,
      y: orb.y + dist,
      alpha: orb.alpha * 0.6,
      duration: dur,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // Faint floating chip glyphs.
  if (opts.chips !== false && scene.textures.exists('glow')) {
    const glyphs = ['◉', '◎', '●', '⬤', '✦', '◆'];
    const tints = [COLORS.goldNum, COLORS.cyan, COLORS.violet, COLORS.emerald, COLORS.magenta];
    for (let i = 0; i < 14; i++) {
      const t = scene.add
        .text(Phaser.Math.Between(0, W), Phaser.Math.Between(0, H), Phaser.Math.RND.pick(glyphs), {
          fontFamily: FONT_FAMILY,
          fontSize: `${Phaser.Math.Between(18, 46)}px`,
          color: css(Phaser.Math.RND.pick(tints)),
        })
        .setOrigin(0.5)
        .setAlpha(Phaser.Math.FloatBetween(0.04, 0.12))
        .setDepth(-98);
      scene.tweens.add({
        targets: t,
        y: t.y - Phaser.Math.Between(60, 160),
        angle: Phaser.Math.Between(-40, 40),
        duration: Phaser.Math.Between(9000, 18000),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        delay: Phaser.Math.Between(0, 4000),
      });
    }
  }

  // Top + bottom vignette for depth.
  const vig = scene.add.graphics().setDepth(-97);
  vig.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0);
  vig.fillStyle(0x000000, 0.35);
  vig.fillRect(0, 0, W, 90);
  vig.fillRect(0, H - 110, W, 110);
}

/* ───────────────────────── particles ───────────────────────── */

export interface BurstOptions {
  count?: number;
  color?: number;
  speed?: number;
  lifespan?: number;
  scale?: number;
  gravityY?: number;
  texture?: string;
  /** Render depth (default 1000). Use > 2010 to appear above modals. */
  depth?: number;
}

/** A radial particle burst (used for smashes, purchases, rewards). */
export function burst(scene: Phaser.Scene, x: number, y: number, opts: BurstOptions = {}): void {
  const texture = opts.texture ?? 'spark';
  if (!scene.textures.exists(texture)) return;
  const emitter = scene.add.particles(x, y, texture, {
    speed: { min: (opts.speed ?? 120) * 0.4, max: opts.speed ?? 260 },
    scale: { start: opts.scale ?? 0.7, end: 0 },
    alpha: { start: 1, end: 0 },
    lifespan: opts.lifespan ?? 420,
    gravityY: opts.gravityY ?? 0,
    tint: opts.color ?? COLORS.goldNum,
    blendMode: Phaser.BlendModes.ADD,
    emitting: false,
  });
  emitter.setDepth(opts.depth ?? 1000);
  emitter.explode(opts.count ?? 18);
  scene.time.delayedCall((opts.lifespan ?? 420) + 60, () => emitter.destroy());
}

/** Coins raining from the top of the screen — for wins and jackpots. */
export function coinRain(scene: Phaser.Scene, count = 24, depth = 1000): void {
  if (!scene.textures.exists('coin')) return;
  const W = scene.scale.width;
  const emitter = scene.add.particles(0, -20, 'coin', {
    x: { min: 0, max: W },
    speedY: { min: 120, max: 260 },
    speedX: { min: -40, max: 40 },
    angle: { min: -30, max: 30 },
    rotate: { min: -180, max: 180 },
    scale: { min: 0.5, max: 0.9 },
    lifespan: 2200,
    gravityY: 160,
    emitting: false,
  });
  emitter.setDepth(depth);
  emitter.explode(count);
  scene.time.delayedCall(2400, () => emitter.destroy());
}

/** A rotating ray-burst behind (or over) a big win. */
export function rayBurst(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number = COLORS.goldNum,
  radius = 460,
  depth = -1,
): Phaser.GameObjects.Graphics {
  const rays = scene.add.graphics().setDepth(depth);
  const count = 16;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const half = (Math.PI / count) * 0.6;
    const alpha = i % 2 === 0 ? 0.16 : 0.08;
    rays.fillStyle(color, alpha);
    rays.beginPath();
    rays.moveTo(0, 0);
    rays.lineTo(Math.cos(a - half) * radius, Math.sin(a - half) * radius);
    rays.lineTo(Math.cos(a + half) * radius, Math.sin(a + half) * radius);
    rays.closePath();
    rays.fillPath();
  }
  rays.setPosition(x, y);
  scene.tweens.add({ targets: rays, angle: 360, duration: 24000, repeat: -1 });
  return rays;
}

/* ───────────────────────── motion helpers ───────────────────────── */

/** Scale a set of objects in with a springy back-ease. */
export function popIn(
  scene: Phaser.Scene,
  targets: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[],
  delay = 0,
  from = 0.6,
): void {
  const list = Array.isArray(targets) ? targets : [targets];
  for (const t of list) {
    const obj = t as unknown as { setScale?: (s: number) => void };
    obj.setScale?.(from);
  }
  scene.tweens.add({
    targets: list,
    scale: 1,
    delay,
    duration: 340,
    ease: 'Back.easeOut',
  });
}

/** Rise-and-fade text (rewards, damage numbers, "JACKPOT!"). */
export function floatText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: string = TEXT_GOLD,
  size = 20,
  depth = 1100,
): Phaser.GameObjects.Text {
  const t = scene.add
    .text(x, y, text, {
      fontFamily: FONT_FAMILY,
      fontSize: `${size}px`,
      color,
      fontStyle: 'bold',
    })
    .setOrigin(0.5)
    .setDepth(depth);
  t.setStroke('#000000', 4);
  scene.tweens.add({
    targets: t,
    y: y - 70,
    alpha: 0,
    scale: 1.25,
    duration: 1100,
    ease: 'Cubic.easeOut',
    onComplete: () => t.destroy(),
  });
  return t;
}

/** Continuous glow pulse on a game object. */
export function glowPulse(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject, _color: number = COLORS.goldNum): void {
  scene.tweens.add({
    targets: target,
    alpha: { from: 0.55, to: 1 },
    scale: { from: 0.98, to: 1.04 },
    duration: 900,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
}

/** Screen shake with sensible clamping. Skipped under "reduced motion". */
export function shake(scene: Phaser.Scene, intensity = 0.006, duration = 120): void {
  if (getSettings().reduceMotion) return;
  scene.cameras.main.shake(duration, Phaser.Math.Clamp(intensity, 0.001, 0.02));
}

/**
 * Brief "hit-stop" — slows tweens/timers to a crawl for a few real-time
 * milliseconds so a heavy impact lands with weight. Restores itself with a
 * real `setTimeout` (a Phaser timer would be slowed by the very scale change).
 */
export function hitStop(scene: Phaser.Scene, ms = 90, scale = 0.3): void {
  if (getSettings().reduceMotion) return;
  try {
    scene.tweens.timeScale = scale;
    scene.time.timeScale = scale;
  } catch {
    return;
  }
  window.setTimeout(() => {
    try {
      scene.tweens.timeScale = 1;
      scene.time.timeScale = 1;
    } catch {
      /* scene went away mid-stop */
    }
  }, ms);
}

/** Full-screen tint flash (skipped under "reduced motion"). */
export function flash(scene: Phaser.Scene, ms: number, r: number, g: number, b: number): void {
  if (getSettings().reduceMotion) return;
  scene.cameras.main.flash(ms, r, g, b);
}

/** Tween a text object from one number to another (animated counters). */
export function countUp(
  scene: Phaser.Scene,
  text: Phaser.GameObjects.Text,
  from: number,
  to: number,
  duration = 700,
  format: (v: number) => string = (v) => String(Math.round(v)),
): void {
  const proxy = { v: from };
  scene.tweens.add({
    targets: proxy,
    v: to,
    duration,
    ease: 'Cubic.easeOut',
    onUpdate: () => text.setText(format(proxy.v)),
    onComplete: () => text.setText(format(to)),
  });
}

/* ───────────────────────── scrolling ───────────────────────── */

/**
 * Make a container scroll vertically inside a viewport rect.
 * Drag on empty space or use the mouse wheel; content is masked to the viewport.
 *
 * `opts.depth` places the invisible drag zone (default -50, i.e. *behind* the
 * content, so buttons still receive clicks). `opts.dragTargets` lets objects
 * drawn above the zone (cards, rows…) drive the very same scroll — make them
 * `draggable` and guard their own `pointerup` with `pointer.getDistance()`, or
 * a scroll gesture will also register as a tap.
 */
export function makeScroll(
  scene: Phaser.Scene,
  content: Phaser.GameObjects.Container,
  viewport: { x: number; y: number; width: number; height: number },
  contentHeight: number,
  opts: { depth?: number; dragTargets?: Phaser.GameObjects.GameObject[] } = {},
): void {
  const baseY = content.y;
  const minScroll = Math.min(0, viewport.height - contentHeight - 10);
  let scroll = 0;
  let destroyed = false;

  // Mask.
  const shape = scene.make.graphics({}, false);
  shape.fillStyle(0xffffff);
  shape.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  content.setMask(shape.createGeometryMask());

  // Drag zone sits *behind* the content so buttons still receive clicks.
  const zone = scene.add
    .zone(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2, viewport.width, viewport.height)
    .setInteractive({ draggable: true });
  zone.setDepth(opts.depth ?? -50);

  let grabY = 0;
  let startScroll = 0;
  const onDragStart = (p: Phaser.Input.Pointer): void => {
    grabY = p.y;
    startScroll = scroll;
  };
  const onDrag = (p: Phaser.Input.Pointer): void => {
    scroll = Phaser.Math.Clamp(startScroll + (p.y - grabY), minScroll, 0);
    content.y = baseY + scroll;
  };
  zone.on('dragstart', onDragStart);
  zone.on('drag', onDrag);
  for (const target of opts.dragTargets ?? []) {
    target.on('dragstart', onDragStart);
    target.on('drag', onDrag);
  }

  const wheelHandler = (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number): void => {
    if (destroyed) return;
    if (p.y < viewport.y || p.y > viewport.y + viewport.height) return;
    scroll = Phaser.Math.Clamp(scroll - dy * 0.5, minScroll, 0);
    content.y = baseY + scroll;
  };
  scene.input.on('wheel', wheelHandler);

  // Cleanup when the scrolled content goes away (e.g. a closed modal).
  content.once(Phaser.GameObjects.Events.DESTROY, () => {
    destroyed = true;
    zone.destroy();
    shape.destroy();
    scene.input.off('wheel', wheelHandler);
  });

  // A subtle scroll hint (fades out after a moment).
  if (contentHeight > viewport.height + 10) {
    const hint = scene.add
      .text(viewport.x + viewport.width - 10, viewport.y + viewport.height - 14, '↕ листайте', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        color: '#a99ed6',
      })
      .setOrigin(1, 0.5)
      .setDepth((opts.depth ?? -50) + 1);
    scene.tweens.add({ targets: hint, alpha: 0, delay: 2600, duration: 600, onComplete: () => hint.destroy() });
  }
}

/* ───────────────────────── small shared bits ───────────────────────── */

export const TEXT_GOLD = '#f7d774';

/** Quality tier → accent colour for the "hot streak / combo" meter. */
export { heatColor } from './Theme';

/** Soft radial glow sprite over a point (tinted disc). */
export function glowSprite(scene: Phaser.Scene, x: number, y: number, color: number, scale = 3, alpha = 0.5): Phaser.GameObjects.Image {
  const img = scene.add.image(x, y, 'glow').setTint(color).setScale(scale).setAlpha(alpha);
  img.setBlendMode(Phaser.BlendModes.ADD);
  return img;
}

/** Re-export so scenes can build bespoke glows from the same helper. */
export { lighten };
