import Phaser from 'phaser';
import { BARE_HAND_POWER, CHARGE, GAME_HEIGHT, GAME_WIDTH, MOVES, SCENE_KEYS, SMASH } from '../Constants';
import { session } from '../State';
import { getBita } from '../data/Bitas';
import { getChip } from '../data/Chips';
import { COLORS, FONT_FAMILY, css, darken, heatColor, rarityColor } from '../ui/Theme';
import { Button, HoldPad, MoveBar, label, modal, panel, toast, type Modal } from '../ui/Widgets';
import { burst, coinRain, flash, floatText, hitStop, installBackground, rayBurst, shake } from '../ui/Fx';
import { audio, silenceAll } from '../ui/Audio';
import { ChipView } from '../ui/ChipView';
import { expectedFlips, flipChance } from '../systems/MatchEngine';
import { getSettings } from '../systems/Settings';
import { bindKeys, type KeyAction } from '../ui/Keys';
import { ChipTooltip, type TooltipLine } from '../ui/Tooltip';
import { addChips, spendChips, uniqueChips } from '../systems/Economy';
import { questEvent } from '../systems/Quests';
import { net } from '../net/Net';
import { shareRoom } from '../net/Telegram';
import { errorText, type MatchResult, type OnlineMatchView, type RoomPlayer, type RoomState, type SmashReport } from '../net/Protocol';
import type { MoveKind } from '../Types';

const W = GAME_WIDTH;
const H = GAME_HEIGHT;
const PM_MIN = SMASH.POWER_MULT_MIN;
const PM_MAX = SMASH.POWER_MULT_MAX;
const PM_DEFAULT = SMASH.POWER_MULT_DEFAULT;

const CARD_W = 206;
const COL_X = [28 + CARD_W / 2, 28 + CARD_W + 12 + CARD_W / 2];
const GRID_TOP = 124;
/** Vertical room for the player grid; the column + controls take the rest. */
const GRID_BUDGET = 290;

/** Bottom of the table zone — everything below is the smash controls. */
const TABLE_BOTTOM = 596;
const TURN_Y = 600;
const GAUGE = { left: 62, right: W - 62, y: 634 };
const MOVE_BAR_Y = 686;
const PAD_Y = 748;

/** Chip cost of each special move (HUD badges + denial toasts). */
const MOVE_COSTS: Record<MoveKind, number> = {
  normal: 0,
  precise: MOVES.PRECISE.COST,
  brace: MOVES.BRACE.COST,
  double: MOVES.DOUBLE.COST,
};

/** Short banner for a special move («точный удар» etc.). */
const MOVE_BANNER: Record<MoveKind, string> = {
  normal: '',
  precise: '🎯 ТОЧНЫЙ УДАР',
  brace: '🛡 ОТБОЙ',
  double: '⚡ ДВОЙНОЙ УДАР',
};

/**
 * A multiplayer table: the waiting lobby (invite / settings / start) and the
 * live N-player match. All outcomes come from the authoritative server; this
 * scene only renders server state and plays the "juice".
 *
 * The stack is drawn as a **column** (столбик) exactly like the single-player
 * match: hold to charge the power, drag over the column to aim, release to
 * strike. Winnings settle against the local profile: the ante leaves on match
 * start, whatever you smash out comes back on match end.
 */
export class RoomScene extends Phaser.Scene {
  private readonly net = net();
  private room: RoomState | null = null;
  private match: OnlineMatchView | null = null;
  private result: MatchResult | null = null;
  private myId = '';
  private pm: number = PM_DEFAULT;
  private antePaidFor: string | null = null;
  private wonAppliedFor: string | null = null;
  private cardPos = new Map<string, { x: number; y: number }>();
  private unsubs: Array<() => void> = [];

  private stage!: Phaser.GameObjects.Container;
  private balanceText?: Phaser.GameObjects.Text;
  private turnText?: Phaser.GameObjects.Text;
  private gaugeG?: Phaser.GameObjects.Graphics;
  private powerPct?: Phaser.GameObjects.Text;
  private expectText?: Phaser.GameObjects.Text;
  private reticleG?: Phaser.GameObjects.Graphics;
  private holdPad?: HoldPad;
  private moveBar?: MoveBar;
  /** Move armed for the next smash (`normal` = plain punch). */
  private pendingMove: MoveKind = 'normal';
  private resultsRoot: Phaser.GameObjects.Container | null = null;

  /* ── stack column ── */
  private stackViews: ChipView[] = [];
  private columnTop = 400;
  private columnBottom = 400;
  /** Bottom edge of the player grid — the smash gesture starts below it. */
  private gridBottom = 124;
  private tooltip!: ChipTooltip;

  /* ── desktop input ── */
  private unbindKeys?: () => void;
  private leaveOpen = false;
  private leaveModal: Modal | null = null;

  /* ── smash input ── */
  private charging = false;
  private chargeT = 0;
  private chargeDir: 1 | -1 = 1;
  private aimT = 0.5;

  constructor() {
    super(SCENE_KEYS.ROOM);
  }

  create(): void {
    installBackground(this, { chips: true });
    this.myId = this.net.accountId || '';
    this.stage = this.add.container(0, 0);
    this.tooltip = new ChipTooltip(this);

    this.wireNet();
    this.net.syncRoom();
    this.render();

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.unbindKeys = bindKeys(this, {
      down: (action, event) => this.onKeyDown(action, event),
      up: (action) => this.onKeyUp(action),
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const u of this.unsubs) u();
      this.unsubs = [];
      this.input.off('pointerdown', this.onPointerDown, this);
      this.input.off('pointermove', this.onPointerMove, this);
      this.input.off('pointerup', this.onPointerUp, this);
      this.unbindKeys?.();
      this.tooltip.destroy();
      silenceAll();
    });
  }

  /* ───────────────────────── networking ───────────────────────── */

  private wireNet(): void {
    this.unsubs.push(
      this.net.on('room:state', (ev) => {
        this.room = ev.room;
        if (ev.room.status === 'waiting') {
          this.match = null;
          this.result = null;
          this.antePaidFor = null;
          this.wonAppliedFor = null;
        }
        this.render();
      }),
    );
    this.unsubs.push(
      this.net.on('match:start', (ev) => {
        this.match = ev.match;
        this.result = null;
        if (this.room) this.room.status = 'playing';
        this.payAnte();
        this.render();
        this.announceTurn();
      }),
    );
    this.unsubs.push(
      this.net.on('match:sync', (ev) => {
        this.match = ev.match;
        this.result = ev.result;
        if (this.match && this.match.status === 'active') this.payAnte();
        this.render();
      }),
    );
    this.unsubs.push(
      this.net.on('match:smash', (ev) => {
        this.match = ev.state;
        this.render();
        this.playReports(ev.reports);
      }),
    );
    this.unsubs.push(
      this.net.on('match:end', (ev) => {
        this.result = ev.result;
        if (this.match) this.match.status = 'finished';
        this.settle();
        this.render();
        this.playResults();
      }),
    );
    this.unsubs.push(
      this.net.on('room:kicked', () => {
        this.notify('Вас убрали со стола', COLORS.redDeep);
        this.scene.start(SCENE_KEYS.ONLINE);
      }),
    );
    this.unsubs.push(this.net.on('error', (ev) => this.notify(errorText(ev.code), COLORS.redDeep)));
    this.unsubs.push(this.net.on('wallet:grant', () => this.balanceText?.setText(String(session.profile.balance))));
  }

  /**
   * Show a toast that never lands on top of the scene's own controls: at the
   * table it sits just above the smash pad, in the lobby it clears the stack of
   * bottom buttons.
   */
  private notify(message: string, color: number = COLORS.goldDeep): void {
    const atTable = this.room?.status === 'playing';
    toast(this, message, color, atTable ? H - 118 : 500);
  }

  /* ───────────────────────── economy ───────────────────────── */

  private payAnte(): void {
    if (!this.room || !this.match || this.match.status !== 'active') return;
    if (this.antePaidFor === this.room.id) return;
    this.antePaidFor = this.room.id;
    spendChips(session.profile, this.room.stake);
    session.save();
    this.balanceText?.setText(String(session.profile.balance));
  }

  private settle(): void {
    if (!this.room || !this.result) return;
    const key = `${this.room.id}:${this.result.turns}`;
    if (this.wonAppliedFor === key) return;
    this.wonAppliedFor = key;
    const mine = this.result.summary.find((s) => s.id === this.myId);
    if (mine && mine.won > 0) {
      const wonNow = this.result.winners.some((i) => this.result!.summary[i]?.id === this.myId);
      addChips(session.profile, mine.won);
      session.profile.stats.chipsWon += mine.won;
      session.profile.stats.gamesPlayed += 1;
      if (wonNow) {
        session.profile.stats.gamesWon += 1;
        // Daily quests + global leaderboard pick the win up here.
        questEvent(session.profile, 'wins', 1);
        questEvent(session.profile, 'flips', mine.won);
      }
      void net().submitScore(uniqueChips(session.profile), session.profile.stats.gamesWon);
      session.save();
      this.balanceText?.setText(String(session.profile.balance));
    }
  }

  /* ───────────────────────── render ───────────────────────── */

  private render(): void {
    this.stage.destroy(true);
    this.stage = this.add.container(0, 0);
    this.cardPos.clear();
    this.resultsRoot?.destroy(true);
    this.resultsRoot = null;

    this.buildTopBar();
    if (!this.room) {
      this.stage.add(label(this, W / 2, 400, 'Загрузка стола…', 18, COLORS.dim));
      return;
    }
    if (this.room.status === 'waiting') this.buildLobby();
    else this.buildTable();
    if (this.result) this.buildResults();
  }

  private buildTopBar(): void {
    this.stage.add(
      new Button(this, 46, 56, '←', () => this.leave(), { size: 'md', width: 52, height: 46, variant: 'ghost' }),
    );
    const title = this.add
      .text(W / 2, 52, this.room ? this.room.name : 'СТОЛ', { fontFamily: FONT_FAMILY, fontSize: '21px', color: COLORS.goldText, fontStyle: 'bold' })
      .setOrigin(0.5);
    title.setShadow(0, 3, '#000000aa', 6);
    this.stage.add(title);

    if (this.room) {
      this.stage.add(label(this, W / 2, 78, `КОД: ${this.room.id}${this.room.locked ? '  🔒' : ''}`, 13, COLORS.dim));
    }

    const coin = this.add.circle(28, 106, 14, COLORS.goldDeep).setStrokeStyle(3, COLORS.goldNum, 1);
    this.stage.add(coin);
    this.stage.add(this.add.text(28, 106, '🪙', { fontFamily: FONT_FAMILY, fontSize: '14px' }).setOrigin(0.5));
    this.balanceText = label(this, 48, 106, String(session.profile.balance), 17, COLORS.goldText, 0).setOrigin(0, 0.5);
    this.stage.add(this.balanceText);

    if (this.room) {
      this.stage.add(label(this, W / 2, 106, `ставка 🪙 ${formatChips(this.room.stake)}`, 15, COLORS.text));
      this.stage.add(label(this, W - 22, 106, `👥 ${this.room.players.length}/${this.room.maxPlayers}`, 15, COLORS.text, 1).setOrigin(1, 0.5));
    }
  }

  private leave(): void {
    void this.net.leaveRoom();
    this.scene.start(SCENE_KEYS.ONLINE);
  }

  /* ───────────────────────── lobby ───────────────────────── */

  private buildLobby(): void {
    const room = this.room!;
    const isHost = room.hostId === this.myId;
    this.renderPlayerGrid(room, false);

    const bottom = H - 96;
    const invite = new Button(this, W / 2, isHost ? bottom - 146 : bottom - 78, '📨  ПОЗВАТЬ ДРУЗЕЙ', () => void this.invite(), {
      variant: 'success',
      size: 'md',
      width: 420,
      height: 50,
    });
    this.stage.add(invite);

    if (isHost) {
      const start = new Button(this, W / 2, bottom, '▶  НАЧАТЬ ИГРУ', () => this.startMatch(), {
        variant: 'gold',
        size: 'lg',
        width: 320,
        height: 62,
        glow: true,
      }).pulse();
      this.stage.add(start);
      this.stage.add(
        new Button(this, 128, bottom - 78, '⚙ НАСТРОЙКИ', () => this.openSettings(), { variant: 'ghost', size: 'sm', width: 200, height: 46 }),
      );
      this.stage.add(new Button(this, 352, bottom - 78, '🤖 + БОТ', () => void this.net.addBot(room.id), { variant: 'cyan', size: 'sm', width: 200, height: 46 }));
    } else {
      const wait = new Button(this, W / 2, bottom, '⏳ ЖДЁМ ХОЗЯИНА…', () => {}, { variant: 'ghost', size: 'lg', width: 320, height: 62, disabled: true });
      this.stage.add(wait);
    }
  }

  /**
   * Adaptive 2-column grid: with many players the rows shrink so the stack
   * column and the smash controls always keep their own space.
   */
  private renderPlayerGrid(room: RoomState, live: boolean): void {
    const isHost = room.hostId === this.myId;
    const rows = Math.max(1, Math.ceil(room.players.length / 2));
    const rowH = Phaser.Math.Clamp(Math.floor(GRID_BUDGET / rows), 44, 68);
    const cardH = Math.min(64, rowH - 6);
    this.gridBottom = GRID_TOP + rows * rowH;

    room.players.forEach((p, i) => {
      const x = COL_X[i % 2];
      const y = GRID_TOP + Math.floor(i / 2) * rowH + rowH / 2;
      this.cardPos.set(p.id, { x, y });
      const isCurrent = live && this.match ? this.match.players[this.match.current]?.id === p.id : false;
      this.stage.add(this.buildPlayerCard(x, y, p, isCurrent, isHost, live, cardH));
    });
  }

  private buildPlayerCard(
    x: number,
    y: number,
    p: RoomPlayer,
    isCurrent: boolean,
    canKick: boolean,
    live: boolean,
    cardH: number,
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const isMe = p.id === this.myId;
    const fill = isCurrent ? COLORS.goldDark : isMe ? COLORS.violetDeep : COLORS.panelAlt;
    c.add(
      panel(this, 0, 0, CARD_W, cardH, fill, 14, {
        glow: isCurrent ? COLORS.goldNum : undefined,
        rim: isCurrent ? COLORS.goldNum : isMe ? COLORS.violet : COLORS.stroke,
        rimAlpha: isCurrent ? 0.95 : 0.5,
        glass: true,
      }),
    );

    const avR = Math.min(20, cardH / 2 - 6);
    const av = this.add.circle(-CARD_W / 2 + 28, 0, avR, p.isBot ? COLORS.cyanDeep : COLORS.violetDeep, 1);
    av.setStrokeStyle(2, COLORS.strokeHi, 0.8);
    c.add(av);
    c.add(
      this.add
        .text(-CARD_W / 2 + 28, 0, p.isBot ? '🤖' : p.name.slice(0, 1).toUpperCase(), { fontFamily: FONT_FAMILY, fontSize: `${Math.min(18, avR + 4)}px`, color: '#ffffff', fontStyle: 'bold' })
        .setOrigin(0.5),
    );

    const nameColor = isCurrent ? COLORS.goldText : COLORS.text;
    c.add(label(this, -CARD_W / 2 + 56, -cardH / 4, p.name.slice(0, 14), 15, nameColor, 0).setOrigin(0, 0.5));
    const tags = [p.isHost ? '👑 хост' : '', isMe ? 'вы' : '', p.isBot ? 'бот' : '', !p.connected && !p.isBot ? 'офлайн' : ''].filter(Boolean).join(' · ');
    c.add(label(this, -CARD_W / 2 + 56, cardH / 4, tags, 12, COLORS.dim, 0).setOrigin(0, 0.5));

    if (live && this.match) {
      const mp = this.match.players.find((m) => m.id === p.id);
      c.add(label(this, CARD_W / 2 - 14, -cardH / 4, `🪙 ${mp ? mp.count : 0}`, 17, COLORS.goldText, 1).setOrigin(1, 0.5));
      // S2 modifiers: «переход» (+aim) and «отбой» (−power), mirrored from the server.
      const mods: string[] = [];
      if (mp && (mp.focusBonus ?? 0) > 0) mods.push(`🎯+${Math.round((mp.focusBonus ?? 0) * 100)}%`);
      if (mp && (mp.brace ?? 0) > 0) mods.push(`🛡−${Math.round((mp.brace ?? 0) * 100)}%`);
      if (mods.length) c.add(label(this, CARD_W / 2 - 14, 0, mods.join(' '), 11, '#7fe8ff', 1).setOrigin(1, 0.5));
      if (isCurrent) c.add(label(this, CARD_W / 2 - 14, cardH / 4, '▶ ХОД', 13, '#ffffff', 1).setOrigin(1, 0.5));
    } else if (canKick && !isMe && !p.isHost) {
      const kick = this.add
        .text(CARD_W / 2 - 16, 0, '✕', { fontFamily: FONT_FAMILY, fontSize: '20px', color: '#ff7a7a', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => void this.net.kick(this.room!.id, p.id));
      c.add(kick);
    }
    return c;
  }

  private async invite(): Promise<void> {
    if (!this.room) return;
    const bot = this.net.serverConfig?.botUsername || '';
    const how = await shareRoom(this.room.id, bot, `Зайди за мой стол «${this.room.name}» в CHIPS! 🎲 Код: ${this.room.id}`);
    if (how === 'clipboard') this.notify('Ссылка скопирована 📋', COLORS.emeraldDeep);
    else if (how !== 'native') this.notify('Приглашение отправлено 📨', COLORS.emeraldDeep);
  }

  private startMatch(): void {
    if (!this.room) return;
    if (this.room.players.length < 2) {
      this.notify('Нужно минимум 2 игрока', COLORS.redDeep);
      return;
    }
    void this.net.startMatch(this.room.id).then((res) => {
      if (res.error) this.notify(errorText(res.error as string), COLORS.redDeep);
    });
  }

  /* ───────────────────────── settings dialog ───────────────────────── */

  private openSettings(): void {
    if (!this.room) return;
    const room = this.room;
    const backdrop = this.add.rectangle(W / 2, H / 2, W, H, 0x05030f, 0.82).setDepth(2000).setInteractive();
    const root = this.add.container(W / 2, H / 2).setDepth(2010);
    root.add(panel(this, 0, 0, W - 40, 440, COLORS.panel, 24, { glow: COLORS.violetDeep, rim: COLORS.strokeGold, rimAlpha: 0.5 }));
    const title = this.add
      .text(0, -186, 'НАСТРОЙКИ СТОЛА', { fontFamily: FONT_FAMILY, fontSize: '20px', color: COLORS.goldText, fontStyle: 'bold' })
      .setOrigin(0.5);
    title.setShadow(0, 3, '#000000aa', 6);
    root.add(title);

    const close = (): void => {
      root.destroy(true);
      backdrop.destroy();
    };
    backdrop.on('pointerdown', close);

    let stake = room.stake;
    let seats = room.maxPlayers;
    let isPublic = room.isPublic;
    let password: string | null = room.locked ? '••••' : null;

    const stakeLbl = label(this, 0, -132, '', 17, COLORS.text);
    const seatsLbl = label(this, 0, -60, '', 17, COLORS.text);
    const passLbl = label(this, 0, 62, '', 14, COLORS.dim);
    root.add([stakeLbl, seatsLbl, passLbl]);

    const setStake = (v: number): void => {
      stake = Math.max(1, v);
      stakeLbl.setText(`Ставка: 🪙 ${formatChips(stake)}`);
    };
    const setSeats = (v: number): void => {
      seats = Phaser.Math.Clamp(v, 2, 10);
      seatsLbl.setText(`Игроков: ${seats}`);
    };
    const setPass = (v: string | null): void => {
      password = v;
      passLbl.setText(v ? `🔒 Пароль: ${v === '••••' ? '(задан)' : v}` : 'Пароль не задан');
      passBtn.setText(v ? 'УБРАТЬ ПАРОЛЬ' : 'ЗАДАТЬ ПАРОЛЬ');
    };
    setStake(stake);
    setSeats(seats);

    const mk = (dx: number, dy: number, t: string, fn: () => void): Button => {
      const b = new Button(this, dx, dy, t, fn, { variant: 'ghost', size: 'sm', width: 62, height: 40, fontSize: 14 });
      root.add(b);
      return b;
    };
    mk(-120, -132, '−10', () => setStake(stake - 10));
    mk(120, -132, '+10', () => setStake(stake + 10));
    mk(-120, -60, '−', () => setSeats(seats - 1));
    mk(120, -60, '+', () => setSeats(seats + 1));

    const pubBtn = new Button(this, 0, 6, isPublic ? '🌐 ПУБЛИЧНЫЙ' : '🔒 ПО ССЫЛКЕ', () => {
      isPublic = !isPublic;
      pubBtn.setText(isPublic ? '🌐 ПУБЛИЧНЫЙ' : '🔒 ПО ССЫЛКЕ');
      pubBtn.setFill(isPublic ? COLORS.emeraldDeep : COLORS.magentaDeep);
    }, { fill: isPublic ? COLORS.emeraldDeep : COLORS.magentaDeep, size: 'sm', width: 300, height: 44 });
    root.add(pubBtn);

    const passBtn = new Button(this, 0, 108, 'ЗАДАТЬ ПАРОЛЬ', () => {
      setPass(password ? null : String(Math.floor(1000 + Math.random() * 9000)));
    }, { variant: 'magenta', size: 'sm', width: 260, height: 44 });
    root.add(passBtn);
    setPass(password);

    const save = new Button(this, -80, 176, 'СОХРАНИТЬ', () => {
      void this.net.updateRoom(room.id, { stake, maxPlayers: seats, isPublic, password });
      close();
      this.notify('Настройки сохранены', COLORS.emeraldDeep);
    }, { variant: 'gold', width: 150, height: 50 });
    root.add(save);
    root.add(new Button(this, 80, 176, 'ЗАКРЫТЬ', close, { variant: 'ghost', width: 150, height: 50 }));

    root.setScale(0.9).setAlpha(0);
    this.tweens.add({ targets: root, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
  }

  /* ───────────────────────── live table ───────────────────────── */

  private buildTable(): void {
    const room = this.room!;
    this.renderPlayerGrid(room, true);

    // `renderPlayerGrid` just measured the grid, so the column starts under it.
    const colTop = this.gridBottom + 16;
    const colBottom = TABLE_BOTTOM - 4;
    this.columnTop = colTop;
    this.columnBottom = colBottom;

    this.buildColumn();
    this.buildTurnText();
    this.buildPowerControls();
  }

  /** Render the remaining stack as a physical column (столбик). */
  private buildColumn(): void {
    for (const v of this.stackViews) v.destroy();
    this.stackViews = [];

    const stack = this.match?.stack ?? [];
    const n = stack.length;
    if (n === 0) {
      this.stage.add(label(this, W / 2, (this.columnTop + this.columnBottom) / 2, 'СТОПКА РАЗОБРАНА', 18, COLORS.dim));
      return;
    }

    const span = Math.max(60, this.columnBottom - this.columnTop - 36);
    const step = n > 1 ? Math.min(7, span / (n - 1)) : 0;
    const top = (this.columnTop + this.columnBottom) / 2 - (step * (n - 1)) / 2;
    const radius = Phaser.Math.Clamp(30 - n * 0.16, 11, 27);
    const baseScale = radius / 26;
    const last = Math.max(1, n - 1);

    for (let i = 0; i < n; i++) {
      const chip = new ChipView(this, W / 2, top + i * step, stack[i].defId, 26, false);
      chip.setDepth(40 - (i / last) * 30);
      chip.setScale(baseScale * (0.93 + ((i * 53) % 9) / 100));
      chip.setInteractive(new Phaser.Geom.Circle(0, 0, 27), Phaser.Geom.Circle.Contains);
      chip.on('pointerover', () => this.showChipTooltip(chip));
      chip.on('pointerout', () => this.tooltip.hide());
      this.stackViews.push(chip);
      this.stage.add(chip);
    }
  }

  /** Hover tooltip: weight and the chance to flip under the current aim. */
  private showChipTooltip(view: ChipView): void {
    if (!getSettings().tooltips || this.leaveOpen || !this.match) return;
    const depth = this.stackViews.indexOf(view);
    if (depth < 0) return;
    const def = getChip(view.defId);
    const lines: TooltipLine[] = [
      { text: 'Фишка в стопке', title: true, color: COLORS.text },
      { text: `вес ${def.weight.toFixed(1)} · чем тяжелее, тем крепче`, color: css(rarityColor(def.rarity)) },
    ];
    if (this.match.status === 'active' && this.match.players[this.match.current]?.id === this.myId) {
      const me = this.room?.players.find((p) => p.id === this.myId);
      const bita = me?.bitaId ? getBita(me.bitaId) : null;
      const chance = flipChance(bita ? bita.power : BARE_HAND_POWER, def.weight, depth, this.pm, {
        focus: this.aimT,
        span: Math.max(1, this.match.stack?.length ?? 0),
      });
      lines.push({ text: `шанс перебить ≈ ${Math.round(chance * 100)}%`, color: COLORS.gold });
    }
    this.tooltip.show(lines, rarityColor(def.rarity), view.x, view.y);
  }

  private buildTurnText(): void {
    const myTurn = this.match ? this.match.players[this.match.current]?.id === this.myId : false;
    const currName = this.match ? this.match.players[this.match.current]?.name : '';
    const finished = this.match?.status === 'finished';
    const text = finished ? 'СТОПКА РАЗОБРАНА' : myTurn ? '⚡ ВАШ ХОД — зажмите и держите' : `Ходит: ${currName}`;
    this.turnText = label(this, W / 2, TURN_Y, text, 15, myTurn ? '#4dff9d' : COLORS.dim);
    this.stage.add(this.turnText);
  }

  private buildPowerControls(): void {
    this.gaugeG = this.add.graphics();
    this.stage.add(this.gaugeG);

    this.stage.add(label(this, GAUGE.left, GAUGE.y - 26, 'СИЛА УДАРА', 12, COLORS.dim, 0));
    this.powerPct = label(this, GAUGE.right + 12, GAUGE.y, '', 15, COLORS.gold, 0);
    this.stage.add(this.powerPct);
    this.expectText = label(this, W / 2, GAUGE.y + 22, '', 12, COLORS.dim);
    this.stage.add(this.expectText);

    this.reticleG = this.add.graphics().setDepth(45);
    this.stage.add(this.reticleG);

    this.holdPad = new HoldPad(this, W / 2, PAD_Y, '🥊  ЗАЖМИ', {
      width: 372,
      height: 72,
      variant: 'danger',
      fontSize: 21,
      radius: 20,
      glow: true,
    });
    this.stage.add(this.holdPad);

    // A fresh table render starts with no move armed.
    this.pendingMove = 'normal';

    // Special-move picker («спец-удары»). The cost is paid in chips the player
    // has already flipped this match, so it tracks the local collection count.
    this.moveBar = new MoveBar(this, W / 2, MOVE_BAR_Y, {
      width: 126,
      height: 32,
      gap: 14,
      onPick: (move) => this.onMovePick(move),
      onDenied: (move) => {
        const cost = MOVE_COSTS[move];
        toast(this, `нужно ${cost} фишки в отбое`, COLORS.redDeep);
      },
    });
    this.stage.add(this.moveBar);
    this.syncMoveBar();

    this.drawGauge();
    this.drawReticle();
    this.updateExpectation();
  }

  /** My own row in the online match view, if any. */
  private myPlayer(): OnlineMatchView['players'][number] | undefined {
    return this.match ? this.match.players.find((p) => p.id === this.myId) : undefined;
  }

  /** Refresh the special-move picker from my current collection. */
  private syncMoveBar(): void {
    if (!this.moveBar) return;
    const me = this.myPlayer();
    const count = me ? me.count : 0;
    this.moveBar.setAffordable(count);
    const myTurn =
      !!this.match && this.match.status === 'active' && this.match.players[this.match.current]?.id === this.myId;
    // Affordable pills are dimmed (not hidden) so a tap can explain the cost.
    this.moveBar.setEnabled(myTurn && !this.leaveOpen);
  }

  /** The player tapped a special move. */
  private onMovePick(move: MoveKind): void {
    this.pendingMove = move;
    audio.click();
    this.updateExpectation();
    if (move !== 'normal') {
      toast(this, `${MOVE_BANNER[move]} · ${MOVE_COSTS[move]} фишки`, COLORS.goldDeep, 470);
    }
  }

  private drawGauge(): void {
    const t = Phaser.Math.Clamp((this.pm - PM_MIN) / (PM_MAX - PM_MIN), 0, 1);
    const col = heatColor(t);
    const { left, right, y } = GAUGE;
    const w = right - left;
    const g = this.gaugeG;
    if (!g) return;
    g.clear();

    g.fillStyle(0x120a2a, 0.95);
    g.fillRoundedRect(left - 4, y - 9, w + 8, 18, 9);
    if (t > 0.002) {
      g.fillGradientStyle(COLORS.cyan, col, COLORS.cyanDeep, darken(col, 0.25), 1);
      g.fillRoundedRect(left - 2, y - 7, w * t, 14, 7);
    }
    for (let i = 0; i <= 10; i++) {
      const tx = left + (w * i) / 10;
      g.fillStyle(0xffffff, i % 5 === 0 ? 0.4 : 0.16);
      g.fillRect(tx - 1, y - 13, 2, 4);
      g.fillRect(tx - 1, y + 9, 2, 4);
    }
    g.lineStyle(2, COLORS.strokeHi, 0.7);
    g.strokeRoundedRect(left - 4, y - 9, w + 8, 18, 9);

    const mx = left + w * t;
    g.fillStyle(0xffffff, 1);
    g.fillCircle(mx, y, 8);
    g.lineStyle(3, col, 1);
    g.strokeCircle(mx, y, 8);

    this.powerPct?.setText(`${Math.round(this.pm * 100)}%`);
  }

  private drawReticle(): void {
    const g = this.reticleG;
    if (!g) return;
    g.clear();
    if (!this.match || (this.match.status !== 'active' && this.match.status !== 'finished')) return;
    if (this.match.players[this.match.current]?.id !== this.myId) return;

    const y = this.columnTop + this.aimT * (this.columnBottom - this.columnTop);
    const col = this.charging ? heatColor(this.chargeT) : COLORS.goldNum;
    const a = this.charging ? 1 : 0.6;

    g.lineStyle(3, col, a * 0.8);
    for (let x = W / 2 - 86; x < W / 2 + 86; x += 14) g.lineBetween(x, y, x + 8, y);

    g.fillStyle(col, a);
    g.fillTriangle(W / 2 - 100, y - 10, W / 2 - 100, y + 10, W / 2 - 84, y);
    g.fillTriangle(W / 2 + 100, y - 10, W / 2 + 100, y + 10, W / 2 + 84, y);

    g.lineStyle(3, col, a);
    g.strokeCircle(W / 2, y, 24 + (this.charging ? this.chargeT * 12 : 0));
  }

  /* ───────────────────────── keyboard ───────────────────────── */

  private myTurnNow(): boolean {
    return (
      !!this.match &&
      this.match.status === 'active' &&
      this.match.players[this.match.current]?.id === this.myId
    );
  }

  private onKeyDown(action: KeyAction, event: KeyboardEvent): void {
    if (action === 'esc') {
      if (this.leaveOpen) this.leaveModal?.close();
      else this.confirmLeave();
      return;
    }
    if (this.leaveOpen) return;
    if (!this.myTurnNow()) return;

    if (action === 'space') {
      if (event.repeat || this.charging) return;
      this.tooltip.hide();
      this.charging = true;
      this.chargeT = 0;
      this.chargeDir = 1;
      this.updateChargeVisual();
      audio.chargeStart();
    } else if (action === 'up' || action === 'left') {
      this.nudgeAim(-0.04);
    } else if (action === 'down' || action === 'right') {
      this.nudgeAim(0.04);
    } else if (action === 'one') {
      this.moveBar?.choose('precise');
    } else if (action === 'two') {
      this.moveBar?.choose('brace');
    } else if (action === 'three') {
      this.moveBar?.choose('double');
    }
  }

  private onKeyUp(action: KeyAction): void {
    if (action === 'space' && this.charging && !this.leaveOpen) this.releaseCharge();
  }

  private nudgeAim(delta: number): void {
    this.aimT = Phaser.Math.Clamp(this.aimT + delta, 0, 1);
    this.drawReticle();
    this.updateExpectation();
  }

  /** `Esc` in the online table: confirm before dropping the seat. */
  private confirmLeave(): void {
    if (this.leaveOpen) return;
    this.leaveOpen = true;
    if (this.charging) {
      this.charging = false;
      audio.chargeStop();
      this.holdPad?.setProgress(0, false);
    }
    this.tooltip.hide();
    this.moveBar?.setEnabled(false);

    const active = this.match?.status === 'active';
    const m = modal(this, 'ПОКИНУТЬ СТОЛ?', {
      height: 300,
      onClose: () => {
        this.leaveOpen = false;
        this.leaveModal = null;
        this.syncMoveBar();
      },
    });
    this.leaveModal = m;
    m.root.add(
      label(
        this,
        0,
        -46,
        active
          ? 'Матч идёт. Ставка не вернётся,\nа выход засчитается как поражение.'
          : 'Вы вернётесь в список столов.',
        14,
        COLORS.dim,
      ),
    );
    m.root.add(new Button(this, -72, 62, 'Отмена', () => m.close(), { width: 128, height: 50, variant: 'ghost' }));
    m.root.add(
      new Button(
        this,
        72,
        62,
        'Выйти',
        () => {
          m.close();
          this.leave();
        },
        { width: 128, height: 50, variant: 'danger' },
      ),
    );
  }

  /* ───────────────────────── smash input ───────────────────────── */

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.leaveOpen) return;
    if (!this.match || this.match.status !== 'active') return;
    if (this.match.players[this.match.current]?.id !== this.myId) return;
    if (this.charging) return;
    if (p.y < this.gridBottom + 6) return; // taps on player cards are not charges

    this.tooltip.hide();
    this.charging = true;
    this.chargeT = 0;
    this.chargeDir = 1;
    this.setAimFromPointer(p);
    this.updateChargeVisual();
    audio.chargeStart();
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (!this.charging) return;
    this.setAimFromPointer(p);
    this.updateChargeVisual();
  }

  private onPointerUp(): void {
    if (!this.charging) return;
    this.releaseCharge();
  }

  private setAimFromPointer(p: Phaser.Input.Pointer): void {
    const top = this.columnTop - 30;
    const bottom = this.columnBottom + 30;
    if (p.y < top || p.y > bottom) return;
    this.aimT = Phaser.Math.Clamp((p.y - top) / Math.max(1, bottom - top), 0, 1);
  }

  private updateChargeVisual(): void {
    this.chargeT = Phaser.Math.Clamp(this.chargeT, 0, 1);
    this.pm = PM_MIN + this.chargeT * (PM_MAX - PM_MIN);
    this.drawGauge();
    this.drawReticle();
    this.updateExpectation();
    this.holdPad?.setText(`🥊  ${Math.round(this.pm * 100)}%`);
    this.holdPad?.setProgress(this.chargeT, true);
    audio.chargeSet(this.chargeT);
  }

  private releaseCharge(): void {
    if (!this.charging) return;
    this.charging = false;
    audio.chargeStop();
    this.pm = PM_MIN + this.chargeT * (PM_MAX - PM_MIN);
    this.reticleG?.clear();
    this.holdPad?.setProgress(0, false);
    this.holdPad?.setText('🥊  ЗАЖМИ');
    this.doSmash();
  }

  override update(_time: number, delta: number): void {
    if (!this.charging) return;
    this.chargeT += (this.chargeDir * delta) / CHARGE.SWEEP_MS;
    if (this.chargeT >= 1) {
      this.chargeT = 1;
      this.chargeDir = -1;
    } else if (this.chargeT <= 0) {
      this.chargeT = 0;
      this.chargeDir = 1;
    }
    this.updateChargeVisual();
  }

  private updateExpectation(): void {
    if (!this.expectText || !this.match || !this.match.stack || !this.room) return;
    const me = this.room.players.find((p) => p.id === this.myId);
    const bita = me?.bitaId ? getBita(me.bitaId) : null;
    const expected = expectedFlips(this.match.stack, bita ? bita.power : BARE_HAND_POWER, this.pm, this.aimT);
    const zone = this.aimT < 0.34 ? 'верх' : this.aimT < 0.67 ? 'центр' : 'низ';
    // Modifiers the server has queued up for me («переход» / «отбой»).
    const view = this.myPlayer();
    let mods = '';
    if (view && (view.focusBonus ?? 0) > 0) mods += ` · 🎯+${Math.round((view.focusBonus ?? 0) * 100)}%`;
    if (view && (view.brace ?? 0) > 0) mods += ` · 🛡−${Math.round((view.brace ?? 0) * 100)}%`;
    if (this.pendingMove !== 'normal') mods += ` · ${MOVE_BANNER[this.pendingMove]}`;
    this.expectText.setText(`≈ ${expected.toFixed(1)} фишек · прицел: ${zone}${mods}`);
  }

  private doSmash(): void {
    if (!this.room || !this.match) return;
    if (this.match.status !== 'active') return;
    if (this.match.players[this.match.current]?.id !== this.myId) return;
    const move: MoveKind = this.pendingMove;
    this.pendingMove = 'normal';
    this.moveBar?.clear();
    void this.net.smash(this.room.id, this.pm, this.aimT, move).then((res) => {
      if (res.error) this.notify(errorText(res.error as string), COLORS.redDeep);
    });
  }

  private announceTurn(): void {
    if (!this.match) return;
    const curr = this.match.players[this.match.current];
    if (!curr) return;
    const mine = curr.id === this.myId;
    audio.turn();
    this.notify(mine ? '⚡ Ваш ход!' : `Ходит ${curr.name}`, mine ? COLORS.emeraldDeep : COLORS.goldDeep);
  }

  /* ───────────────────────── effects ───────────────────────── */

  private playReports(reports: SmashReport[]): void {
    reports.forEach((report, i) =>
      this.time.delayedCall(i * 420, () => this.playOneReport(report, i === 0)),
    );
  }

  private playOneReport(report: SmashReport, first = true): void {
    const target = this.match ? this.match.players[report.playerIndex] : null;
    const pos = target ? this.cardPos.get(target.id) : null;
    const cy = (this.columnTop + this.columnBottom) / 2;

    burst(this, W / 2, cy, { count: 16 + report.flipped.length, color: COLORS.goldNum, speed: 300, depth: 900 });
    shake(this, 0.004 + Math.min(0.008, report.flipped.length * 0.0012), 130);

    // Sound: the crack, then a cascade of ticks — or a dull whiff. The power
    // is derived from the *outcome* as well, because a report may come from a
    // bot (whose power never touches `this.pm`).
    const myPower01 = Phaser.Math.Clamp((this.pm - PM_MIN) / (PM_MAX - PM_MIN), 0, 1);
    const outPower01 = Math.min(1, report.flipped.length / 6);
    audio.smash(Phaser.Math.Clamp(myPower01 * 0.45 + outPower01 * 0.55, 0, 1));
    const crit = report.flipped.length >= 4;
    if (report.flipped.length > 0) {
      hitStop(this, crit ? 110 : 60, crit ? 0.2 : 0.45);
      for (let i = 0; i < Math.min(6, report.flipped.length); i++) {
        this.time.delayedCall(i * 45, () => audio.flip(i));
      }
    }
    if (crit) {
      audio.crit();
      flash(this, 130, 255, 220, 160);
      floatText(this, W / 2, cy - 44, '💥 КРИТ!', '#ffd1ff', 22, 950);
    }

    // Special-move call-outs — the server tags each report with the move and
    // with the «точный удар» / «отбой» flags so every client draws the same.
    if (first && report.move && report.move !== 'normal') {
      floatText(this, W / 2, cy - 76, MOVE_BANNER[report.move], '#7fe8ff', 20, 950);
    }
    if (report.precise) {
      floatText(this, W / 2 - 92, cy + 30, '🎯 точно', '#7fe8ff', 15, 950);
    }
    if (report.weakened) {
      floatText(this, W / 2 + 96, cy - 30, '🛡 ослаблен', '#ff9a9a', 15, 950);
    }

    if (report.flipped.length === 0 || !pos) {
      audio.miss();
      floatText(this, W / 2, cy, 'МИМО 😬', '#ff9a9a', 20, 950);
      return;
    }
    const shown = Math.min(6, report.flipped.length);
    for (let i = 0; i < shown; i++) {
      const chip = new ChipView(this, W / 2 + (i - shown / 2) * 10, cy, report.flipped[i].defId, 16, true);
      chip.enableAura();
      chip.setDepth(960);
      this.tweens.add({
        targets: chip,
        x: pos.x,
        y: pos.y,
        scale: 0.7,
        alpha: 0.2,
        duration: 460,
        delay: i * 40,
        ease: 'Cubic.easeIn',
        onComplete: () => chip.destroy(),
      });
    }
    floatText(this, pos.x, pos.y - 30, `+${report.flipped.length} 🪙`, COLORS.goldText, 22, 980);
  }

  private playResults(): void {
    coinRain(this, 30, 1200);
    rayBurst(this, W / 2, 380, COLORS.goldNum, 420, 1);
    shake(this, 0.005, 200);

    const res = this.result;
    const myIdx = res ? res.ranking.findIndex((r) => res.summary[r.i]?.id === this.myId) : -1;
    if (myIdx === 0) audio.win();
    else if (myIdx > 0) audio.lose();
    else audio.coin();
  }

  /* ───────────────────────── results overlay ───────────────────────── */

  private buildResults(): void {
    const res = this.result!;
    const root = this.add.container(W / 2, 380).setDepth(2000);
    this.resultsRoot = root;
    root.add(panel(this, 0, 0, W - 60, 430, COLORS.panel, 24, { glow: COLORS.goldNum, rim: COLORS.strokeGold, rimAlpha: 0.7 }));

    const title = this.add
      .text(0, -176, 'ИГРА ОКОНЧЕНА', { fontFamily: FONT_FAMILY, fontSize: '22px', color: COLORS.goldText, fontStyle: 'bold' })
      .setOrigin(0.5);
    title.setShadow(0, 3, '#000000aa', 6);
    root.add(title);

    const myIdx = res.ranking.findIndex((r) => res.summary[r.i]?.id === this.myId);
    const mine = myIdx >= 0 ? res.summary[res.ranking[myIdx].i] : null;
    const delta = mine ? mine.won - mine.anted : 0;

    root.add(label(this, 0, -132, myIdx === 0 ? '🏆 ВЫ ПОБЕДИЛИ!' : `Ваше место: ${myIdx + 1}`, 20, myIdx === 0 ? COLORS.goldText : COLORS.text).setOrigin(0.5));
    root.add(label(this, 0, -98, `Выбили 🪙 ${mine ? mine.won : 0}   ·   ставка 🪙 ${mine ? mine.anted : 0}`, 14, COLORS.dim).setOrigin(0.5));
    root.add(label(this, 0, -66, `${delta >= 0 ? '+' : ''}${delta} 🪙`, 26, delta >= 0 ? '#4dff9d' : '#ff7a7a').setOrigin(0.5));

    res.ranking.slice(0, 6).forEach((r, i) => {
      const s = res.summary[r.i];
      const y = -18 + i * 40;
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      const isMe = s && s.id === this.myId;
      const line = this.add
        .text(-W / 2 + 54, y, `${medal}  ${s ? s.name.slice(0, 16) : '—'}`, {
          fontFamily: FONT_FAMILY,
          fontSize: '16px',
          color: isMe ? COLORS.goldText : COLORS.text,
          fontStyle: isMe ? 'bold' : 'normal',
        })
        .setOrigin(0, 0.5);
      root.add(line);
      root.add(label(this, W / 2 - 54, y, `🪙 ${s ? s.won : 0}`, 16, COLORS.goldText, 1).setOrigin(1, 0.5));
    });

    const isHost = this.room?.hostId === this.myId;
    if (isHost) {
      const again = new Button(this, -80, 182, 'ЕЩЁ РАЗ', () => {
        root.destroy(true);
        this.resultsRoot = null;
        void this.net.resetRoom(this.room!.id);
      }, { variant: 'gold', width: 150, height: 50 });
      root.add(again);
    }
    const lobby = new Button(this, isHost ? 80 : 0, 182, 'В ЛОББИ', () => this.leave(), { variant: isHost ? 'ghost' : 'gold', width: 150, height: 50 });
    root.add(lobby);

    root.setScale(0.85).setAlpha(0);
    this.tweens.add({ targets: root, scale: 1, alpha: 1, duration: 300, ease: 'Back.easeOut' });
  }
}

function formatChips(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return String(n);
}
