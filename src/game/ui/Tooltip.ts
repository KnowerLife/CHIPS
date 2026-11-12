import Phaser from 'phaser';
import { COLORS, FONT_FAMILY } from './Theme';

export interface TooltipLine {
  text: string;
  /** CSS colour override. */
  color?: string;
  /** `true` for the bold first line. */
  title?: boolean;
}

/**
 * A small floating info card used for chip hover tooltips.
 *
 * One instance per scene; `show()` re-lays-out and re-positions it, `hide()`
 * makes it disappear. It is intentionally kept out of the scene graph's input
 * handling (`setVisible(false)` also disables hit-testing on children).
 */
export class ChipTooltip extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly lines: Phaser.GameObjects.Text[] = [];
  private static readonly PAD_X = 10;
  private static readonly PAD_Y = 8;
  private static readonly MAX_W = 248;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.bg = scene.add.graphics();
    this.add(this.bg);
    this.setDepth(1500);
    this.setVisible(false);
    scene.add.existing(this);
  }

  show(lines: TooltipLine[], accent: number, x: number, y: number): void {
    for (const t of this.lines) t.destroy();
    this.lines.length = 0;

    let textW = 0;
    let textH = 0;
    const gap = 2;
    for (const line of lines) {
      const t = this.scene.add
        .text(0, textH, line.text, {
          fontFamily: FONT_FAMILY,
          fontSize: line.title ? '12px' : '11px',
          color: line.color ?? (line.title ? COLORS.text : COLORS.dim),
          fontStyle: line.title ? 'bold' : 'normal',
          align: 'left',
        })
        .setOrigin(0, 0);
      t.setWordWrapWidth(ChipTooltip.MAX_W - ChipTooltip.PAD_X * 2, true);
      this.lines.push(t);
      this.add(t);
      textW = Math.max(textW, t.width);
      textH += t.height + gap;
    }

    const w = Math.ceil(textW + ChipTooltip.PAD_X * 2);
    const h = Math.ceil(textH - gap + ChipTooltip.PAD_Y * 2);
    for (const t of this.lines) t.setX(ChipTooltip.PAD_X);

    const g = this.bg;
    g.clear();
    // Shadow, glass body and accent rim.
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(2, 4, w, h, 10);
    g.fillStyle(COLORS.panel, 0.98);
    g.fillRoundedRect(0, 0, w, h, 10);
    g.lineStyle(1.5, accent, 0.9);
    g.strokeRoundedRect(0, 0, w, h, 10);

    // Prefer the right/below of the cursor, then clamp inside the stage.
    const stageW = this.scene.scale.width;
    const stageH = this.scene.scale.height;
    const px = Phaser.Math.Clamp(x + 14, 6, stageW - w - 6);
    const py = Phaser.Math.Clamp(y - h - 10, 6, stageH - h - 6);
    this.setPosition(Math.round(px), Math.round(py));
    this.setVisible(true);
  }

  hide(): void {
    this.setVisible(false);
  }
}
