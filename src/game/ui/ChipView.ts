import Phaser from 'phaser';
import { getChip } from '../data/Chips';
import { COLORS, FONT_FAMILY, darken, lighten, rarityGlow, rarityColor } from './Theme';

/**
 * A single chip ("сотка"/"кэпс") rendered as a glossy, rimmed token with an
 * animated 2D flip.
 *
 * Two faces are pre-built and toggled; `flip()` tweens `scaleY` through zero and
 * swaps the visible face at the midpoint — a cheap but convincing 3D flip.
 * The rim is tinted by rarity and glow-capable for rare+ chips.
 */
export class ChipView extends Phaser.GameObjects.Container {
  readonly defId: string;
  private readonly radius: number;
  private readonly front: Phaser.GameObjects.Container;
  private readonly back: Phaser.GameObjects.Container;
  private readonly aura: Phaser.GameObjects.Image;
  private faceUp: boolean;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    defId: string,
    radius = 26,
    faceUp = false,
  ) {
    super(scene, x, y);
    this.defId = defId;
    this.radius = radius;
    this.faceUp = faceUp;

    const def = getChip(defId);
    this.aura = scene.add.image(0, 0, 'glow').setScale(radius / 22).setAlpha(0);
    this.front = this.buildFace(def.faceColor, def.face, def.rarity, false);
    this.back = this.buildFace(darken(COLORS.bg2, 0.15), '✦', def.rarity, true);

    this.add([this.aura, this.back, this.front]);
    this.applyFace();
    scene.add.existing(this);
  }

  /** Build one face. `isBack` renders the darker "рубашка" side. */
  private buildFace(color: number, glyph: string, rarity: string, isBack: boolean): Phaser.GameObjects.Container {
    const c = this.scene.add.container(0, 0);
    const r = this.radius;

    // Drop shadow.
    const shadow = this.scene.add.circle(2, 3, r, 0x000000, 0.4);

    // Outer rim (rarity tinted).
    const rim = this.scene.add.circle(0, 0, r, lighten(color, 0.35), 1);
    rim.setStrokeStyle(2.5, isBack ? COLORS.strokeHi : lighten(color, 0.7), 0.95);

    // Body.
    const body = this.scene.add.circle(0, 0, r - 2, color, 1);

    // Inner recessed disc.
    const inner = this.scene.add.circle(0, 0, r * 0.7, isBack ? darken(color, 0.25) : darken(color, 0.12), 1);
    inner.setStrokeStyle(1.5, 0x000000, 0.25);

    // Top-left gloss.
    const gloss = this.scene.add.graphics();
    gloss.fillStyle(0xffffff, 0.22);
    gloss.fillEllipse(-r * 0.26, -r * 0.36, r * 1.1, r * 0.72);

    const text = this.scene.add
      .text(0, 0, glyph, {
        fontFamily: FONT_FAMILY,
        fontSize: `${Math.round(r * 0.95)}px`,
        color: isBack ? COLORS.dim : '#ffffff',
      })
      .setOrigin(0.5);
    if (!isBack) text.setShadow(0, 1, '#00000088', 2);

    c.add([shadow, rim, body, inner, gloss, text]);
    void rarity;
    return c;
  }

  private applyFace(): void {
    this.front.setVisible(this.faceUp);
    this.back.setVisible(!this.faceUp);
  }

  /** Set the face without animation. */
  setFaceUp(up: boolean): this {
    this.faceUp = up;
    this.applyFace();
    return this;
  }

  isFaceUp(): boolean {
    return this.faceUp;
  }

  /** Light up the aura for premium chips. */
  enableAura(): this {
    const def = getChip(this.defId);
    this.aura.setTint(rarityGlow(def.rarity as never));
    this.aura.setAlpha(def.rarity === 'common' ? 0 : 0.5);
    return this;
  }

  /** A pulsing highlight used to draw the eye to a specific chip. */
  highlight(): this {
    const glow = rarityColor(getChip(this.defId).rarity);
    this.aura.setTint(glow).setAlpha(0.7);
    this.scene.tweens.add({
      targets: this.aura,
      alpha: { from: 0.25, to: 0.8 },
      scale: { from: this.radius / 22, to: this.radius / 15 },
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    return this;
  }

  /**
   * Animate a flip to `target` (defaults to the opposite face). Resolves when
   * the animation completes.
   */
  flip(target = !this.faceUp, duration = 260): Promise<void> {
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: this,
        scaleY: 0,
        duration: duration / 2,
        ease: 'Sine.easeIn',
        onComplete: () => {
          this.faceUp = target;
          this.applyFace();
          this.scene.tweens.add({
            targets: this,
            scaleY: 1,
            duration: duration / 2,
            ease: 'Sine.easeOut',
            onComplete: () => resolve(),
          });
        },
      });
    });
  }

  /** Little pop used when a chip is collected. */
  pop(): void {
    this.scene.tweens.add({
      targets: this,
      scaleX: this.scaleX * 1.25,
      scaleY: this.scaleY * 1.25,
      duration: 120,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }
}
