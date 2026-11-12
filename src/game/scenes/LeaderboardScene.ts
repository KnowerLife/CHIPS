import Phaser from 'phaser';
import { GAME_WIDTH, SCENE_KEYS } from '../Constants';
import { session } from '../State';
import { uniqueChips } from '../systems/Economy';
import { COLORS, lighten } from '../ui/Theme';
import { Button, label, panel } from '../ui/Widgets';
import { burst, glowSprite, installBackground, popIn } from '../ui/Fx';
import { net } from '../net/Net';
import type { GlobalLeaderboardEntry } from '../net/Protocol';

interface Entry {
  name: string;
  chips: number;
  at: number;
}

type Mode = 'global' | 'local';

/**
 * Leaderboard. Two tabs:
 *  - «ГЛОБАЛЬНЫЙ» — top-N of all accounts served by the online backend
 *    (`GET /api/leaderboard` + best-score updates via `leaderboard:submit`).
 *  - «ЛОКАЛЬНЫЙ» — the player's own best results recorded in `localStorage`.
 */
export class LeaderboardScene extends Phaser.Scene {
  private readonly netApi = net();

  private mode: Mode = 'global';
  private podiumGO?: Phaser.GameObjects.GameObject;
  private listGO?: Phaser.GameObjects.GameObject;
  private emptyGO?: Phaser.GameObjects.GameObject;

  constructor() {
    super(SCENE_KEYS.LEADERBOARD);
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    installBackground(this, { chips: false });
    this.buildTop();
    this.buildTabs();
    this.render();
  }

  private buildTop(): void {
    panel(this, GAME_WIDTH / 2, 60, GAME_WIDTH - 32, 76, COLORS.panel, 20, {
      glow: COLORS.goldDeep,
      rim: COLORS.goldNum,
      rimAlpha: 0.4,
    });
    new Button(this, 52, 60, '←', () => this.scene.start(SCENE_KEYS.MENU), {
      width: 46,
      height: 46,
      fontSize: 22,
      variant: 'ghost',
      glow: false,
    });
    const t = label(this, GAME_WIDTH / 2, 50, 'РЕЙТИНГ', 20, COLORS.gold);
    t.setShadow(0, 3, '#000000aa', 6);
    label(this, GAME_WIDTH / 2, 74, `ваша коллекция: ${uniqueChips(session.profile)} фишек`, 12, COLORS.dim);
  }

  /** Segmented switch between the server table and the local best list. */
  private buildTabs(): void {
    const mk = (x: number, labelText: string, mode: Mode) =>
      new Button(this, x, 148, labelText, () => {
        this.mode = mode;
        this.render();
      }, { width: 128, height: 44, variant: this.mode === mode ? 'gold' : 'ghost', fontSize: 11, glow: this.mode === mode });

    mk(GAME_WIDTH / 2 - 68, '🌐 ГЛОБАЛЬНЫЙ', 'global');
    mk(GAME_WIDTH / 2 + 68, '🏠 ЛОКАЛЬНЫЙ', 'local');
  }

  private render(): void {
    this.podiumGO?.destroy(true);
    this.podiumGO = undefined;
    this.listGO?.destroy(true);
    this.listGO = undefined;
    this.emptyGO?.destroy(true);
    this.emptyGO = undefined;

    if (this.mode === 'local') {
      const p = session.profile;
      p.leaderboard.sort((a, b) => b.chips - a.chips);
      p.leaderboard = p.leaderboard.slice(0, 10);
      const list = (p.leaderboard as Entry[]) ?? [];
      if (list.length === 0) this.buildEmpty();
      else {
        this.buildPodium(list.slice(0, 3));
        this.buildList(list.slice(3));
      }
      return;
    }

    void this.netApi.fetchLeaderboard().then((res) => {
      if (this.mode !== 'global') return;
      this.podiumGO?.destroy(true);
      this.podiumGO = undefined;
      this.listGO?.destroy(true);
      this.listGO = undefined;
      this.emptyGO?.destroy(true);
      this.emptyGO = undefined;
      const entries = (res?.entries ?? []) as GlobalLeaderboardEntry[];
      if (entries.length === 0) {
        this.buildEmpty();
        return;
      }
      this.buildPodium(entries.slice(0, 3));
      this.buildList(entries.slice(3));
    });
  }

  private buildEmpty(): void {
    const root = this.add.container(0, 0);
    this.emptyGO = root;
    glowSprite(this, GAME_WIDTH / 2, 360, COLORS.goldNum, 2.4, 0.2);
    label(this, GAME_WIDTH / 2, 350, '🏆', 64);
    label(this, GAME_WIDTH / 2, 430, 'Пока никого нет', 20, COLORS.text);
    label(this, GAME_WIDTH / 2, 462, 'Сыграйте партию — и займите первое место!', 13, COLORS.dim).setWordWrapWidth(320, true);
    new Button(this, GAME_WIDTH / 2, 540, '🎯  ИГРАТЬ', () => this.scene.start(SCENE_KEYS.MENU), {
      width: 220,
      height: 58,
      variant: 'gold',
      fontSize: 18,
    });
  }

  private buildPodium(top: Entry[]): void {
    const root = this.add.container(0, 0);
    this.podiumGO = root;
    const baseY = 462;
    // Winner in the middle on the tallest pedestal, 2nd left, 3rd right.
    const order: { rank: number; x: number; h: number }[] = [
      { rank: 0, x: 240, h: 156 },
      { rank: 1, x: 116, h: 126 },
      { rank: 2, x: 364, h: 100 },
      { rank: 2, x: 364, h: 100 },
    ];

    order.forEach((slot) => {
      const entry = top[slot.rank];
      if (!entry) return;
      const colors = [COLORS.goldDeep, COLORS.cyanDeep, COLORS.magentaDeep];
      const accent = colors[slot.rank];
      const topY = baseY - slot.h;

      const pedestal = this.add.graphics();
      root.add(pedestal);
      pedestal.fillGradientStyle(lighten(accent, 0.15), lighten(accent, 0.05), COLORS.panel, COLORS.panel, 1);
      pedestal.fillRoundedRect(slot.x - 56, topY, 112, slot.h, 12);
      pedestal.lineStyle(2, lighten(accent, 0.5), 0.85);
      pedestal.strokeRoundedRect(slot.x - 56, topY, 112, slot.h, 12);
      pedestal.fillStyle(0xffffff, 0.08);
      pedestal.fillRoundedRect(slot.x - 52, topY + 4, 104, 24, 8);

      label(this, slot.x, baseY - 26, `#${slot.rank + 1}`, 22, COLORS.text);
      label(this, slot.x, baseY - 52, `${entry.chips}`, 16, COLORS.gold);
      label(this, slot.x, baseY - 68, 'фишек', 10, COLORS.dim);

      const avatarY = topY - 34;
      const av = this.add.circle(slot.x, avatarY, 30, lighten(accent, 0.1), 1);
      root.add(av);
      av.setStrokeStyle(3, lighten(accent, 0.6), 1);
      const initials = (entry.name || 'Игрок').trim().slice(0, 2).toUpperCase();
      label(this, slot.x, avatarY, initials, 20, '#ffffff');
      glowSprite(this, slot.x, avatarY, accent, 1.1, 0.4);

      const name = label(this, slot.x, avatarY - 48, entry.name || 'Игрок', 12, COLORS.text);
      name.setWordWrapWidth(110, true);

      if (slot.rank === 0) {
        const crown = label(this, slot.x, avatarY - 74, '👑', 30);
        popIn(this, crown, 200);
        this.tweens.add({ targets: crown, y: crown.y - 6, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        burst(this, slot.x, avatarY, { count: 20, color: COLORS.goldNum, speed: 200, depth: 50 });
      }
    });
  }

  private buildList(rest: Entry[]): void {
    const root = this.add.container(0, 0);
    this.listGO = root;
    let y = 512;
    const w = GAME_WIDTH - 48;
    rest.forEach((e, i) => {
      const rank = i + 4;
      const bg = this.add.graphics();
      root.add(bg);
      bg.fillStyle(rank % 2 === 0 ? COLORS.panel : COLORS.panelAlt, 1);
      bg.fillRoundedRect(24, y - 20, w, 40, 10);
      bg.lineStyle(1.5, COLORS.stroke, 0.5);
      bg.strokeRoundedRect(24, y - 20, w, 40, 10);

      const rg = this.add.graphics();
      root.add(rg);
      rg.fillStyle(COLORS.panelHi, 1);
      rg.fillCircle(48, y, 15);
      rg.lineStyle(1.5, COLORS.strokeHi, 0.8);
      rg.strokeCircle(48, y, 15);
      label(this, 48, y, `${rank}`, 13, COLORS.text);

      label(this, 74, y, e.name || 'Игрок', 14, COLORS.text).setWordWrapWidth(w - 150, true);
      label(this, GAME_WIDTH - 36, y, `${e.chips}`, 15, COLORS.gold, 1);
      y += 44;
    });
  }
}
