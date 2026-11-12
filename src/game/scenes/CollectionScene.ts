import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from '../Constants';
import { session } from '../State';
import { CHIPS } from '../data/Chips';
import type { ChipDef, Rarity } from '../Types';
import { COLORS, TEXT_COLORS, css, darken, lighten, rarityColor, rarityGlow, rarityLabel } from '../ui/Theme';
import { Button, label, modal, panel } from '../ui/Widgets';
import { installBackground, makeScroll, popIn } from '../ui/Fx';
import { ChipView } from '../ui/ChipView';
import { ChipTooltip } from '../ui/Tooltip';
import { getSettings } from '../systems/Settings';
import { seriesProgress } from '../systems/Series';

const RARITIES: (Rarity | 'all')[] = ['all', 'common', 'rare', 'epic', 'legendary'];
const CARD_W = 138;
const CARD_H = 124;
const GAP_X = 9;
const GAP_Y = 12;
const COLS = 3;
const GRID_TOP = 172;
/** Left edge of the first card column — centres the 3-column grid on screen. */
const GRID_LEFT = 24 + CARD_W / 2;

/**
 * The collection: a scrollable, rarity-framed grid of every chip. Locked chips
 * appear as dimmed silhouettes; owned chips show a count badge and (for rare+)
 * a coloured aura.
 */
export class CollectionScene extends Phaser.Scene {
  private gridRoot!: Phaser.GameObjects.Container;
  private filter = 'all' as Rarity | 'all';
  private countText!: Phaser.GameObjects.Text;
  private progress!: Phaser.GameObjects.Graphics;
  private filterButtons: { rarity: Rarity | 'all'; btn: Button }[] = [];
  private tooltip!: ChipTooltip;

  constructor() {
    super(SCENE_KEYS.COLLECTION);
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    installBackground(this, { chips: false });
    this.tooltip = new ChipTooltip(this);
    this.buildTop();
    this.buildFilters();
    this.gridRoot = this.add.container(GRID_LEFT, GRID_TOP);
    this.render();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.tooltip.destroy());
  }

  /* ───────────────────────── chrome ───────────────────────── */

  private buildTop(): void {
    panel(this, GAME_WIDTH / 2, 60, GAME_WIDTH - 32, 76, COLORS.panel, 20, {
      glow: COLORS.violetDeep,
      rim: COLORS.goldNum,
      rimAlpha: 0.35,
    });
    new Button(this, 52, 60, '←', () => this.scene.start(SCENE_KEYS.MENU), {
      width: 46,
      height: 46,
      fontSize: 22,
      variant: 'ghost',
      glow: false,
    });
    new Button(this, GAME_WIDTH - 52, 60, '🗂', () => this.openSeries(), {
      width: 46,
      height: 46,
      fontSize: 20,
      variant: 'ghost',
      glow: false,
    });

    const title = label(this, GAME_WIDTH / 2, 46, 'КОЛЛЕКЦИЯ', 19, COLORS.gold);
    title.setShadow(0, 2, '#000000aa', 4);
    this.countText = label(this, GAME_WIDTH / 2, 70, '', 13, COLORS.dim);
    this.progress = this.add.graphics();
  }

  private buildFilters(): void {
    const totalW = GAME_WIDTH - 40;
    const w = totalW / RARITIES.length;
    RARITIES.forEach((r, i) => {
      const x = 20 + w / 2 + i * w;
      const txt = r === 'all' ? 'ВСЕ' : rarityLabel(r).toUpperCase().slice(0, 5);
      const btn = new Button(
        this,
        x,
        126,
        txt,
        () => {
          this.filter = r;
          this.refreshFilters();
          this.render();
        },
        { width: w - 4, height: 44, fontSize: 11, variant: 'ghost', glow: false, radius: 12 },
      );
      this.filterButtons.push({ rarity: r, btn });
    });
    this.refreshFilters();
  }

  private refreshFilters(): void {
    for (const fb of this.filterButtons) {
      const active = fb.rarity === this.filter;
      const accent = fb.rarity === 'all' ? COLORS.goldDeep : rarityColor(fb.rarity);
      if (active) fb.btn.setFill(fb.rarity === 'common' ? darken(accent, 0.1) : accent);
      else fb.btn.setFill(COLORS.panelAlt);
      fb.btn.setAlpha(active ? 1 : 0.75);
    }
  }

  /* ───────────────────────── grid ───────────────────────── */

  private render(): void {
    this.gridRoot.removeAll(true);
    const inv = session.profile.inventory;
    const list = this.filtered();

    let types = 0;
    let owned = 0;
    let x = 0;
    let y = CARD_H / 2;
    let col = 0;

    const cards: Phaser.GameObjects.Container[] = [];
    for (const c of list) {
      const have = inv[c.id] ?? 0;
      if (have > 0) types += 1;
      owned += have;
      const card = this.makeCard(x, y, c, have);
      this.gridRoot.add(card);
      cards.push(card);
      col += 1;
      if (col >= COLS) {
        col = 0;
        x = 0;
        y += CARD_H + GAP_Y;
      } else {
        x += CARD_W + GAP_X;
      }
    }

    if (list.length === 0) {
      label(this, GAME_WIDTH / 2, 300, 'Здесь пока пусто', 16, COLORS.dim);
    } else {
      popIn(this, cards, 0, 0.92);
    }

    // Top summary + progress bar.
    const total = CHIPS.length;
    const uniq = Object.values(inv).filter((n) => n > 0).length;
    this.countText.setText(`собрано ${uniq}/${total}  ·  всего фишек ${owned}  ·  типов ${types}`);
    const barW = GAME_WIDTH - 96;
    const x0 = 48;
    const y0 = 88;
    this.progress.clear();
    this.progress.fillStyle(0x000000, 0.4);
    this.progress.fillRoundedRect(x0, y0, barW, 7, 4);
    const ratio = total > 0 ? uniq / total : 0;
    if (ratio > 0) {
      this.progress.fillGradientStyle(COLORS.emerald, COLORS.emeraldDeep, COLORS.emeraldDark, COLORS.emeraldDark, 1);
      this.progress.fillRoundedRect(x0, y0, Math.max(barW * ratio, 7), 7, 4);
    }

    // Scroll over whatever doesn't fit.
    const rows = Math.ceil(list.length / COLS);
    const contentHeight = Math.max(rows * (CARD_H + GAP_Y), 1);
    makeScroll(this, this.gridRoot, { x: 0, y: GRID_TOP, width: GAME_WIDTH, height: GAME_HEIGHT - GRID_TOP - 4 }, contentHeight);
  }

  private filtered(): ChipDef[] {
    const order: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
    if (this.filter === 'all') {
      return CHIPS.slice().sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity));
    }
    return CHIPS.filter((c) => c.rarity === this.filter);
  }

  private makeCard(x: number, y: number, def: ChipDef, have: number): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const locked = have <= 0;
    const rc = rarityColor(def.rarity);

    const bg = panel(this, 0, 0, CARD_W, CARD_H, COLORS.panel, 16, {
      rim: locked ? COLORS.stroke : rc,
      rimAlpha: locked ? 0.4 : 0.85,
      glow: !locked && def.rarity !== 'common' ? rarityGlow(def.rarity) : undefined,
    });
    c.add(bg);

    // Rarity strip.
    const stripY = -CARD_H / 2 + 6;
    const strip = this.add.graphics();
    strip.fillStyle(rc, locked ? 0.22 : 0.9);
    strip.fillRoundedRect(-CARD_W / 2 + 6, stripY, CARD_W - 12, 15, 7);
    c.add(strip);
    c.add(label(this, 0, stripY + 8, rarityLabel(def.rarity), 9, locked ? COLORS.dim : '#1a0f04'));

    // Chip token.
    const chip = new ChipView(this, 0, -4, def.id, 28, true);
    if (def.rarity !== 'common') chip.enableAura();
    if (locked) chip.setAlpha(0.3);
    c.add(chip);

    // Name + series.
    c.add(label(this, 0, CARD_H / 2 - 30, def.name, 10, locked ? COLORS.dim : COLORS.text).setWordWrapWidth(CARD_W - 16, true));
    c.add(label(this, 0, CARD_H / 2 - 14, def.series, 8, COLORS.dim));

    // Count badge.
    if (have > 0) {
      const bx = CARD_W / 2 - 15;
      const by = -CARD_H / 2 + 30;
      const badge = this.add.graphics();
      badge.fillStyle(COLORS.goldNum, 1);
      badge.fillCircle(bx, by, 11);
      badge.lineStyle(2, 0xffffff, 0.7);
      badge.strokeCircle(bx, by, 11);
      c.add(badge);
      c.add(label(this, bx, by, `x${have}`, 9, '#20140a'));
    } else {
      c.add(label(this, 0, -4, '🔒', 18, COLORS.dim));
    }

    // Desktop hover: the collection is where a player studies a chip, so here
    // the tooltip spells out everything (weight, value, how many are owned).
    c.setSize(CARD_W, CARD_H);
    c.setInteractive(
      new Phaser.Geom.Rectangle(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H),
      Phaser.Geom.Rectangle.Contains,
    );
    c.on('pointerover', () => this.showCardTooltip(def, have));
    c.on('pointerout', () => this.tooltip.hide());

    return c;
  }

  /** Full chip info card, shown while a collection card is hovered. */
  private showCardTooltip(def: ChipDef, have: number): void {
    if (!getSettings().tooltips) return;
    const pointer = this.input.activePointer;
    const lines = [
      { text: def.name, title: true, color: COLORS.text },
      { text: `${rarityLabel(def.rarity)} · ${def.series}`, color: css(rarityColor(def.rarity)) },
      { text: `вес ${def.weight.toFixed(1)} · чем тяжелее, тем крепче`, color: COLORS.dim },
      { text: `ценность ${def.value} 🪙`, color: COLORS.gold },
      {
        text: have > 0 ? `в коллекции: ${have}` : 'ещё не найдена',
        color: have > 0 ? TEXT_COLORS.green : COLORS.dim,
      },
    ];
    this.tooltip.show(lines, rarityColor(def.rarity), pointer.x, pointer.y);
  }

  /* ───────────────────────── series ───────────────────────── */

  /** Modal listing every collection series with completion + reward state. */
  private openSeries(): void {
    const { root, close } = modal(this, 'СЕРИИ', { height: 620 });
    const series = seriesProgress(session.profile);

    const viewport = { x: 40, y: GAME_HEIGHT / 2 - 190, width: GAME_WIDTH - 80, height: 396 };
    const content = this.add.container(0, 0);
    root.add(content);

    let y = -190;
    for (const s of series) {
      const ok = s.complete;
      const g = this.add.graphics();
      g.fillStyle(ok ? lighten(COLORS.emeraldDeep, 0.12) : COLORS.panelAlt, 1);
      g.fillRoundedRect(-GAME_WIDTH / 2 + 52, y - 22, GAME_WIDTH - 104, 66, 12);
      g.lineStyle(1.5, ok ? COLORS.emerald : COLORS.stroke, 0.7);
      g.strokeRoundedRect(-GAME_WIDTH / 2 + 52, y - 22, GAME_WIDTH - 104, 66, 12);
      content.add(g);

      content.add(label(this, -GAME_WIDTH / 2 + 76, y - 16, s.name, 14, COLORS.text, 0));
      content.add(label(this, -GAME_WIDTH / 2 + 76, y, `${s.owned}/${s.total}`, 12, ok ? COLORS.gold : COLORS.dim, 0));

      const barW = GAME_WIDTH - 160;
      const barY = y - 2;
      const gbar = this.add.graphics();
      gbar.fillStyle(0x000000, 0.4);
      gbar.fillRoundedRect(-GAME_WIDTH / 2 + 96, barY, barW, 7, 4);
      const ratio = s.total > 0 ? s.owned / s.total : 0;
      if (ratio > 0) {
        gbar.fillGradientStyle(COLORS.emerald, COLORS.emeraldDeep, COLORS.emeraldDark, COLORS.emeraldDark, 1);
        gbar.fillRoundedRect(-GAME_WIDTH / 2 + 96, barY, Math.max(barW * ratio, 7), 7, 4);
      }
      content.add(gbar);

      content.add(
        label(
          this,
          -GAME_WIDTH / 2 + 96,
          y + 18,
          ok ? `✓ награда +${s.reward} 🪙` : s.claimed ? `награда получена (+${s.reward})` : `собрать серию — награда +${s.reward} 🪙`,
          11,
          ok ? TEXT_COLORS.green : COLORS.dim,
          0,
        ),
      );
      y += 78;
    }

    makeScroll(this, content, viewport, Math.abs(y) + 40, { depth: 2005 });
    root.add(new Button(this, 0, 232, 'ЗАКРЫТЬ', () => close(), { width: 180, height: 46, variant: 'ghost' }));
  }
}
