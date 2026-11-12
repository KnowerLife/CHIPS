import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, ONLINE, SCENE_KEYS } from '../Constants';
import { session } from '../State';
import { COLORS, FONT_FAMILY } from '../ui/Theme';
import { Button, label, panel, toast, type ButtonOptions } from '../ui/Widgets';
import { installBackground, makeScroll } from '../ui/Fx';
import { domField, type DomField, type DomFieldOpts } from '../ui/Dom';
import { net } from '../net/Net';
import { startParam } from '../net/Telegram';
import { errorText, type RoomSummary } from '../net/Protocol';

const W = GAME_WIDTH;
const H = GAME_HEIGHT;

interface DialogApi {
  root: Phaser.GameObjects.Container;
  add: (o: Phaser.GameObjects.GameObject) => void;
  title: (t: string, size?: number) => void;
  text: (dx: number, dy: number, t: string, size: number, color: string) => Phaser.GameObjects.Text;
  /** Create a Button positioned *relative to the dialog centre* and own it. */
  button: (dx: number, dy: number, text: string, onClick: () => void, opts?: ButtonOptions) => Button;
  /** Create a DOM input positioned relative to the dialog centre. */
  field: (dx: number, dy: number, w: number, h: number, opts: DomFieldOpts) => DomField | null;
  close: () => void;
}

/**
 * "ИГРЫ ОНЛАЙН" — the multiplayer lobby.
 *
 * Shows open tables (name, host, players, stake, lock), lets anyone create a
 * table (custom stake, 2–10 seats, optional password, public/private) and join
 * by tap or by invite code. Wires directly into `Net` (SSE + POST).
 */
export class OnlineScene extends Phaser.Scene {
  private readonly net = net();
  private rooms: RoomSummary[] = [];
  private status: 'idle' | 'connecting' | 'online' | 'offline' = 'idle';
  private domFields: DomField[] = [];
  private unsubs: Array<() => void> = [];

  private balanceText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private listLayer!: Phaser.GameObjects.Container;
  private emptyText!: Phaser.GameObjects.Text;
  /** Visible vertical band of the room list: taps outside it are ignored. */
  private listBounds = { top: 292, bottom: H - 16 };
  private dialog: DialogApi | null = null;
  private refreshEvent?: Phaser.Time.TimerEvent;
  private pendingJoin: string | null = null;

  constructor() {
    super(SCENE_KEYS.ONLINE);
  }

  create(): void {
    installBackground(this, { chips: true });
    this.status = this.net.status;

    // Build the UI and wire the network *before* connecting: connecting flips
    // the status synchronously, which redraws the pill and can push a `ready`.
    this.buildHeader();
    this.buildActions();
    this.listLayer = this.add.container(0, 0);
    this.emptyText = label(this, W / 2, 470, '', 15, COLORS.dim).setVisible(false);

    this.wireNet();
    this.net.connect({ name: session.profile.name, bitaId: session.profile.equippedBita });

    // Invite deep-link (?room=CODE or ?startapp=room_CODE) — auto-join.
    const code = startParam().replace(/^room_/i, '').toUpperCase();
    if (code && /^[A-Z0-9]{3,8}$/.test(code)) this.tryJoin(code);

    this.net.watchRooms();
    this.refreshEvent = this.time.addEvent({ delay: ONLINE.LOBBY_REFRESH_MS, loop: true, callback: () => this.net.watchRooms() });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
  }

  private cleanup(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.refreshEvent?.remove();
    this.clearDom();
    this.dialog = null;
    this.net.unwatchRooms();
  }

  private clearDom(): void {
    for (const f of this.domFields) f.destroy();
    this.domFields = [];
  }

  /* ───────────────────────── header ───────────────────────── */

  private buildHeader(): void {
    new Button(this, 46, 56, '←', () => this.scene.start(SCENE_KEYS.MENU), { size: 'md', width: 52, height: 46, variant: 'ghost' });

    const title = this.add
      .text(W / 2, 56, 'ИГРЫ ОНЛАЙН', { fontFamily: FONT_FAMILY, fontSize: '23px', color: COLORS.goldText, fontStyle: 'bold' })
      .setOrigin(0.5);
    title.setShadow(0, 3, '#000000aa', 6);

    this.add.circle(28, 106, 15, COLORS.goldDeep).setStrokeStyle(2.5, COLORS.goldNum, 1);
    this.add.text(28, 106, '🪙', { fontFamily: FONT_FAMILY, fontSize: '15px' }).setOrigin(0.5);
    this.balanceText = label(this, 50, 106, String(session.profile.balance), 18, COLORS.goldText, 0).setOrigin(0, 0.5);

    this.statusText = label(this, W - 22, 106, '', 13, COLORS.dim, 1).setOrigin(1, 0.5);
    this.updateStatusPill();
  }

  private updateStatusPill(): void {
    if (!this.statusText || !this.statusText.active) return;
    const map = { idle: '● нет связи', connecting: '● подключение…', online: '● онлайн', offline: '● офлайн' } as const;
    const color = this.status === 'online' ? '#35e07f' : this.status === 'connecting' ? '#f7d774' : '#ff7a7a';
    this.statusText.setText(map[this.status]).setColor(color);
  }

  /* ───────────────────────── actions ───────────────────────── */

  private buildActions(): void {
    new Button(this, W / 2, 168, '➕  СОЗДАТЬ СТОЛ', () => this.openCreateDialog(), {
      variant: 'gold',
      size: 'lg',
      width: 400,
      height: 62,
      glow: true,
    }).pulse();

    new Button(this, 122, 230, '🔑 ВОЙТИ ПО КОДУ', () => this.openCodeDialog(), {
      variant: 'cyan',
      size: 'sm',
      width: 196,
      height: 44,
    });
    new Button(this, 338, 230, '🔄 ОБНОВИТЬ', () => this.net.watchRooms(), { variant: 'ghost', size: 'sm', width: 176, height: 44 });

    label(this, 22, 272, 'ОТКРЫТЫЕ СТОЛЫ', 14, COLORS.dim, 0).setOrigin(0, 0.5);
  }

  /* ───────────────────────── networking ───────────────────────── */

  private wireNet(): void {
    this.unsubs.push(
      this.net.on('rooms', (ev) => {
        this.rooms = ev.rooms;
        this.renderRooms();
      }),
    );
    this.unsubs.push(
      this.net.on('ready', () => {
        this.status = 'online';
        this.updateStatusPill();
        if (this.pendingJoin) {
          const code = this.pendingJoin;
          this.pendingJoin = null;
          void this.doJoin(code);
        }
      }),
    );
    this.unsubs.push(this.net.on('wallet:grant', () => this.balanceText.setText(String(session.profile.balance))));
    this.unsubs.push(this.net.on('error', (ev) => toast(this, errorText(ev.code), COLORS.redDeep)));
    this.unsubs.push(
      this.net.onStatus((s) => {
        this.status = s;
        this.updateStatusPill();
      }),
    );
  }

  /* ───────────────────────── room list ───────────────────────── */

  private renderRooms(): void {
    this.listLayer.destroy(true);
    this.listLayer = this.add.container(0, 0);
    const viewport = { x: 16, y: 292, width: W - 32, height: H - 292 - 16 };
    this.listBounds = { top: viewport.y, bottom: viewport.y + viewport.height };

    if (this.rooms.length === 0) {
      this.emptyText.setVisible(true).setText('Пока нет открытых столов\nСоздайте свой — и позовите друзей!');
      return;
    }
    this.emptyText.setVisible(false);

    const cardW = viewport.width - 16;
    const cardH = 100;
    const gap = 12;
    const cx = viewport.x + viewport.width / 2;
    // The cards sit *above* the scroll zone, so they must drive the scroll
    // themselves — otherwise the zone swallows every tap on a table.
    const dragTargets: Phaser.GameObjects.GameObject[] = [];
    let y = viewport.y + cardH / 2;
    for (const room of this.rooms) {
      this.listLayer.add(this.buildRoomCard(room, cx, y, cardW, dragTargets));
      y += cardH + gap;
    }
    makeScroll(this, this.listLayer, viewport, y - viewport.y, { dragTargets });
  }

  private buildRoomCard(
    room: RoomSummary,
    cx: number,
    cy: number,
    w: number,
    dragTargets: Phaser.GameObjects.GameObject[],
  ): Phaser.GameObjects.Container {
    const h = 100;
    const playing = room.status === 'playing';
    const accent = room.locked ? COLORS.magentaDeep : playing ? COLORS.goldDeep : COLORS.violetDeep;
    const c = this.add.container(cx, cy);
    c.add(
      panel(this, 0, 0, w, h, COLORS.panel, 18, {
        glow: accent,
        rim: room.locked ? COLORS.magentaDeep : playing ? COLORS.goldNum : COLORS.strokeHi,
        rimAlpha: 0.5,
      }),
    );

    const badge = this.add.circle(-w / 2 + 42, 0, 26, accent, 0.9);
    badge.setStrokeStyle(2, COLORS.strokeHi, 0.8);
    c.add(badge);
    const badgeIcon = room.locked ? '🔒' : playing ? '🎬' : '🎲';
    c.add(this.add.text(-w / 2 + 42, 0, badgeIcon, { fontFamily: FONT_FAMILY, fontSize: '24px' }).setOrigin(0.5));

    // Lay out the right-hand stats first, so the name/host can be clipped to the
    // space that is actually left instead of spilling over them (and off the card).
    const textX = -w / 2 + 84;
    const rightX = w / 2 - 22;
    const playersText = label(this, rightX, -22, `👥 ${room.players}/${room.maxPlayers}`, 15, COLORS.text, 1).setOrigin(1, 0.5);
    const stakeText = label(this, rightX, 12, `🪙 ${formatChips(room.stake)}`, 17, COLORS.goldText, 1).setOrigin(1, 0.5);
    const maxTextW = Math.max(72, rightX - Math.max(playersText.width, stakeText.width) - 14 - textX);

    const nameText = label(this, textX, -22, room.name, 19, COLORS.text, 0).setOrigin(0, 0.5);
    const hostText = label(this, textX, 10, playing ? `игра идёт · ${room.hostName}` : `хост: ${room.hostName}`, 13, playing ? COLORS.goldText : COLORS.dim, 0).setOrigin(0, 0.5);
    clipLabel(nameText, maxTextW);
    clipLabel(hostText, maxTextW);

    c.add(nameText);
    c.add(hostText);
    c.add(playersText);
    c.add(stakeText);

    const zone = this.add
      .zone(0, 0, w, h)
      .setInteractive({ useHandCursor: true, draggable: true })
      .on('pointerup', (pointer: Phaser.Input.Pointer) => {
        // A scroll gesture ends on the card too — only a real tap joins. The
        // cards are masked to `listBounds`, but Phaser's hit test ignores
        // masks, so a scrolled-out card must not react either.
        if (pointer.getDistance() >= 10) return;
        if (pointer.y < this.listBounds.top || pointer.y > this.listBounds.bottom) return;
        this.tryJoin(room.id, room.locked);
      });
    dragTargets.push(zone);
    c.add(zone);
    return c;
  }

  private tryJoin(roomId: string, locked = false): void {
    if (this.net.status !== 'online') {
      this.pendingJoin = roomId;
      toast(this, 'Подключаемся к серверу…', COLORS.goldDeep);
      this.net.connect({ name: session.profile.name, bitaId: session.profile.equippedBita });
      return;
    }
    if (locked) this.openPasswordDialog(roomId);
    else void this.doJoin(roomId);
  }

  private async doJoin(roomId: string, password?: string): Promise<void> {
    const res = await this.net.joinRoom(roomId, password);
    if (res.error) {
      toast(this, errorText(res.error as string), COLORS.redDeep);
      return;
    }
    this.time.delayedCall(80, () => this.scene.start(SCENE_KEYS.ROOM));
  }

  /* ───────────────────────── dialogs ───────────────────────── */

  private openCodeDialog(): void {
    const m = this.openDialog(340);
    m.title('ВОЙТИ ПО КОДУ', 20);
    m.text(0, -96, 'Введите код стола, который прислал друг', 14, COLORS.dim);
    const field = m.field(0, -12, 300, 54, { placeholder: 'КОД', maxLength: 8, align: 'center', accent: COLORS.cyan, fontSize: 24 });
    m.button(-78, 76, 'ВОЙТИ', () => {
      const code = (field?.value() || '').toUpperCase();
      if (!code) return;
      m.close();
      this.tryJoin(code);
    }, { variant: 'gold', width: 140, height: 52 });
    m.button(78, 76, 'ОТМЕНА', () => m.close(), { variant: 'ghost', width: 140, height: 52 });
  }

  private openPasswordDialog(roomId: string): void {
    const m = this.openDialog(340);
    m.title('СТОЛ ЗАЩИЩЁН 🔒', 20);
    m.text(0, -96, 'Введите пароль для входа', 14, COLORS.dim);
    const field = m.field(0, -12, 300, 54, { placeholder: 'ПАРОЛЬ', maxLength: 32, align: 'center', accent: COLORS.magentaDeep, fontSize: 20, type: 'password' });
    m.button(-78, 76, 'ВОЙТИ', () => {
      const pw = field?.value() || '';
      m.close();
      void this.doJoin(roomId, pw);
    }, { variant: 'gold', width: 140, height: 52 });
    m.button(78, 76, 'ОТМЕНА', () => m.close(), { variant: 'ghost', width: 140, height: 52 });
  }

  private openCreateDialog(): void {
    if (this.dialog) return;
    const m = this.openDialog(620);
    m.title('СОЗДАТЬ СТОЛ', 22);

    m.text(0, -266, 'НАЗВАНИЕ СТОЛА', 13, COLORS.dim);
    const nameField = m.field(0, -234, 380, 46, {
      value: `Стол ${session.profile.name}`.slice(0, 24),
      maxLength: 24,
      placeholder: 'Название',
      accent: COLORS.strokeHi,
    });

    m.text(0, -196, 'СТАВКА ЗА ИГРОКА (🪙)', 13, COLORS.dim);
    const stakeField = m.field(0, -164, 200, 46, { value: '100', type: 'number', align: 'center', accent: COLORS.goldNum, fontSize: 20 });
    ONLINE.STAKE_PRESETS.forEach((preset, i) => {
      m.button(-150 + i * 75, -114, String(preset), () => stakeField?.setValue(String(preset)), {
        variant: 'ghost',
        size: 'sm',
        width: 66,
        height: 38,
        fontSize: 14,
      });
    });

    m.text(0, -74, 'ИГРОКОВ ЗА СТОЛОМ', 13, COLORS.dim);
    let seats = 4;
    const seatsText = this.add
      .text(0, -42, '4', { fontFamily: FONT_FAMILY, fontSize: '24px', color: COLORS.goldText, fontStyle: 'bold' })
      .setOrigin(0.5);
    m.add(seatsText);
    m.button(-90, -42, '−', () => {
      seats = Math.max(ONLINE.MIN_PLAYERS, seats - 1);
      seatsText.setText(String(seats));
    }, { variant: 'ghost', size: 'sm', width: 48, height: 44 });
    m.button(90, -42, '+', () => {
      seats = Math.min(ONLINE.MAX_PLAYERS, seats + 1);
      seatsText.setText(String(seats));
    }, { variant: 'ghost', size: 'sm', width: 48, height: 44 });

    let isPublic = true;
    const publicBtn = m.button(0, 6, '🌐 ПУБЛИЧНЫЙ СТОЛ', () => {
      isPublic = !isPublic;
      publicBtn.setText(isPublic ? '🌐 ПУБЛИЧНЫЙ СТОЛ' : '🔒 ТОЛЬКО ПО ССЫЛКЕ');
      publicBtn.setFill(isPublic ? COLORS.emeraldDeep : COLORS.magentaDeep);
    }, { fill: COLORS.emeraldDeep, size: 'sm', width: 320, height: 44 });

    m.text(0, 46, 'ПАРОЛЬ (НЕОБЯЗАТЕЛЬНО)', 13, COLORS.dim);
    const pwField = m.field(-42, 78, 240, 46, { placeholder: 'без пароля', maxLength: 32, accent: COLORS.magentaDeep });
    m.button(132, 78, '🎲', () => pwField?.setValue(String(Math.floor(1000 + Math.random() * 9000))), {
      variant: 'ghost',
      size: 'sm',
      width: 60,
      height: 46,
    });

    m.button(0, 152, 'СОЗДАТЬ И ИГРАТЬ', () => {
      const name = nameField?.value() || `Стол ${session.profile.name}`;
      const stake = clampStake(stakeField?.number() ?? 100);
      const password = pwField?.value() || null;
      void this.doCreate({ name, stake, maxPlayers: seats, isPublic, password });
    }, { variant: 'gold', size: 'lg', width: 340, height: 58, glow: true });
    m.button(0, 222, 'ОТМЕНА', () => m.close(), { variant: 'ghost', size: 'sm', width: 160, height: 40 });
  }

  private async doCreate(cfg: { name: string; stake: number; maxPlayers: number; isPublic: boolean; password: string | null }): Promise<void> {
    if (this.net.status !== 'online') {
      toast(this, 'Нет связи с сервером', COLORS.redDeep);
      return;
    }
    if (cfg.stake > session.profile.balance) {
      toast(this, 'Недостаточно фишек для такой ставки', COLORS.redDeep);
      return;
    }
    const res = await this.net.createRoom(cfg);
    if (res.error) {
      toast(this, errorText(res.error as string), COLORS.redDeep);
      return;
    }
    this.dialog?.close();
    this.scene.start(SCENE_KEYS.ROOM);
  }

  /* ───────────────────────── modal helper ───────────────────────── */

  /**
   * Build a centered modal. Children are positioned **relative to the centre**;
   * the helper owns them so closing destroys everything (buttons included) and
   * clears any DOM fields.
   */
  private openDialog(height: number): DialogApi {
    this.dialog?.close();
    const backdrop = this.add.rectangle(W / 2, H / 2, W, H, 0x05030f, 0.82).setDepth(2000).setInteractive();
    const root = this.add.container(W / 2, H / 2).setDepth(2010);
    root.add(
      panel(this, 0, 0, W - 40, height, COLORS.panel, 24, { glow: COLORS.violetDeep, rim: COLORS.strokeGold, rimAlpha: 0.5 }),
    );
    const titleText = this.add
      .text(0, -height / 2 + 22, '', { fontFamily: FONT_FAMILY, fontSize: '22px', color: COLORS.goldText, fontStyle: 'bold' })
      .setOrigin(0.5);
    titleText.setShadow(0, 3, '#000000aa', 6);
    root.add(titleText);

    let closed = false;
    const api: DialogApi = {
      root,
      add: (o) => root.add(o),
      title: (t, size = 22) => {
        titleText.setText(t).setFontSize(size);
      },
      text: (dx, dy, t, size, color) => {
        const tx = this.add.text(dx, dy, t, { fontFamily: FONT_FAMILY, fontSize: `${size}px`, color, align: 'center' }).setOrigin(0.5);
        root.add(tx);
        return tx;
      },
      button: (dx, dy, t, onClick, opts) => {
        const b = new Button(this, dx, dy, t, onClick, opts);
        root.add(b);
        return b;
      },
      field: (dx, dy, w, h, opts) => {
        const f = domField(this, W / 2 + dx, H / 2 + dy, w, h, opts);
        if (f) this.domFields.push(f);
        return f;
      },
      close: () => {
        if (closed) return;
        closed = true;
        root.destroy(true);
        backdrop.destroy();
        this.clearDom();
        if (this.dialog === api) this.dialog = null;
      },
    };
    backdrop.on('pointerdown', api.close);

    root.setScale(0.9).setAlpha(0);
    this.tweens.add({ targets: root, scale: 1, alpha: 1, duration: 240, ease: 'Back.easeOut' });
    this.dialog = api;
    return api;
  }
}

function formatChips(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return String(n);
}

/** Trim a label down with an ellipsis until it fits `maxW` logical pixels. */
function clipLabel(text: Phaser.GameObjects.Text, maxW: number): void {
  if (text.width <= maxW) return;
  const full = text.text;
  for (let n = full.length - 1; n > 0; n--) {
    text.setText(`${full.slice(0, n)}…`);
    if (text.width <= maxW) return;
  }
  text.setText('…');
}

function clampStake(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.max(ONLINE.MIN_STAKE, Math.min(ONLINE.MAX_STAKE, Math.floor(n)));
}
