import Phaser from 'phaser';
import { SCENE_KEYS } from '../Constants';

/**
 * Boot scene: generates every texture the game needs at runtime (soft glows,
 * sparks, coins, stars, rings), so particles and lights actually render — then
 * hands control to the menu.
 *
 * Art is procedural, which keeps the build asset-free and instantly themeable.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE_KEYS.BOOT);
  }

  create(): void {
    // Wait for the self-hosted display face before any text renders (canvas
    // picks the font up through the CSS font cascade).
    void this.awaitFonts()
      .then(() => {
        this.makeGlow('glow', 128, 0.95);
        this.makeGlow('spark', 24, 1);
        this.makeGlow('flare', 256, 0.7);
        this.makeCoin();
        this.makeStar();
        this.makeRing();
        this.scene.start(SCENE_KEYS.MENU);
      })
      .catch((e) => {
        // Surface boot failures on mobile where DevTools is unavailable.
        try {
          const msg = e instanceof Error ? e.stack || e.message : String(e);
          window.dispatchEvent(new CustomEvent('chips:boot-error', { detail: msg }));
        } catch {
          /* ignore */
        }
        throw e;
      });
  }

  private async awaitFonts(): Promise<void> {
    try {
      if (document.fonts) {
        await Promise.race([
          document.fonts.load('16px "Michroma"'),
          new Promise<void>((resolve) => setTimeout(resolve, 1500)),
        ]);
      }
    } catch {
      /* offline / no-op — fall through with whatever font is available */
    }
  }

  /** Radial soft dot via canvas gradient (white, so it can be tinted). */
  private makeGlow(key: string, size: number, power: number): void {
    if (this.textures.exists(key)) return;
    const tex = this.textures.createCanvas(key, size, size);
    if (!tex) return;
    const ctx = tex.getContext();
    const r = size / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, `rgba(255,255,255,${power})`);
    grad.addColorStop(0.35, `rgba(255,255,255,${power * 0.5})`);
    grad.addColorStop(0.7, `rgba(255,255,255,${power * 0.14})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  }

  /** A gold casino coin for coin-rain particles. */
  private makeCoin(): void {
    const key = 'coin';
    if (this.textures.exists(key)) return;
    const s = 40;
    const tex = this.textures.createCanvas(key, s, s);
    if (!tex) return;
    const ctx = tex.getContext();
    const c = s / 2;
    const grad = ctx.createRadialGradient(c - 5, c - 6, 2, c, c, c);
    grad.addColorStop(0, '#fff6c9');
    grad.addColorStop(0.45, '#f7d774');
    grad.addColorStop(0.8, '#d9a521');
    grad.addColorStop(1, '#8a6410');
    ctx.beginPath();
    ctx.arc(c, c, c - 3, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c, c, c * 0.58, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(120,80,0,0.5)';
    ctx.stroke();
    tex.refresh();
  }

  /** A four-point sparkle star. */
  private makeStar(): void {
    const key = 'star';
    if (this.textures.exists(key)) return;
    const s = 48;
    const tex = this.textures.createCanvas(key, s, s);
    if (!tex) return;
    const ctx = tex.getContext();
    const c = s / 2;
    ctx.translate(c, c);
    const draw = (rOuter: number, rInner: number, n: number): void => {
      ctx.beginPath();
      for (let i = 0; i < n * 2; i++) {
        const r = i % 2 === 0 ? rOuter : rInner;
        const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    draw(c - 3, (c - 3) * 0.32, 4);
    ctx.fillStyle = grad;
    ctx.fill();
    tex.refresh();
  }

  /** A thin glowing ring. */
  private makeRing(): void {
    const key = 'ring';
    if (this.textures.exists(key)) return;
    const s = 96;
    const tex = this.textures.createCanvas(key, s, s);
    if (!tex) return;
    const ctx = tex.getContext();
    const c = s / 2;
    ctx.beginPath();
    ctx.arc(c, c, c - 6, 0, Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c, c, c - 2, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke();
    tex.refresh();
  }
}
