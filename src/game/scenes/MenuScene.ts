import Phaser from 'phaser';
import { ECONOMY, GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS, STAKE_OPTIONS } from '../Constants';
import { session } from '../State';
import { COLORS, FONT_FAMILY, TEXT_COLORS, lighten } from '../ui/Theme';
import { Button, ChipToken, label, modal, panel, toast, type Modal } from '../ui/Widgets';
import {
  burst,
  coinRain,
  countUp,
  flash,
  floatText,
  glowSprite,
  installBackground,
  makeScroll,
  popIn,
  rayBurst,
} from '../ui/Fx';
import { audio } from '../ui/Audio';
import { getBita } from '../data/Bitas';
import { CHIPS, getChip } from '../data/Chips';
import { uniqueChips } from '../systems/Economy';
import { getSettings, toggleMuted, updateSettings, cycleUiSize, type UiSize } from '../systems/Settings';
import { claimDaily, spinWheel, type WheelPrize } from '../systems/Progression';
import { claimQuest, questViews, questSummary } from '../systems/Quests';
import { ACHIEVEMENTS } from '../data/Achievements';
import { net } from '../net/Net';
import { isFullscreen, toggleFullscreen } from '../ui/Shell';

/**
 * Main menu — the game's "lobby": animated casino background, balance HUD,
 * primary play action, navigation grid and the two jackpot faucets
 * (daily reward + animated fortune wheel).
 */
export class MenuScene extends Phaser.Scene {
  private balanceText!: Phaser.GameObjects.Text;
  private uniqueText!: Phaser.GameObjects.Text;
  private bitaText!: Phaser.GameObjects.Text;
  private progressBar!: Phaser.GameObjects.Graphics;
  private dailySub?: Phaser.GameObjects.Text;
  private displayedBalance = session.profile.balance;
  private toastBox?: Phaser.GameObjects.Container;

  constructor() {
    super(SCENE_KEYS.MENU);
  }

  create(): void {
    this.displayedBalance = session.profile.balance;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    installBackground(this);
    this.buildTitle();
    this.buildHud();
    this.buildActions();
    this.buildFaucets();
    this.buildFooter();

    // Purchases (Telegram Stars) can land while the menu is open — animate it in.
    const off = net().on('wallet:grant', () => this.refreshHud());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
  }

  /* ───────────────────────── title ───────────────────────── */

  private buildTitle(): void {
    const cx = GAME_WIDTH / 2;

    glowSprite(this, cx, 78, COLORS.goldNum, 3.2, 0.22).setDepth(-1);
    glowSprite(this, cx, 78, COLORS.violetDeep, 4.2, 0.08).setDepth(-1);

    const title = this.add
      .text(cx, 74, 'CHIPS', {
        fontFamily: FONT_FAMILY,
        fontSize: '60px',
        color: COLORS.gold,
        fontStyle: 'bold',
        letterSpacing: 4,
      })
      .setOrigin(0.5)
      .setDepth(10);
    title.setStroke('#2a1a08', 7);
    title.setShadow(0, 4, '#00000088', 10, true, true);

    this.tweens.add({
      targets: title,
      scaleX: 1.02,
      scaleY: 1.03,
      duration: 1800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    popIn(this, title, 0);

    const sub = label(this, cx, 118, 'сотки · фишки · кэпсы', 13, COLORS.dim);
    sub.setAlpha(0.95);
  }

  /* ───────────────────────── HUD ───────────────────────── */

  private buildHud(): void {
    const cx = GAME_WIDTH / 2;
    const w = GAME_WIDTH - 40;
    const y = 178;
    const h = 94;

    panel(this, cx, y, w, h, COLORS.panel, 22, {
      glow: COLORS.violetDeep,
      rim: COLORS.goldNum,
      rimAlpha: 0.35,
    });

    // Coin + balance.
    glowSprite(this, 62, y, COLORS.goldNum, 1.0, 0.4);
    this.add.text(62, y, '🪙', { fontFamily: FONT_FAMILY, fontSize: '26px' }).setOrigin(0.5);
    this.balanceText = this.add
      .text(92, y - 14, '0', {
        fontFamily: FONT_FAMILY,
        fontSize: '28px',
        color: COLORS.gold,
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5);
    this.balanceText.setShadow(0, 2, '#000000aa', 4);
    label(this, 94, y + 14, 'фишек на балансе', 12, COLORS.dim, 0);

    // Collection progress (right column).
    const right = GAME_WIDTH - 44;
    this.uniqueText = label(this, right, y - 28, '', 14, COLORS.text, 1);
    this.progressBar = this.add.graphics();
    this.bitaText = label(this, right, y + 24, '', 12, COLORS.gold, 1);

    this.refreshHud(false);
  }

  private refreshHud(animate = true): void {
    const p = session.profile;
    const prev = this.displayedBalance;
    this.displayedBalance = p.balance;
    if (animate) countUp(this, this.balanceText, prev, p.balance, 600);
    else this.balanceText.setText(String(p.balance));

    const uniq = uniqueChips(p);
    const total = CHIPS.length;
    this.uniqueText.setText(`🎒  ${uniq}/${total}`);

    const barW = 150;
    const x0 = GAME_WIDTH - 44 - barW;
    const y0 = 178 + 4;
    const ratio = total > 0 ? uniq / total : 0;
    this.progressBar.clear();
    this.progressBar.fillStyle(0x000000, 0.4);
    this.progressBar.fillRoundedRect(x0, y0, barW, 8, 4);
    if (ratio > 0) {
      this.progressBar.fillGradientStyle(
        lighten(COLORS.emeraldDeep, 0.3),
        COLORS.emeraldDeep,
        COLORS.emeraldDark,
        COLORS.emeraldDark,
        1,
      );
      this.progressBar.fillRoundedRect(x0, y0, Math.max(barW * ratio, 8), 8, 4);
    }

    const bita = p.equippedBita ? getBita(p.equippedBita) : null;
    this.bitaText.setText(bita ? `${bita.face} ${bita.name}` : '✊ без биты');
    this.bitaText.setColor(bita ? COLORS.gold : COLORS.dim);
  }

  /* ───────────────────────── actions ───────────────────────── */

  private buildActions(): void {
    const cx = GAME_WIDTH / 2;
    const full = GAME_WIDTH - 40;

    glowSprite(this, cx, 306, COLORS.goldNum, 2.2, 0.2).setDepth(5);
    const play = new Button(this, cx, 306, '🎯  ИГРАТЬ', () => this.openStakeDialog(), {
      width: full,
      height: 82,
      variant: 'gold',
      fontSize: 26,
      radius: 22,
      glow: true,
    });
    play.setDepth(20);
    play.pulse();

    const gap = 12;
    const half = (full - gap) / 2;
    const lx = cx - half / 2 - gap / 2;
    const rx = cx + half / 2 + gap / 2;

    new Button(this, lx, 404, '🎒  Коллекция', () => this.scene.start(SCENE_KEYS.COLLECTION), { width: half, height: 58, variant: 'cyan', fontSize: 15 });
    new Button(this, rx, 404, '🏪  Маркет', () => this.scene.start(SCENE_KEYS.MARKET), { width: half, height: 58, variant: 'magenta', fontSize: 15 });
    new Button(this, lx, 476, '🏆  Рейтинг', () => this.scene.start(SCENE_KEYS.LEADERBOARD), { width: half, height: 58, variant: 'ghost', fontSize: 15 });
    new Button(this, rx, 476, '🏅  Достижения', () => this.openAchievements(), { width: half, height: 58, variant: 'ghost', fontSize: 15 });

    // Multiplayer entry point — the "ИГРЫ ОНЛАЙН" lobby.
    const online = new Button(this, cx, 548, '🌐   ИГРЫ ОНЛАЙН', () => this.scene.start(SCENE_KEYS.ONLINE), {
      width: full,
      height: 60,
      variant: 'success',
      fontSize: 18,
      glow: true,
    });
    online.pulse();
  }

  /* ───────────────────────── faucets ───────────────────────── */

  private buildFaucets(): void {
    const cx = GAME_WIDTH / 2;
    const gap = 12;
    const full = GAME_WIDTH - 40;
    const cardW = (full - gap * 2) / 3;
    const y = 664;
    const h = 116;

    this.dailySub = this.casinoCard(cx - cardW - gap, y, cardW, h, {
      title: 'ЕЖЕДНЕВНО',
      icon: '🎁',
      sub: this.dailySubText(),
      accent: COLORS.emeraldDeep,
      onClick: () => this.doDaily(),
    });
    this.casinoCard(cx, y, cardW, h, {
      title: 'КОЛЕСО',
      icon: '🎡',
      sub: `джекпот ×100 · ${ECONOMY.WHEEL_PRICE}🪙`,
      accent: COLORS.magentaDeep,
      onClick: () => this.doWheel(),
    });
    const questSub = this.casinoCard(cx + cardW + gap, y, cardW, h, {
      title: 'ЗАДАНИЯ',
      icon: '📜',
      sub: this.questSubText(),
      accent: COLORS.violetDeep,
      onClick: () => this.openQuests(),
    });
    void questSub;
  }

  private questSubText(): string {
    const q = questSummary(session.profile);
    if (q.total === 0) return 'нет заданий';
    const best = q.done > 0 ? ` · ${q.done} готово` : '';
    return `выполнено ${q.done}/${q.total}${best}`;
  }

  private claimQuest(id: string): void {
    const res = claimQuest(session.profile, id);
    session.save();
    if (res.ok) audio.coin();
    else audio.error();
    this.refreshHud();
  }

  private dailySubText(): string {
    const stats = session.profile.stats;
    const elapsed = Date.now() - stats.lastDaily;
    const DAY = 24 * 60 * 60 * 1000;
    if (stats.lastDaily > 0 && elapsed < DAY) {
      const h = Math.max(0, Math.floor((DAY - elapsed) / 3_600_000));
      return `серия ${stats.dailyStreak} · через ${h}ч`;
    }
    return `серия ${stats.dailyStreak} · готово!`;
  }

  private casinoCard(
    x: number,
    y: number,
    w: number,
    h: number,
    opts: { title: string; icon: string; sub: string; accent: number; onClick: () => void },
  ): Phaser.GameObjects.Text {
    panel(this, x, y, w, h, COLORS.panel, 18, {
      rim: lighten(opts.accent, 0.4),
      rimAlpha: 0.85,
      glow: opts.accent,
    }).setDepth(9);
    glowSprite(this, x, y - 12, opts.accent, 1.2, 0.3).setDepth(10);

    const strip = this.add.graphics().setDepth(11);
    strip.fillGradientStyle(lighten(opts.accent, 0.35), opts.accent, opts.accent, lighten(opts.accent, 0.1), 1);
    strip.fillRoundedRect(x - w / 2 + 10, y - h / 2 + 9, w - 20, 6, 3);

    this.add.text(x, y - 8, opts.icon, { fontFamily: FONT_FAMILY, fontSize: '34px' }).setOrigin(0.5).setDepth(12);
    const t = this.add
      .text(x, y + 28, opts.title, { fontFamily: FONT_FAMILY, fontSize: '13px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(12);
    t.setShadow(0, 2, '#000000aa', 3);
    t.setWordWrapWidth(w - 16, false);
    const sub = label(this, x, y + 46, opts.sub, 10, COLORS.dim);
    sub.setWordWrapWidth(w - 16, false);
    sub.setDepth(12);

    const zone = this.add
      .zone(x, y, w, h)
      .setOrigin(0.5)
      .setDepth(13)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerup', opts.onClick);
    return sub;
  }

  private buildFooter(): void {
    new Button(this, GAME_WIDTH / 2, GAME_HEIGHT - 34, 'сбросить прогресс', () => this.confirmReset(), {
      width: 200,
      height: 34,
      variant: 'ghost',
      fontSize: 12,
      radius: 10,
      glow: false,
    }).setAlpha(0.7);

    // Sound toggle — synthesised SFX only, so a single mute switch is enough.
    const soundBtn = new Button(this, 56, GAME_HEIGHT - 34, this.soundLabel(), () => {
      toggleMuted();
      soundBtn.setText(this.soundLabel());
      if (!getSettings().muted) audio.click();
    }, { width: 64, height: 34, variant: 'ghost', fontSize: 15, radius: 10, glow: false });
    soundBtn.setAlpha(0.8);

    // Settings: sound/motion/tooltips/size/fullscreen in one place.
    new Button(this, GAME_WIDTH - 56, GAME_HEIGHT - 34, '⚙', () => this.openSettings(), {
      width: 64,
      height: 34,
      variant: 'ghost',
      fontSize: 16,
      radius: 10,
      glow: false,
    }).setAlpha(0.8);
  }

  /* ───────────────────────── settings ───────────────────────── */

  private uiSizeLabel(size: UiSize): string {
    return size === 'compact' ? 'Компактный' : size === 'large' ? 'Большой' : 'Обычный';
  }

  private openSettings(): void {
    const { root, close }: Modal = modal(this, 'НАСТРОЙКИ', { height: 486 });
    const s = getSettings();
    const rowX = -124;
    const btnX = 98;
    const rowH = 54;
    const firstY = -132;
    let row = 0;
    const rowY = (): number => firstY + row++ * rowH;

    const title = (text: string, y: number): void => {
      root.add(label(this, rowX, y, text, 13, COLORS.text, 0).setOrigin(0, 0.5));
    };

    const ySound = rowY();
    title('🔊  Звук', ySound);
    const sound = new Button(this, btnX, ySound, s.muted ? 'Выкл' : 'Вкл', () => {
      const muted = updateSettings({ muted: !getSettings().muted }).muted;
      sound.setText(muted ? 'Выкл' : 'Вкл');
      if (!muted) audio.click();
    }, { width: 148, height: 36, variant: 'ghost', fontSize: 13, radius: 12 });
    root.add(sound);

    const yMotion = rowY();
    title('✨  Анимации', yMotion);
    const motion = new Button(this, btnX, yMotion, s.reduceMotion ? 'Меньше' : 'Полные', () => {
      const reduceMotion = updateSettings({ reduceMotion: !getSettings().reduceMotion }).reduceMotion;
      motion.setText(reduceMotion ? 'Меньше' : 'Полные');
    }, { width: 148, height: 36, variant: 'ghost', fontSize: 13, radius: 12 });
    root.add(motion);

    const yTips = rowY();
    title('💬  Подсказки', yTips);
    const tips = new Button(this, btnX, yTips, s.tooltips ? 'Вкл' : 'Выкл', () => {
      const tooltips = updateSettings({ tooltips: !getSettings().tooltips }).tooltips;
      tips.setText(tooltips ? 'Вкл' : 'Выкл');
    }, { width: 148, height: 36, variant: 'ghost', fontSize: 13, radius: 12 });
    root.add(tips);

    const ySize = rowY();
    title('🖥  Размер экрана', ySize);
    const size = new Button(this, btnX, ySize, this.uiSizeLabel(getSettings().uiSize), () => {
      size.setText(this.uiSizeLabel(cycleUiSize()));
    }, { width: 148, height: 36, variant: 'ghost', fontSize: 13, radius: 12 });
    root.add(size);

    const yFull = rowY();
    title('⛶  Полный экран', yFull);
    const full = new Button(this, btnX, yFull, isFullscreen() ? 'Выйти' : 'Войти', () => {
      void toggleFullscreen().then((on) => full.setText(on ? 'Выйти' : 'Войти'));
    }, { width: 148, height: 36, variant: 'ghost', fontSize: 13, radius: 12 });
    root.add(full);

    root.add(
      label(
        this,
        0,
        160,
        'Space — удар · ←↑↓→ — прицел · 1–3 — спец-удары\nEsc — назад · F — полный экран',
        10,
        COLORS.dim,
      ),
    );
    root.add(new Button(this, 0, 204, 'ГОТОВО', () => close(), { width: 180, height: 44, variant: 'gold', fontSize: 15 }));
  }

  private soundLabel(): string {
    return getSettings().muted ? '🔇' : '🔊';
  }

  /* ───────────────────────── daily ───────────────────────── */

  private doDaily(): void {
    const res = claimDaily(session.profile, session.rng);
    session.save();
    if (!res.ok) {
      const h = Math.floor(res.waitMs / 3_600_000);
      const m = Math.floor((res.waitMs % 3_600_000) / 60_000);
      audio.error();
      this.showToast(`Следующая награда через ${h}ч ${m}мин`, COLORS.cyanDeep);
      return;
    }
    audio.coin();
    this.refreshHud();
    this.dailySub?.setText(this.dailySubText());
    this.showDailyModal(res.reward, res.streak);
  }

  private showDailyModal(reward: number, streak: number): void {
    const { root, close } = modal(this, 'ЕЖЕДНЕВНЫЙ БОНУС', { height: 520 });

    root.add(label(this, 0, -174, `🔥  Серия: ${streak} дн.`, 15, COLORS.gold));

    // 7-day streak strip.
    const days = 7;
    const cy = -72;
    for (let i = 0; i < days; i++) {
      const dx = (i - (days - 1) / 2) * 52;
      const done = i < Math.min(streak, days);
      const g = this.add.graphics();
      g.fillStyle(done ? COLORS.emeraldDeep : COLORS.panelAlt, 1);
      g.fillRoundedRect(dx - 22, cy - 28, 44, 56, 12);
      g.lineStyle(2, done ? lighten(COLORS.emeraldDeep, 0.4) : COLORS.stroke, 0.9);
      g.strokeRoundedRect(dx - 22, cy - 28, 44, 56, 12);
      root.add(g);
      root.add(label(this, dx, cy - 8, `${i + 1}`, 12, done ? COLORS.text : COLORS.dim));
      root.add(label(this, dx, cy + 12, done ? '✓' : '·', 14, done ? COLORS.gold : COLORS.dim));
    }

    // Reward reveal box.
    const rewardY = 46;
    const box = this.add.graphics();
    box.fillGradientStyle(lighten(COLORS.goldDeep, 0.25), COLORS.goldDeep, COLORS.goldDark, COLORS.goldDark, 1);
    box.fillRoundedRect(-110, rewardY - 36, 220, 72, 16);
    box.lineStyle(2, COLORS.goldNum, 0.9);
    box.strokeRoundedRect(-110, rewardY - 36, 220, 72, 16);
    root.add(box);
    const rText = label(this, 0, rewardY, `+${reward}  🪙`, 26, COLORS.text);
    rText.setShadow(0, 3, '#000000aa', 5);
    root.add(rText);

    const sub = label(this, 0, 108, 'Приходи каждый день за наградой', 11, COLORS.dim);
    sub.setWordWrapWidth(360, false);
    root.add(sub);

    burst(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + rewardY, { count: 26, color: COLORS.goldNum, speed: 260, depth: 2400 });
    coinRain(this, 18, 2400);

    root.add(new Button(this, 0, 170, 'ЗАБРАТЬ', () => close(), { width: 220, height: 52, variant: 'gold' }));
  }

  /* ───────────────────────── wheel ───────────────────────── */

  private doWheel(): void {
    const res = spinWheel(session.profile, session.rng);
    session.save();
    if (!res.ok || !res.prize) {
      audio.error();
      this.showToast(`Нужно ${ECONOMY.WHEEL_PRICE} фишек для прокрута`, COLORS.redDeep);
      return;
    }
    this.refreshHud();
    this.showWheelModal(res.prize);
  }

  private showWheelModal(prize: WheelPrize): void {
    const { root, close } = modal(this, 'КОЛЕСО ФОРТУНЫ', { height: 640 });

    const labels = ['10 🪙', '20 🪙', '⭐', '50 🪙', '💎', '10 🪙', '🐉', '20 🪙'];
    const colors = [
      COLORS.violetDeep,
      COLORS.cyanDeep,
      COLORS.emeraldDeep,
      COLORS.magentaDeep,
      COLORS.goldDark,
      COLORS.violetDeep,
      COLORS.redDeep,
      COLORS.cyanDeep,
    ];
    const segs = labels.length;
    const R = 118;
    const cy = -40;

    const wheel = this.add.container(0, cy);
    const disc = this.add.graphics();
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2 - Math.PI / 2;
      disc.fillStyle(colors[i], 1);
      disc.beginPath();
      disc.moveTo(0, 0);
      disc.arc(0, 0, R, a0, a1, false);
      disc.closePath();
      disc.fillPath();
      disc.lineStyle(2, 0x000000, 0.22);
      disc.strokePath();
    }
    disc.lineStyle(5, COLORS.goldNum, 1);
    disc.strokeCircle(0, 0, R);
    disc.fillStyle(COLORS.panel, 1);
    disc.fillCircle(0, 0, 24);
    disc.lineStyle(3, COLORS.goldNum, 1);
    disc.strokeCircle(0, 0, 24);
    wheel.add(disc);

    for (let i = 0; i < segs; i++) {
      const mid = ((i + 0.5) / segs) * Math.PI * 2 - Math.PI / 2;
      const t = this.add
        .text(Math.cos(mid) * R * 0.62, Math.sin(mid) * R * 0.62, labels[i], {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
          color: '#ffffff',
          fontStyle: 'bold',
          align: 'center',
        })
        .setOrigin(0.5)
        .setRotation(mid + Math.PI / 2);
      t.setShadow(0, 2, '#00000099', 3);
      wheel.add(t);
    }
    wheel.add(label(this, 0, 0, '🎡', 20));
    root.add(wheel);
    root.add(glowSprite(this, 0, cy, COLORS.goldNum, 2.0, 0.16));

    // Pointer at the top.
    const ptr = this.add.graphics();
    ptr.fillStyle(COLORS.goldNum, 1);
    ptr.fillTriangle(-12, cy - R - 16, 12, cy - R - 16, 0, cy - R + 8);
    ptr.lineStyle(2, 0xffffff, 0.85);
    ptr.strokeTriangle(-12, cy - R - 16, 12, cy - R - 16, 0, cy - R + 8);
    root.add(ptr);

    // Map the (already rolled) prize onto a matching visual segment.
    let target = 1;
    if (prize.kind === 'chip') target = 6;
    else if (prize.amount >= 100) target = 4;
    else if (prize.amount >= 50) target = 3;
    else if (prize.amount >= 20) target = 1;
    else target = 0;

    const segAngle = 360 / segs;
    const desired = 360 * 5 - (target + 0.5) * segAngle + 360;

    const hintText = label(this, 0, 128, 'Нажмите, чтобы крутануть', 13, COLORS.dim);
    hintText.setWordWrapWidth(360, false);
    root.add(hintText);
    const resultText = label(this, 0, 164, '', 14, COLORS.gold);
    resultText.setWordWrapWidth(360, false);
    resultText.setAlign('center');
    resultText.setOrigin(0.5);
    resultText.setVisible(false);
    root.add(resultText);

    const spinBtn = new Button(this, 0, 224, 'КРУТИТЬ!', () => {
      spinBtn.destroy();
      hintText.setText('Крутится…');
      this.tweens.add({
        targets: wheel,
        angle: desired,
        duration: 4200,
        ease: 'Cubic.easeOut',
        onComplete: () => this.revealWheelPrize(prize, hintText, resultText, root, close),
      });
    }, { width: 220, height: 52, variant: 'gold' });
    root.add(spinBtn);
  }

  private revealWheelPrize(
    prize: WheelPrize,
    hintText: Phaser.GameObjects.Text,
    resultText: Phaser.GameObjects.Text,
    root: Phaser.GameObjects.Container,
    close: () => void,
  ): void {
    const cxp = GAME_WIDTH / 2;
    const cyp = GAME_HEIGHT / 2;

    hintText.setVisible(false);
    resultText.setVisible(true);
    if (prize.kind === 'chips') {
      resultText.setText(`ВЫИГРЫШ:  ${prize.amount} 🪙`);
      resultText.setColor(COLORS.gold);
      if (prize.jackpot) {
        rayBurst(this, cxp, cyp, COLORS.goldNum, 520, 2005).setBlendMode(Phaser.BlendModes.ADD);
        coinRain(this, 60, 2400);
        burst(this, cxp, cyp, { count: 60, color: COLORS.goldNum, speed: 340, lifespan: 900, depth: 2400 });
        floatText(this, cxp, cyp - 60, '💎 ДЖЕКПОТ!', '#ffe27a', 36, 2400);
        flash(this, 240, 255, 230, 150);
        this.cameras.main.shake(280, 0.006);
        audio.win();
      } else {
        burst(this, cxp, cyp, { count: 34, color: COLORS.goldNum, speed: 280, depth: 2400 });
        coinRain(this, 18, 2400);
        floatText(this, cxp, cyp - 60, `+${prize.amount}`, COLORS.gold, 26, 2400);
        audio.coin();
      }
      this.tweens.add({
        targets: resultText,
        scale: { from: 0.8, to: 1 },
        duration: 300,
        ease: 'Back.easeOut',
      });
    } else {
      const chip = getChip(prize.defId);
      resultText.setText(`ВЫИГРЫШ:  ${chip.name}`);
      resultText.setColor(TEXT_COLORS.magenta);
      burst(this, cxp, cyp, { count: 44, color: COLORS.magenta, speed: 300, depth: 2400 });
      floatText(this, cxp, cyp - 60, `${chip.face} ${chip.name}`, '#ff8fdb', 22, 2400);
      audio.rare();
    }

    const done = new Button(this, 0, 230, 'ЗАБРАТЬ', () => close(), { width: 220, height: 50, variant: 'success' });
    root.add(done);
    popIn(this, done, 120);
  }

  /* ───────────────────────── quests ───────────────────────── */

  private openQuests(): void {
    const { root, close } = modal(this, 'ЗАДАНИЯ', { height: 600 });
    const views = questViews(session.profile);

    const viewport = { x: 40, y: GAME_HEIGHT / 2 - 210, width: GAME_WIDTH - 80, height: 400 };
    const content = this.add.container(0, 0);
    root.add(content);

    let y = -168;
    for (const v of views) {
      const ok = v.complete;
      const rowH = 64;
      const g = this.add.graphics();
      g.fillStyle(ok && !v.claimed ? lighten(COLORS.emeraldDark, 0.15) : COLORS.panelAlt, 1);
      g.fillRoundedRect(-GAME_WIDTH / 2 + 52, y - rowH / 2, GAME_WIDTH - 104, rowH, 14);
      g.lineStyle(1.5, ok ? COLORS.emerald : COLORS.stroke, 0.7);
      g.strokeRoundedRect(-GAME_WIDTH / 2 + 52, y - rowH / 2, GAME_WIDTH - 104, rowH, 14);
      content.add(g);
      content.add(label(this, -GAME_WIDTH / 2 + 74, y, v.def.icon, 18));
      const title = label(this, -GAME_WIDTH / 2 + 98, y - 10, v.def.title, 12, ok ? COLORS.text : COLORS.dim, 0);
      title.setWordWrapWidth(GAME_WIDTH - 310, false);
      content.add(title);
      content.add(label(this, -GAME_WIDTH / 2 + 98, y + 12, `награда +${v.def.reward} 🪙`, 11, COLORS.gold, 0));
      content.add(
        new Button(
          this,
          GAME_WIDTH / 2 - 120,
          y,
          v.claimed ? 'ГОТОВО' : ok ? 'ЗАБРАТЬ' : `${v.progress}/${v.def.target}`,
          () => {
            this.claimQuest(v.def.id);
            // live refresh the row state
            const v2 = questViews(session.profile).find((q) => q.def.id === v.def.id);
            if (v2) {
              v.progress = v2.progress;
              v.claimed = v2.claimed;
              v.complete = v2.complete;
            }
          },
          { width: 118, height: 44, variant: ok ? 'gold' : 'ghost', fontSize: 10, glow: ok },
        ),
      );
      y += 72;
    }

    makeScroll(this, content, viewport, Math.abs(y) + 40, { depth: 2005 });
    root.add(new Button(this, 0, 248, 'ЗАКРЫТЬ', () => close(), { width: 180, height: 46, variant: 'ghost' }));
  }

  /* ───────────────────────── stake dialog ───────────────────────── */

  private openStakeDialog(): void {
    const stake = { value: STAKE_OPTIONS[1] as number };
    const vsAI = { value: true };

    const { root, close } = modal(this, 'НОВАЯ ПАРТИЯ', { height: 480 });

    root.add(label(this, 0, -150, 'Ставка — столько же ставит соперник', 13, COLORS.dim));

    const tokens: ChipToken[] = STAKE_OPTIONS.map((s, i) => {
      const x = (i - (STAKE_OPTIONS.length - 1) / 2) * 116;
      const token = new ChipToken(
        this,
        x,
        -86,
        `${s}`,
        s >= 50 ? COLORS.magentaDeep : s >= 20 ? COLORS.cyanDeep : COLORS.emeraldDeep,
        34,
        () => {
          stake.value = s;
          tokens.forEach((t) => t.setSelected(t === token));
        },
      );
      root.add(token);
      return token;
    });
    tokens[1].setSelected(true);

    root.add(label(this, 0, -38, 'Режим', 13, COLORS.dim));
    const modeLabel = label(this, 0, -16, '', 15, COLORS.gold);
    const refresh = (): void => {
      modeLabel.setText(vsAI.value ? '🤖   против ИИ' : '👥   вдвоём за экраном');
    };
    refresh();
    root.add(modeLabel);

    const aiBtn = new Button(this, -62, 32, '🤖  ИИ', () => {
      vsAI.value = true;
      refresh();
      aiBtn.setEnabled();
      duelBtn.setDisabled();
    }, { width: 118, height: 46, variant: 'cyan', fontSize: 14 });
    const duelBtn = new Button(this, 62, 32, '👥  Вдвоём', () => {
      vsAI.value = false;
      refresh();
      duelBtn.setEnabled();
      aiBtn.setDisabled();
    }, { width: 118, height: 46, variant: 'ghost', fontSize: 14 });
    duelBtn.setDisabled();
    root.add(aiBtn);
    root.add(duelBtn);

    root.add(label(this, 0, 82, `Баланс: ${session.profile.balance} 🪙`, 13, COLORS.dim));

    root.add(
      new Button(this, 0, 138, '🎯  НАЧАТЬ', () => {
        if (session.profile.balance < stake.value) {
          this.showToast('Недостаточно фишек для такой ставки', COLORS.redDeep);
          return;
        }
        close();
        this.scene.start(SCENE_KEYS.MATCH, { stake: stake.value, opponentIsAI: vsAI.value });
      }, { width: 220, height: 60, variant: 'gold', fontSize: 20, glow: true }),
    );
  }

  /* ───────────────────────── achievements ───────────────────────── */

  private openAchievements(): void {
    const { root, close } = modal(this, 'ДОСТИЖЕНИЯ', { height: 580 });
    const p = session.profile;

    const viewport = { x: 40, y: GAME_HEIGHT / 2 - 210, width: GAME_WIDTH - 80, height: 400 };
    const content = this.add.container(0, 0);
    root.add(content);

    let y = -168;
    for (const a of ACHIEVEMENTS) {
      const done = p.achievements.includes(a.id);
      const rowH = 64;
      const g = this.add.graphics();
      g.fillStyle(done ? lighten(COLORS.emeraldDark, 0.15) : COLORS.panelAlt, 1);
      g.fillRoundedRect(-GAME_WIDTH / 2 + 52, y - rowH / 2, GAME_WIDTH - 104, rowH, 14);
      g.lineStyle(1.5, done ? COLORS.emerald : COLORS.stroke, 0.7);
      g.strokeRoundedRect(-GAME_WIDTH / 2 + 52, y - rowH / 2, GAME_WIDTH - 104, rowH, 14);
      content.add(g);
      content.add(label(this, -GAME_WIDTH / 2 + 76, y, done ? '✅' : '🔒', 18));
      const name = label(this, -GAME_WIDTH / 2 + 102, y - 10, a.name, 13, done ? COLORS.text : COLORS.dim, 0);
      name.setWordWrapWidth(GAME_WIDTH - 280, false);
      content.add(name);
      const desc = label(this, -GAME_WIDTH / 2 + 102, y + 12, a.desc, 11, COLORS.dim, 0);
      desc.setWordWrapWidth(GAME_WIDTH - 280, false);
      content.add(desc);
      content.add(label(this, GAME_WIDTH / 2 - 68, y, `+${a.reward}`, 13, done ? COLORS.gold : COLORS.dim, 1));
      y += 72;
    }

    makeScroll(this, content, viewport, Math.abs(y) + 40, { depth: 2005 });
    root.add(new Button(this, 0, 242, 'ЗАКРЫТЬ', () => close(), { width: 180, height: 46, variant: 'ghost' }));
  }

  /* ───────────────────────── reset ───────────────────────── */

  private confirmReset(): void {
    const { root, close }: Modal = modal(this, 'СБРОСИТЬ ПРОГРЕСС?', { height: 280 });
    root.add(label(this, 0, -46, 'Вся коллекция, баланс и достижения\nбудут удалены безвозвратно.', 14, COLORS.dim));
    root.add(new Button(this, -72, 62, 'Отмена', () => close(), { width: 128, height: 50, variant: 'ghost' }));
    root.add(
      new Button(this, 72, 62, 'Сбросить', () => {
        session.reset();
        close();
        this.scene.restart();
      }, { width: 128, height: 50, variant: 'danger' }),
    );
  }

  /* ───────────────────────── helpers ───────────────────────── */

  private showToast(message: string, color: number = COLORS.goldDeep): void {
    this.toastBox?.destroy(true);
    this.toastBox = toast(this, message, color);
  }
}
