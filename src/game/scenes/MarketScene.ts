import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS, FORGE } from '../Constants';
import { session } from '../State';
import { BITAS, effectiveBita } from '../data/Bitas';
import { CHIPS } from '../data/Chips';
import type { BitaDef, ChipDef } from '../Types';
import { buyBita, canAfford, equipBita, sellChip, SELL_RATE } from '../systems/Economy';
import {
  bitaLevel,
  craftBita,
  craftOptions,
  forgePoints,
  upgradeBita,
  upgradeCost,
  type CraftOption,
} from '../systems/Forge';
import { COLORS, TEXT_COLORS, css, darken, lighten, rarityColor, rarityLabel } from '../ui/Theme';
import { Button, label, panel, toast } from '../ui/Widgets';
import { audio } from '../ui/Audio';
import { installBackground, makeScroll, glowSprite } from '../ui/Fx';
import { ChipTooltip } from '../ui/Tooltip';
import { getSettings } from '../systems/Settings';
import { DEFAULT_PACKS, DONATE_TIERS } from '../data/Shop';
import { questEvent } from '../systems/Quests';
import { net } from '../net/Net';
import { openInvoice, isTelegram } from '../net/Telegram';
import type { ChipPack } from '../net/Protocol';

const TOP_H = 108;
const MAX_POWER = 2.0;

/**
 * The market: buy & equip "биты" (slammers) and sell duplicate chips.
 * Laid out as one scrollable column under a fixed balance bar.
 */
export class MarketScene extends Phaser.Scene {
  private balText!: Phaser.GameObjects.Text;
  private content!: Phaser.GameObjects.Container;
  private toastBox?: Phaser.GameObjects.Container;
  private tooltip!: ChipTooltip;
  private packs: ChipPack[] = DEFAULT_PACKS;
  private readonly net = net();
  private unsubs: Array<() => void> = [];
  private alive = false;

  constructor() {
    super(SCENE_KEYS.MARKET);
  }

  create(): void {
    this.alive = true;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    installBackground(this, { chips: false });
    this.buildTop();
    this.buildContent();
    this.tooltip = new ChipTooltip(this);

    // Live catalog from the server + credit any purchase that lands while here.
    void this.net.fetchConfig().then((cfg) => {
      if (!this.alive) return;
      if (cfg && cfg.packages.length) {
        this.packs = cfg.packages;
        this.rebuild();
      }
    });
    this.unsubs.push(
      this.net.on('wallet:grant', (ev) => {
        if (!this.alive) return;
        this.showToast(`+${ev.amount} 🪙 зачислено!`, COLORS.emeraldDeep);
        this.rebuild();
      }),
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.alive = false;
      this.tooltip.destroy();
      for (const u of this.unsubs) u();
      this.unsubs = [];
    });
  }

  /* ───────────────────────── top bar ───────────────────────── */

  private buildTop(): void {
    panel(this, GAME_WIDTH / 2, 62, GAME_WIDTH - 32, 84, COLORS.panel, 20, {
      glow: COLORS.magentaDeep,
      rim: COLORS.goldNum,
      rimAlpha: 0.35,
    });
    new Button(this, 52, 62, '←', () => this.scene.start(SCENE_KEYS.MENU), {
      width: 46,
      height: 46,
      fontSize: 22,
      variant: 'ghost',
      glow: false,
    });
    const t = label(this, GAME_WIDTH / 2, 46, 'МАРКЕТ', 20, COLORS.gold);
    t.setShadow(0, 2, '#000000aa', 4);
    this.balText = label(this, GAME_WIDTH / 2, 76, '', 14, COLORS.text);
    this.updateBal();
  }

  private updateBal(): void {
    const p = session.profile;
    const bita = p.equippedBita ? BITAS.find((b) => b.id === p.equippedBita) : null;
    this.balText.setText(`🪙 ${p.balance}   ·   ${bita ? `${bita.face} ${bita.name}` : '✊ без биты'}`);
  }

  /* ───────────────────────── scrollable body ───────────────────────── */

  private buildContent(): void {
    this.content = this.add.container(0, TOP_H);
    let y = 14;

    y = this.shopSection(y);

    this.content.add(label(this, 28, y, '⚒  БИТЫ (СЛАММЕРЫ)', 16, COLORS.gold, 0));
    y += 30;
    const bitaH = 140;
    for (const b of BITAS) {
      this.bitaCard(y + bitaH / 2, b);
      y += bitaH + 12;
    }

    y += 10;
    this.content.add(label(this, 28, y, `🔥  КУЗНИЦА (очков: ${forgePoints(session.profile)})`, 16, COLORS.gold, 0));
    y += 30;
    const forgeOpts = craftOptions(session.profile);
    if (forgeOpts.length === 0) {
      this.content.add(label(this, GAME_WIDTH / 2, y + 20, 'Все биты уже куплены — чисть дубликаты в кузницу', 13, COLORS.dim).setWordWrapWidth(GAME_WIDTH - 60, false));
      y += 54;
    } else {
      for (const o of forgeOpts) {
        if (y + 72 > GAME_HEIGHT - TOP_H - 10) break;
        this.content.add(this.forgeRow(y + 28, o));
        y += 64;
      }
    }

    y += 10;
    this.content.add(label(this, 28, y, `♻  ПРОДАЖА ДУБЛИКАТОВ (${Math.round(SELL_RATE * 100)}%)`, 15, COLORS.text, 0));
    y += 30;

    const inv = session.profile.inventory;
    const dups = CHIPS.filter((c) => (inv[c.id] ?? 0) >= 2).sort(
      (a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity),
    );
    if (dups.length === 0) {
      this.content.add(label(this, GAME_WIDTH / 2, y + 20, 'Дубликатов нет — фармите выигрыши!', 13, COLORS.dim));
      y += 54;
    } else {
      for (const c of dups) {
        this.sellRow(y + 28, c, inv[c.id] ?? 0);
        y += 64;
      }
    }

    y += 20;
    makeScroll(this, this.content, { x: 0, y: TOP_H, width: GAME_WIDTH, height: GAME_HEIGHT - TOP_H - 6 }, y);
  }

  /* ───────────────────────── shop (Telegram Stars) ───────────────────────── */

  /**
   * Chip packs + donation tiers bought with **Telegram Stars** (⭐).
   * Returns the y after the section so the caller can keep stacking content.
   */
  private shopSection(y: number): number {
    this.content.add(label(this, 28, y, '⭐  ФИШКИ ЗА ЗВЁЗДЫ TELEGRAM', 16, COLORS.gold, 0));
    y += 30;

    const gap = 12;
    const full = GAME_WIDTH - 40;
    const cardW = (full - gap) / 2;
    const left = 20 + cardW / 2;
    const right = left + cardW + gap;

    const cardH = 104;
    const rowH = 112;
    this.packs.forEach((pack, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = col === 0 ? left : right;
      this.shopCard(x, y + cardH / 2 + row * rowH, cardW, pack);
    });
    y += cardH / 2 + Math.ceil(this.packs.length / 2) * rowH - rowH / 2 + cardH / 2 + 14;

    // Donations.
    this.content.add(label(this, 28, y, '❤️  ПОДДЕРЖАТЬ ИГРУ', 15, COLORS.text, 0));
    y += 34;
    const tierW = (full - gap * 2) / 3;
    DONATE_TIERS.forEach((tier, i) => {
      const x = 20 + tierW / 2 + i * (tierW + gap);
      const b = new Button(
        this,
        x,
        y + 22,
        `${tier.emoji} ${tier.stars}⭐`,
        () => void this.doBuyPack(tier, tier.stars, tier.chips),
        { width: tierW, height: 44, variant: 'magenta', fontSize: 13 },
      );
      this.content.add(b);
    });
    y += 60;

    if (!isTelegram()) {
      this.content.add(
        label(this, GAME_WIDTH / 2, y, 'Покупки за ⭐ работают внутри Telegram', 11, COLORS.dim).setOrigin(0.5, 0),
      );
      y += 28;
    }
    y += 10;
    return y;
  }

  private shopCard(x: number, y: number, w: number, pack: ChipPack): void {
    const card = this.add.container(x, y);
    this.content.add(card);

    card.add(panel(this, 0, 0, w, 104, COLORS.panelAlt, 16, { rim: COLORS.strokeGold, rimAlpha: 0.75, glow: COLORS.goldDeep }));
    card.add(glowSprite(this, -w / 2 + 30, -10, COLORS.goldNum, 0.85, 0.28));

    card.add(label(this, -w / 2 + 30, -10, pack.emoji, 28));
    card.add(label(this, -w / 2 + 56, -26, pack.title, 13, COLORS.text, 0).setOrigin(0, 0.5));
    card.add(label(this, -w / 2 + 56, -4, `+${formatChips(pack.chips)} 🪙`, 16, COLORS.goldText, 0).setOrigin(0, 0.5));

    card.add(
      new Button(this, 0, 32, `Купить · ${pack.stars}⭐`, () => void this.doBuyPack(pack), {
        width: w - 28,
        height: 46,
        variant: 'gold',
        fontSize: 11,
        glow: true,
      }),
    );
  }

  /** Kick off a Stars purchase: create the invoice, then open it. */
  private async doBuyPack(pack: ChipPack, stars?: number, chips?: number): Promise<void> {
    if (this.net.status !== 'online') {
      this.showToast('Магазин недоступен без связи', COLORS.redDeep);
      return;
    }
    const res = await this.net.buyPack(pack, { stars, chips });
    if (res.error || !res.orderId) {
      this.showToast('Не удалось создать счёт', COLORS.redDeep);
      return;
    }
    if (res.devMode) {
      // No bot token: simulate a successful payment so the flow is testable.
      const granted = await this.net.devGrant(res.orderId);
      if (granted.ok) this.showToast(`+${granted.chips ?? 0} 🪙 (демо-оплата)`, COLORS.emeraldDeep);
      else this.showToast('Демо-оплата не прошла', COLORS.redDeep);
      return;
    }
    if (!res.link) {
      this.showToast('Ссылка на оплату не получена', COLORS.redDeep);
      return;
    }
    const status = await openInvoice(res.link);
    if (status === 'paid') this.showToast('Оплачено! Фишки зачисляются…', COLORS.emeraldDeep);
    else if (status === 'cancelled') this.showToast('Оплата отменена', COLORS.violetDeep);
    else if (status === 'failed') this.showToast('Оплата не прошла', COLORS.redDeep);
    else this.showToast('Завершите оплату в Telegram', COLORS.goldDeep);
  }

  /* ───────────────────────── bita card ───────────────────────── */

  private bitaCard(y: number, b: BitaDef): void {
    const p = session.profile;
    const owned = p.ownedBitas.includes(b.id);
    const equipped = p.equippedBita === b.id;
    const level = bitaLevel(p, b.id);
    const stats = effectiveBita(b, level);
    const rc = rarityColor(b.rarity);

    const cardH = 140;
    const card = this.add.container(GAME_WIDTH / 2, y);
    this.content.add(card);

    card.add(
      panel(this, 0, 0, GAME_WIDTH - 40, cardH, COLORS.panel, 16, {
        rim: rc,
        rimAlpha: owned ? 0.55 : 0.85,
        glow: owned ? undefined : rc,
      }),
    );

    // Face.
    const av = this.add.circle(-186, 0, 27, darken(rc, 0.15), 1);
    av.setStrokeStyle(2.5, lighten(rc, 0.5), 0.95);
    card.add(av);
    card.add(label(this, -186, 0, b.face, 26));

    // Name + stats.
    card.add(label(this, -146, -24, b.name, 15, COLORS.text, 0));
    card.add(
      label(this, -146, -2, `⚡ сила +${stats.power.toFixed(1)}    🎁 редк. ${Math.round(stats.rareChance * 100)}%`, 11, COLORS.dim, 0),
    );
    card.add(label(this, -146, 18, owned ? `уровень ${level}` : 'не куплена', 10, COLORS.dim, 0));

    // Power bar.
    const barW = 170;
    const ratio = Math.min(1, stats.power / MAX_POWER);
    const bar = this.add.graphics();
    bar.fillStyle(0x000000, 0.4);
    bar.fillRoundedRect(-146, 32, barW, 7, 4);
    bar.fillGradientStyle(COLORS.cyan, COLORS.emerald, COLORS.emeraldDeep, COLORS.emeraldDark, 1);
    bar.fillRoundedRect(-146, 32, Math.max(barW * ratio, 7), 7, 4);
    card.add(bar);

    // Action.
    if (!owned) {
      const afford = canAfford(p, b.price);
      card.add(
        new Button(this, 140, 0, `${b.price} 🪙`, () => this.doBuy(b.id), {
          width: 130,
          height: 52,
          variant: afford ? 'gold' : 'ghost',
          fontSize: 15,
          glow: afford,
        }),
      );
    } else if (equipped) {
      const maxed = level >= FORGE.MAX_LEVEL;
      const cost = upgradeCost(level);
      const afford = maxed || forgePoints(p) >= cost;
      card.add(
        new Button(
          this,
          140,
          -24,
          maxed ? '✓ МАКС.' : `⬆ ${cost}⚒`,
          () => this.doUpgrade(b.id),
          { width: 124, height: 44, variant: afford ? 'cyan' : 'ghost', fontSize: 11, glow: afford },
        ),
      );
      card.add(
        new Button(this, 140, 24, 'ЭКИП.', () => {}, {
          width: 124,
          height: 44,
          variant: 'success',
          fontSize: 11,
          disabled: true,
        }),
      );
    } else {
      card.add(
        new Button(this, 140, -24, 'ЭКИП.', () => this.doEquip(b.id), {
          width: 124,
          height: 44,
          variant: 'cyan',
          fontSize: 12,
        }),
      );
      card.add(
        new Button(this, 140, 24, `⬆ ${upgradeCost(level)}⚒`, () => this.doUpgrade(b.id), {
          width: 124,
          height: 44,
          variant: 'ghost',
          fontSize: 11,
        }),
      );
    }
  }


  /* ───────────────────────── forge row ───────────────────────── */

  private forgeRow(y: number, o: CraftOption): Phaser.GameObjects.Container {
    const row = this.add.container(GAME_WIDTH / 2, y);
    this.content.add(row);
    panel(this, 0, 0, GAME_WIDTH - 40, 56, COLORS.panelAlt, 12, { rim: COLORS.cyan, rimAlpha: 0.5 });
    row.add(label(this, -188, 0, o.bita.face, 20));
    row.add(label(this, -148, 0, o.bita.name, 13, COLORS.text, 0).setWordWrapWidth(130, true));
    row.add(label(this, -30, 0, `сила +${o.bita.power.toFixed(1)}`, 11, COLORS.dim, 0));
    row.add(
      new Button(this, 88, 0, o.affordable ? `КРАФТ · ${o.cost}⚒` : `${o.cost}⚒`, () => this.doCraft(o.bita.id), {
        width: 136,
        height: 44,
        variant: o.affordable ? 'cyan' : 'ghost',
        fontSize: 11,
        glow: o.affordable,
      }),
    );
    row.setSize(GAME_WIDTH - 40, 56);
    row.setInteractive(new Phaser.Geom.Rectangle(-(GAME_WIDTH - 40) / 2, -28, GAME_WIDTH - 40, 56), Phaser.Geom.Rectangle.Contains);
    row.on('pointerover', () => this.tooltip.hide());
    row.on('pointerout', () => this.tooltip.hide());
    return row;
  }

  /* ───────────────────────── sell row ───────────────────────── */

  private sellRow(y: number, c: ChipDef, count: number): void {
    const rc = rarityColor(c.rarity);
    const row = this.add.container(GAME_WIDTH / 2, y);
    this.content.add(row);

    const rowH = 56;
    panel(this, 0, 0, GAME_WIDTH - 40, rowH, COLORS.panelAlt, 12, { rim: rc, rimAlpha: 0.5 });
    row.add(label(this, -188, 0, c.face, 20));
    row.add(label(this, -158, 0, c.name, 12, COLORS.text, 0).setWordWrapWidth(170, true));
    row.add(label(this, 50, 0, `x${count}`, 12, COLORS.dim, 1));
    row.add(
      new Button(this, 138, 0, `Продать · ${Math.floor(c.value * SELL_RATE)}`, () => this.doSell(c.id), {
        width: 148,
        height: 44,
        variant: 'danger',
        fontSize: 11,
        glow: false,
      }),
    );

    // Hovering the row (anywhere but the sell button) explains the chip.
    row.setSize(GAME_WIDTH - 40, rowH);
    row.setInteractive(
      new Phaser.Geom.Rectangle(-(GAME_WIDTH - 40) / 2, -rowH / 2, GAME_WIDTH - 40, rowH),
      Phaser.Geom.Rectangle.Contains,
    );
    row.on('pointerover', () => this.showChipTooltip(c, count));
    row.on('pointerout', () => this.tooltip.hide());
  }

  /** Chip info for a sell row; uses the pointer so scrolling cannot misplace it. */
  private showChipTooltip(def: ChipDef, count: number): void {
    if (!getSettings().tooltips) return;
    const pointer = this.input.activePointer;
    this.tooltip.show(
      [
        { text: def.name, title: true, color: COLORS.text },
        { text: `${rarityLabel(def.rarity)} · ${def.series}`, color: css(rarityColor(def.rarity)) },
        { text: `вес ${def.weight.toFixed(1)} · ценность ${def.value} 🪙`, color: COLORS.dim },
        { text: `в коллекции: ${count}`, color: TEXT_COLORS.green },
      ],
      rarityColor(def.rarity),
      pointer.x,
      pointer.y,
    );
  }

  /* ───────────────────────── actions ───────────────────────── */

  private doBuy(bitaId: string): void {
    const res = buyBita(session.profile, bitaId);
    if (!res.ok) {
      audio.error();
      this.showToast(res.reason === 'poor' ? 'Не хватает фишек' : res.reason === 'owned' ? 'Уже куплен' : 'Ошибка', COLORS.redDeep);
      return;
    }
    session.save();
    audio.buy();
    this.showToast('Бита куплена!', COLORS.emeraldDeep);
    this.rebuild();
  }

  private doEquip(bitaId: string): void {
    equipBita(session.profile, bitaId);
    session.save();
    audio.click();
    this.showToast('Бита экипирована', COLORS.cyanDeep);
    this.rebuild();
  }

  private doCraft(bitaId: string): void {
    const res = craftBita(session.profile, bitaId);
    if (!res.ok) {
      audio.error();
      this.showToast(craftFailText(res.reason), COLORS.redDeep);
      return;
    }
    session.save();
    audio.buy();
    this.showToast(`Крафт: ${res.bita.face} ${res.bita.name} (сплавлено ${res.consumed})`, COLORS.emeraldDeep);
    this.rebuild();
  }

  private doUpgrade(bitaId: string): void {
    const res = upgradeBita(session.profile, bitaId);
    if (!res.ok) {
      audio.error();
      this.showToast(upgradeFailText(res.reason), COLORS.redDeep);
      return;
    }
    session.save();
    audio.buy();
    this.showToast(`Бита улучшена · уровень ${bitaLevel(session.profile, bitaId)}`, COLORS.emeraldDeep);
    this.rebuild();
  }

  private doSell(defId: string): void {
    const res = sellChip(session.profile, defId, 1);
    questEvent(session.profile, 'sells', res.sold);
    session.save();
    if (res.sold > 0) {
      audio.coin();
      this.showToast(`Продано · +${res.credited} 🪙`, COLORS.goldDeep);
    }
    this.rebuild();
  }

  /** Rebuild the scrollable body in place (keeps the scene smooth). */
  private rebuild(): void {
    this.content.destroy(true);
    this.updateBal();
    this.buildContent();
  }

  private showToast(message: string, color: number = COLORS.goldDeep): void {
    this.toastBox?.destroy(true);
    this.toastBox = toast(this, message, color);
  }
}

function rarityIndex(r: ChipDef['rarity']): number {
  return ['common', 'rare', 'epic', 'legendary'].indexOf(r);
}

function craftFailText(reason: 'unknown' | 'owned' | 'poor' | 'max' | 'not_owned'): string {
  switch (reason) {
    case 'unknown':
      return 'Неизвестная бита';
    case 'owned':
      return 'Бита уже куплена';
    case 'not_owned':
      return 'У вас нет этой биты';
    case 'max':
      return 'Бита уже на максимальном уровне';
    default:
      return 'Не хватает дубликатов для кузни';
  }
}

function upgradeFailText(reason: 'unknown' | 'owned' | 'poor' | 'max' | 'not_owned'): string {
  switch (reason) {
    case 'unknown':
      return 'Неизвестная бита';
    case 'not_owned':
      return 'Этой биты у вас нет';
    case 'max':
      return 'Бита уже на максимальном уровне';
    default:
      return 'Не хватает дубликатов для улучшения';
  }
}

function formatChips(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return String(n);
}
