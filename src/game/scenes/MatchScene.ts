import Phaser from 'phaser';
import { AI, CHARGE, GAME_HEIGHT, GAME_WIDTH, MISS, MOVES, SCENE_KEYS, SMASH } from '../Constants';
import { session } from '../State';
import { getBita } from '../data/Bitas';
import { getChip } from '../data/Chips';
import { Rng } from '../Rng';
import { spendChips, uniqueChips } from '../systems/Economy';
import { bitaLevel } from '../systems/Forge';
import {
  createMatch,
  expectedFlips,
  flipChance,
  pickAiFocus,
  pickAiMove,
  pickAiPower,
  playTurn,
  powerOf,
  winner,
  type MatchConfig,
} from '../systems/MatchEngine';
import { recordLeaderboard, settleMatch } from '../systems/Progression';
import { net } from '../net/Net';
import { getSettings } from '../systems/Settings';
import type { BitaDef, ChipInstance, MatchState, MoveKind, SmashReport } from '../Types';
import { ChipView } from '../ui/ChipView';
import { COLORS, FONT_FAMILY, TEXT_COLORS, css, darken, heatColor, lighten, rarityColor } from '../ui/Theme';
import { Button, HoldPad, MoveBar, label, modal, panel, toast, type Modal } from '../ui/Widgets';
import { bindKeys, type KeyAction } from '../ui/Keys';
import { ChipTooltip, type TooltipLine } from '../ui/Tooltip';
import {
  burst,
  coinRain,
  countUp,
  flash,
  floatText,
  glowSprite,
  hitStop,
  installBackground,
  popIn,
  rayBurst,
  shake,
} from '../ui/Fx';
import { audio, silenceAll } from '../ui/Audio';

interface MatchSceneData {
  stake: number;
  opponentIsAI: boolean;
}

const PLAYER_POS: { x: number; y: number }[] = [
  { x: 118, y: 152 },
  { x: 362, y: 152 },
];

/* ── layout (logical 480 × 800) ─────────────────────────────────────────── */
const STACK_CX = GAME_WIDTH / 2;
const STACK_CY = 396;
/** Tallest the rendered column may grow (px). */
const STACK_SPAN = 150;
const FELT = { x: 16, y: 236, w: GAME_WIDTH - 32, h: 312 };
const FELT_TOP = 0x10493b;
const FELT_BOTTOM = 0x072a24;
/** Where the smasher's hand rests (player 0 bottom-left, player 1 top-right). */
const SLAMMER_HOME: { x: number; y: number }[] = [
  { x: 96, y: 500 },
  { x: 384, y: 300 },
];
const GAUGE = { left: 70, right: 410, y: 650 };
/** Y of the special-move picker, between the combo meter and the power gauge. */
const MOVE_BAR_Y = 600;

const PM_MIN = SMASH.POWER_MULT_MIN;
const PM_MAX = SMASH.POWER_MULT_MAX;

/** Chip cost of each special move (used for the HUD + denial toasts). */
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

/** Look up a bita without throwing on stale/unknown ids. */
function getBitaSafe(id: string | null | undefined): BitaDef | null {
  if (!id) return null;
  try {
    return getBita(id);
  } catch {
    return null;
  }
}

/** Promise wrapper for a single-shot tween (keeps the smash flow linear). */
function tweenTo(scene: Phaser.Scene, targets: object, props: object): Promise<void> {
  return new Promise((resolve) => {
    scene.tweens.add({
      targets,
      ...props,
      onComplete: () => resolve(),
    } as Phaser.Types.Tweens.TweenBuilderConfig);
  });
}

/** Promise wrapper for a one-off delayed call (between two passes of a turn). */
function wait(scene: Phaser.Scene, ms: number): Promise<void> {
  return new Promise((resolve) => {
    scene.time.delayedCall(ms, resolve);
  });
}

/**
 * The core "сотки" match.
 *
 * The stack is rendered as a real **column** (столбик): you aim a slammer at a
 * spot on the column, hit it, and the flipped chips fly to your collection while
 * the survivors collapse back into a neat pile.
 *
 * Controls ("как бросок камня"): press & hold anywhere in the play area — the
 * power meter sweeps up and down while you hold, and dragging over the column
 * slides the aim reticle. Release to strike. All rules live in
 * `systems/MatchEngine.ts`; this scene is presentation + input only.
 */
export class MatchScene extends Phaser.Scene {
  private stake = 10;
  private vsAI = true;
  private state!: MatchState;
  private rng!: Rng;

  /* ── HUD ── */
  private statusText!: Phaser.GameObjects.Text;
  private stackText!: Phaser.GameObjects.Text;
  private p0Count!: Phaser.GameObjects.Text;
  private p1Count!: Phaser.GameObjects.Text;
  private p0Panel!: Phaser.GameObjects.Graphics;
  private p1Panel!: Phaser.GameObjects.Graphics;
  private p0Glow!: Phaser.GameObjects.Image;
  private p1Glow!: Phaser.GameObjects.Image;

  /* ── stack column ── */
  private stackViews: ChipView[] = [];
  private columnTop = STACK_CY;
  private columnBottom = STACK_CY;
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
  private powerMultiplier: number = PM_MIN;
  private reticleG!: Phaser.GameObjects.Graphics;
  private slammer!: Phaser.GameObjects.Container;
  private holdPad!: HoldPad;
  private moveBar!: MoveBar;
  /** Move armed for the next smash (`normal` = plain punch). */
  private pendingMove: MoveKind = 'normal';

  /* ── meters ── */
  private gaugeG!: Phaser.GameObjects.Graphics;
  private powerPct!: Phaser.GameObjects.Text;
  private expectedLabel!: Phaser.GameObjects.Text;
  private heatG!: Phaser.GameObjects.Graphics;
  private heatLabel!: Phaser.GameObjects.Text;
  private comboOwner = -1;
  private combo = 0;

  private busy = false;
  private finished = false;

  constructor() {
    super(SCENE_KEYS.MATCH);
  }

  init(data: MatchSceneData): void {
    this.stake = data?.stake ?? 10;
    this.vsAI = data?.opponentIsAI ?? true;
  }

  create(): void {
    const p = session.profile;

    // Ante. MenuScene already validated affordability, but guard anyway.
    if (!spendChips(p, this.stake)) {
      this.scene.start(SCENE_KEYS.MENU);
      return;
    }
    session.save();

    this.rng = session.rng;
    this.busy = false;
    this.finished = false;
    this.stackViews = [];
    this.comboOwner = -1;
    this.combo = 0;
    this.charging = false;
    this.chargeT = 0;
    this.chargeDir = 1;
    this.aimT = 0.5;
    this.powerMultiplier = PM_MIN;

    const aiBita = this.vsAI ? this.pickAiBita() : null;
    const config: MatchConfig = {
      stake: this.stake,
      playerName: p.name,
      opponentName: this.vsAI ? '🤖 ИИ' : 'Игрок 2',
      opponentIsAI: this.vsAI,
      playerBitaId: p.equippedBita,
      opponentBitaId: aiBita,
      playerBitaLevel: bitaLevel(p, p.equippedBita),
      opponentBitaLevel: 1,
    };
    this.state = createMatch(config, this.rng);

    this.cameras.main.setBackgroundColor(COLORS.bg);
    installBackground(this, { chips: false });
    this.tooltip = new ChipTooltip(this);
    this.buildBoard();
    this.buildStack();
    this.buildControls();

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.unbindKeys = bindKeys(this, {
      down: (action, event) => this.onKeyDown(action, event),
      up: (action) => this.onKeyUp(action),
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('pointerdown', this.onPointerDown, this);
      this.input.off('pointermove', this.onPointerMove, this);
      this.input.off('pointerup', this.onPointerUp, this);
      this.unbindKeys?.();
      this.tooltip.destroy();
      silenceAll();
    });

    this.updateHud();
    this.updateTurnUi();
    this.maybeAiTurn();
  }

  /* ───────────── board ───────────── */

  private pickAiBita(): string | null {
    const owned = session.profile.equippedBita;
    return owned ?? (this.rng.chance(0.35) ? 'bit_plastic' : null);
  }

  private buildBoard(): void {
    // Stake pill.
    const pill = this.add.graphics().setDepth(50);
    pill.fillStyle(0x000000, 0.35);
    pill.fillRoundedRect(GAME_WIDTH / 2 - 92, 18, 184, 32, 16);
    pill.fillGradientStyle(lighten(COLORS.goldDeep, 0.15), COLORS.goldDeep, darken(COLORS.goldDeep, 0.1), COLORS.goldDark, 1);
    pill.fillRoundedRect(GAME_WIDTH / 2 - 90, 20, 180, 28, 14);
    pill.lineStyle(1.5, lighten(COLORS.goldNum, 0.2), 0.7);
    pill.strokeRoundedRect(GAME_WIDTH / 2 - 90, 20, 180, 28, 14);
    label(this, GAME_WIDTH / 2, 34, `СТАВКА ${this.stake} × 2`, 12, '#1a0f04').setDepth(51);

    new Button(this, 440, 34, '🏳', () => this.forfeit(), {
      width: 46,
      height: 44,
      variant: 'danger',
      radius: 12,
      glow: false,
      fontSize: 16,
    }).setDepth(60);

    this.statusText = label(this, GAME_WIDTH / 2, 80, '', 14, COLORS.text).setDepth(60);

    this.buildPlayerCard(0);
    this.buildPlayerCard(1);

    // Felt.
    const felt = this.add.graphics().setDepth(-100);
    felt.fillGradientStyle(FELT_TOP, FELT_TOP, FELT_BOTTOM, FELT_BOTTOM, 1);
    felt.fillRoundedRect(FELT.x, FELT.y, FELT.w, FELT.h, 28);
    felt.lineStyle(2, lighten(FELT_TOP, 0.18), 0.45);
    felt.strokeRoundedRect(FELT.x, FELT.y, FELT.w, FELT.h, 28);
    glowSprite(this, STACK_CX, STACK_CY, COLORS.goldNum, 4.4, 0.05).setDepth(-110);

    this.stackText = label(this, STACK_CX, 262, '', 13, COLORS.dim).setDepth(50);
  }

  private buildPlayerCard(index: 0 | 1): void {
    const { x, y } = PLAYER_POS[index];
    const pl = this.state.players[index];
    const bita = getBitaSafe(pl.bitaId);

    const g = this.add.graphics().setDepth(5);
    this.paintPanel(g, x, y, index, false);
    if (index === 0) this.p0Panel = g;
    else this.p1Panel = g;

    const glow = glowSprite(this, x, y, index === 0 ? COLORS.cyan : COLORS.magenta, 2.2, 0).setDepth(4);
    if (index === 0) this.p0Glow = glow;
    else this.p1Glow = glow;

    // Avatar.
    const av = this.add.circle(x - 74, y, 26, COLORS.panelHi, 1).setDepth(7);
    av.setStrokeStyle(2.5, index === 0 ? COLORS.cyan : COLORS.magenta, 0.9);
    label(this, x - 74, y, (pl.name || '?').trim().slice(0, 2).toUpperCase(), 18, '#ffffff').setDepth(8);

    // Name + bita.
    label(this, x - 40, y - 30, pl.name, 15, COLORS.text, 0).setDepth(8);
    label(this, x - 40, y - 11, bita ? `${bita.face} ${bita.name}` : '✊ без биты', 11, COLORS.dim, 0).setDepth(8);
    label(this, x - 40, y + 11, 'выбито', 10, COLORS.dim, 0).setDepth(8);

    // Big count.
    const count = label(this, x + 78, y, '0', 32, COLORS.gold, 1).setDepth(8);
    count.setShadow(0, 2, '#000000aa', 4);
    if (index === 0) this.p0Count = count;
    else this.p1Count = count;
  }

  private paintPanel(g: Phaser.GameObjects.Graphics, x: number, y: number, index: 0 | 1, active: boolean): void {
    const accent = index === 0 ? COLORS.cyan : COLORS.magenta;
    const w = 208;
    const h = 104;
    g.clear();
    if (active) {
      g.fillStyle(accent, 0.25);
      g.fillRoundedRect(x - w / 2 - 5, y - h / 2 - 4, w + 10, h + 10, 20);
    }
    g.fillGradientStyle(
      active ? lighten(COLORS.panel, 0.08) : COLORS.panel,
      COLORS.panel,
      darken(COLORS.panel, 0.25),
      darken(COLORS.panel, 0.3),
      1,
    );
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 16);
    g.fillStyle(0xffffff, 0.05);
    g.fillRoundedRect(x - w / 2 + 3, y - h / 2 + 3, w - 6, 34, 12);
    g.lineStyle(active ? 3.5 : 2, active ? accent : COLORS.stroke, active ? 1 : 0.6);
    g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 16);
  }

  private highlightCard(): void {
    const cur = this.state.current;
    this.paintPanel(this.p0Panel, PLAYER_POS[0].x, PLAYER_POS[0].y, 0, cur === 0);
    this.paintPanel(this.p1Panel, PLAYER_POS[1].x, PLAYER_POS[1].y, 1, cur === 1);
    this.tweens.add({ targets: cur === 0 ? this.p0Glow : this.p1Glow, alpha: 0.45, duration: 260 });
    this.tweens.add({ targets: cur === 0 ? this.p1Glow : this.p0Glow, alpha: 0, duration: 260 });
  }

  /* ───────────── stack column ───────────── */

  private buildStack(): void {
    for (const chip of this.state.stack) {
      const view = new ChipView(this, STACK_CX, STACK_CY, chip.defId, 26, false);
      this.attachChipHover(view);
      this.stackViews.push(view);
    }
    this.layoutStack(false);
  }

  /**
   * Lay the (possibly huge) stack out as a physical column. `depth` is bounded
   * so chips always render *behind* the HUD; the top-most chip of the stack
   * (index 0) sits at the top of the column.
   */
  private layoutStack(animate: boolean): void {
    const views = this.stackViews;
    const n = views.length;
    if (n === 0) {
      this.columnTop = STACK_CY;
      this.columnBottom = STACK_CY;
      return;
    }

    const step = n > 1 ? Math.min(7, STACK_SPAN / (n - 1)) : 0;
    const span = step * (n - 1);
    const top = STACK_CY - span / 2;
    const bottom = STACK_CY + span / 2;
    this.columnTop = top;
    this.columnBottom = bottom;

    const radius = Phaser.Math.Clamp(30 - n * 0.16, 11, 27);
    const baseScale = radius / 26;
    const last = Math.max(1, n - 1);

    for (let i = 0; i < n; i++) {
      const v = views[i];
      const jitter = ((i * 37) % 9) - 4;
      const x = STACK_CX + jitter * 1.7;
      const y = top + i * step;
      const s = baseScale * (0.93 + ((i * 53) % 9) / 100);
      // Lower chips sit "inside" the pile, so they draw first.
      v.setDepth(40 - (i / last) * 30);
      if (animate) {
        this.tweens.add({ targets: v, x, y, duration: 260, delay: i * 4, ease: 'Cubic.easeOut' });
      } else {
        v.setPosition(x, y);
      }
      v.setScale(s);
    }
  }

  /* ───────────── controls ───────────── */

  private buildControls(): void {
    this.reticleG = this.add.graphics().setDepth(45);
    this.buildSlammer();

    this.heatLabel = label(this, 70, 556, '', 12, COLORS.dim, 0).setDepth(60);
    this.heatG = this.add.graphics().setDepth(60);
    this.updateHeat();

    this.buildPowerGauge();

    // Special-move picker — arms a move for the next smash.
    this.moveBar = new MoveBar(this, GAME_WIDTH / 2, MOVE_BAR_Y, {
      width: 130,
      height: 34,
      gap: 15,
      onPick: (move) => this.onMovePick(move),
      onDenied: (move) => {
        const cost = MOVE_COSTS[move];
        toast(this, `нужно ${cost} ${cost === 1 ? 'фишка' : 'фишки'} в отбое`, COLORS.redDeep);
      },
    });
    this.moveBar.setDepth(60);

    this.holdPad = new HoldPad(this, GAME_WIDTH / 2, 716, '🥊  ЗАЖМИ', {
      width: 372,
      height: 68,
      variant: 'danger',
      fontSize: 22,
      radius: 20,
      glow: true,
    });
    this.holdPad.setDepth(60);

    label(this, GAME_WIDTH / 2, 778, 'зажмите · ведите по стопке · отпустите', 11, COLORS.dim).setDepth(60);
  }

  private buildSlammer(): void {
    const c = this.add.container(SLAMMER_HOME[0].x, SLAMMER_HOME[0].y).setDepth(48);

    const glow = glowSprite(this, 0, 0, COLORS.goldNum, 1.5, 0.45);
    const p = session.profile;
    const bita = getBitaSafe(p.equippedBita);
    const body = this.add.circle(0, 0, 26, bita ? bita.color : COLORS.panelHi, 1);
    body.setStrokeStyle(3, bita ? lighten(bita.color, 0.5) : COLORS.goldNum, 1);
    const face = this.add
      .text(0, 0, bita ? bita.face : '✊', { fontFamily: FONT_FAMILY, fontSize: '28px', color: '#ffffff' })
      .setOrigin(0.5);
    face.setShadow(0, 2, '#00000088', 3);

    c.add([glow, body, face]);
    this.slammer = c;
  }

  private buildPowerGauge(): void {
    this.gaugeG = this.add.graphics().setDepth(60);

    label(this, GAUGE.left, GAUGE.y - 26, 'СИЛА УДАРА', 12, COLORS.dim, 0).setDepth(60);
    this.powerPct = label(this, GAUGE.right + 12, GAUGE.y, '', 15, COLORS.gold, 0).setDepth(60);
    this.expectedLabel = label(this, GAME_WIDTH / 2, GAUGE.y + 28, '', 12, COLORS.dim).setDepth(60);

    this.drawGauge();
  }

  private drawGauge(): void {
    const t = Phaser.Math.Clamp((this.powerMultiplier - PM_MIN) / (PM_MAX - PM_MIN), 0, 1);
    const col = heatColor(t);
    const { left, right, y } = GAUGE;
    const w = right - left;
    const g = this.gaugeG;
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

    // Marker.
    const mx = left + w * t;
    g.fillStyle(0xffffff, 1);
    g.fillCircle(mx, y, 8);
    g.lineStyle(3, col, 1);
    g.strokeCircle(mx, y, 8);

    this.powerPct.setText(`${Math.round(this.powerMultiplier * 100)}%`);
  }

  private drawReticle(): void {
    const g = this.reticleG;
    g.clear();
    if (this.finished || this.state.status !== 'active') return;
    if (this.state.players[this.state.current].isAI) return;

    const y = this.columnTop + this.aimT * (this.columnBottom - this.columnTop);
    const col = this.charging ? heatColor(this.chargeT) : COLORS.goldNum;
    const a = this.charging ? 1 : 0.62;

    g.lineStyle(3, col, a * 0.8);
    for (let x = STACK_CX - 86; x < STACK_CX + 86; x += 14) g.lineBetween(x, y, x + 8, y);

    g.fillStyle(col, a);
    g.fillTriangle(STACK_CX - 100, y - 10, STACK_CX - 100, y + 10, STACK_CX - 84, y);
    g.fillTriangle(STACK_CX + 100, y - 10, STACK_CX + 100, y + 10, STACK_CX + 84, y);

    g.lineStyle(3, col, a);
    g.strokeCircle(STACK_CX, y, 24 + (this.charging ? this.chargeT * 12 : 0));
  }

  /* ───────────── hover tooltips ───────────── */

  /** Make a stack chip explain its weight and the current flip chance. */
  private attachChipHover(view: ChipView): void {
    view.setInteractive(new Phaser.Geom.Circle(0, 0, 27), Phaser.Geom.Circle.Contains);
    view.on('pointerover', () => this.showChipTooltip(view));
    view.on('pointerout', () => this.tooltip.hide());
  }

  private showChipTooltip(view: ChipView): void {
    if (!getSettings().tooltips || this.finished || this.leaveOpen) return;
    const depth = this.stackViews.indexOf(view);
    if (depth < 0) return;
    const def = getChip(view.defId);
    const lines: TooltipLine[] = [
      { text: 'Фишка в стопке', title: true, color: COLORS.text },
      { text: `вес ${def.weight.toFixed(1)} · чем тяжелее, тем крепче`, color: css(rarityColor(def.rarity)) },
    ];
    const cur = this.state.players[this.state.current];
    if (!cur.isAI && !this.busy && this.state.status === 'active') {
      const { power } = powerOf(this.state, this.state.current);
      const chance = flipChance(power, def.weight, depth, this.powerMultiplier, {
        focus: this.aimT,
        span: Math.max(1, this.state.stack.length),
        bonus: cur.focusBonus,
      });
      lines.push({ text: `шанс перебить ≈ ${Math.round(chance * 100)}%`, color: COLORS.gold });
    }
    this.tooltip.show(lines, rarityColor(def.rarity), view.x, view.y);
  }

  /* ───────────── keyboard ───────────── */

  private onKeyDown(action: KeyAction, event: KeyboardEvent): void {
    if (action === 'esc') {
      if (this.leaveOpen) this.leaveModal?.close();
      else if (!this.finished) this.confirmLeave();
      return;
    }
    if (this.leaveOpen) return;
    if (this.finished || this.busy || this.state.status !== 'active') return;
    if (this.state.players[this.state.current].isAI) return;

    if (action === 'space') {
      if (event.repeat || this.charging) return;
      this.startKeyboardCharge();
    } else if (action === 'up' || action === 'left') {
      this.nudgeAim(-0.04);
    } else if (action === 'down' || action === 'right') {
      this.nudgeAim(0.04);
    } else if (action === 'one') {
      this.moveBar.choose('precise');
    } else if (action === 'two') {
      this.moveBar.choose('brace');
    } else if (action === 'three') {
      this.moveBar.choose('double');
    }
  }

  private onKeyUp(action: KeyAction): void {
    if (action === 'space' && this.charging && !this.leaveOpen) this.releaseCharge();
  }

  private startKeyboardCharge(): void {
    this.tooltip.hide();
    this.charging = true;
    this.chargeT = 0;
    this.chargeDir = 1;
    this.updateChargeVisual();
    audio.chargeStart();
  }

  private nudgeAim(delta: number): void {
    this.aimT = Phaser.Math.Clamp(this.aimT + delta, 0, 1);
    this.drawReticle();
    this.updatePowerEstimate();
  }

  /** `Esc` / the desktop shell's "back" action: confirm before forfeiting. */
  private confirmLeave(): void {
    if (this.leaveOpen || this.finished) return;
    this.leaveOpen = true;
    if (this.charging) {
      this.charging = false;
      audio.chargeStop();
      this.holdPad.setProgress(0, false);
    }
    this.tooltip.hide();
    this.moveBar.setEnabled(false);

    const m = modal(this, 'ПОКИНУТЬ ПАРТИЮ?', {
      height: 280,
      onClose: () => {
        this.leaveOpen = false;
        this.leaveModal = null;
        if (!this.finished) this.updateTurnUi();
      },
    });
    this.leaveModal = m;
    m.root.add(label(this, 0, -46, 'Ставка не возвращается,\nа партия засчитается как поражение.', 14, COLORS.dim));
    m.root.add(new Button(this, -72, 62, 'Отмена', () => m.close(), { width: 128, height: 50, variant: 'ghost' }));
    m.root.add(
      new Button(
        this,
        72,
        62,
        'Выйти',
        () => {
          m.close();
          this.forfeit();
        },
        { width: 128, height: 50, variant: 'danger' },
      ),
    );
  }

  /* ───────────── smash input ───────────── */

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.leaveOpen) return;
    if (this.busy || this.finished || this.state.status !== 'active') return;
    if (this.state.players[this.state.current].isAI) return;
    if (p.y < 224) return; // HUD / cards / forfeit are not part of the play area.

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

  /** Map a pointer y inside the play area onto the column's aim position. */
  private setAimFromPointer(p: Phaser.Input.Pointer): void {
    const top = this.columnTop - 30;
    const bottom = this.columnBottom + 30;
    if (p.y < top || p.y > bottom) return;
    this.aimT = Phaser.Math.Clamp((p.y - top) / Math.max(1, bottom - top), 0, 1);
  }

  private updateChargeVisual(): void {
    this.chargeT = Phaser.Math.Clamp(this.chargeT, 0, 1);
    this.powerMultiplier = PM_MIN + this.chargeT * (PM_MAX - PM_MIN);
    this.drawGauge();
    this.drawReticle();
    this.updatePowerEstimate();
    this.holdPad.setText(`🥊  ${Math.round(this.powerMultiplier * 100)}%`);
    this.holdPad.setProgress(this.chargeT, true);
    audio.chargeSet(this.chargeT);

    const cur = this.state.current as 0 | 1;
    const home = SLAMMER_HOME[cur];
    this.slammer.setAlpha(1);
    this.slammer.setPosition(home.x, home.y - this.chargeT * 6);
    this.slammer.setAngle(-this.chargeT * 38);
    this.slammer.setScale(1 + this.chargeT * 0.12);
  }

  private releaseCharge(): void {
    if (!this.charging) return;
    this.charging = false;
    audio.chargeStop();
    this.powerMultiplier = PM_MIN + this.chargeT * (PM_MAX - PM_MIN);
    void this.performSmash();
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

  /* ───────────── turn flow ───────────── */

  private maybeAiTurn(): void {
    if (this.finished || this.state.status !== 'active') return;
    const idx = this.state.current;
    if (!this.state.players[idx].isAI) return;

    this.busy = true;
    this.charging = false;
    this.reticleG.clear();
    this.holdPad.setPadEnabled(false);
    this.holdPad.setText('🤖  соперник бьёт');
    this.statusText.setText('🤖  соперник замахивается…');
    this.placeSlammer(1);

    this.time.delayedCall(AI.THINK_MS + this.rng.int(120, 260), () => {
      if (this.finished) return;
      // A living opponent: it picks a real power, aims at a sweet spot by
      // scoring the column, and sometimes spends a special move.
      this.powerMultiplier = pickAiPower(this.rng, AI.SKILL);
      this.aimT = pickAiFocus(this.state, idx, this.rng, AI.SKILL, this.powerMultiplier);
      this.pendingMove = pickAiMove(this.state, idx, this.rng);
      this.moveBar.setAffordable(this.state.players[idx].collected.length);
      this.moveBar.select(this.pendingMove);
      this.drawGauge();
      this.updatePowerEstimate();
      void this.performSmash();
    });
  }

  /** The human tapped a special move: refresh the read-outs. */
  private onMovePick(move: MoveKind): void {
    this.pendingMove = move;
    audio.click();
    this.updatePowerEstimate();
    if (move !== 'normal') {
      toast(this, `${MOVE_BANNER[move]} · ${MOVE_COSTS[move]} фишки`, COLORS.goldDeep, 560);
    }
  }

  private async performSmash(): Promise<void> {
    if (this.finished) return;
    this.busy = true;
    this.charging = false;
    this.tooltip.hide();
    audio.chargeStop();
    this.holdPad.setPadEnabled(false);
    this.reticleG.clear();

    const move: MoveKind =
      this.state.players[this.state.current].isAI
        ? this.pendingMove
        : this.moveBar.picked;

    const turn = playTurn(this.state, this.rng, {
      powerMultiplier: this.powerMultiplier,
      focus: this.aimT,
      move,
    });

    this.moveBar.clear();
    this.pendingMove = 'normal';

    for (let i = 0; i < turn.reports.length; i++) {
      if (i > 0) await wait(this, 240);
      await this.animateSmash(turn.reports[i], i === 0);
    }

    // The engine shuffled the survivors and may have paid the move's chips back
    // into the pot — resync the column to the logical stack before the next turn.
    this.syncStackViews();
    this.updateHud();

    if (this.state.status === 'finished') {
      this.finish();
      return;
    }

    this.busy = false;
    this.updateTurnUi();
    if (this.state.players[this.state.current].isAI) this.maybeAiTurn();
  }

  /**
   * Re-order the on-screen column so `stackViews[i]` really is `state.stack[i]`.
   *
   * Chips are matched by `defId` (two identical chips are visually
   * interchangeable), and any chip that appeared in the pot during the turn —
   * e.g. one paid for a special move — gets a fresh face-down view at the
   * bottom. Without this the reveal animation would flip the wrong tokens
   * whenever the engine reshuffles.
   */
  private syncStackViews(): void {
    this.tooltip.hide();
    const pool = this.stackViews.slice();
    const next: ChipView[] = [];
    for (const chip of this.state.stack) {
      const at = pool.findIndex((v) => v.defId === chip.defId);
      if (at >= 0) next.push(pool.splice(at, 1)[0]);
      else {
        const view = new ChipView(this, STACK_CX, STACK_CY, chip.defId, 26, false);
        this.attachChipHover(view);
        next.push(view);
      }
    }
    for (const v of pool) v.destroy();
    this.stackViews = next;
    this.layoutStack(true);
    this.updateHeat();
  }

  /** Visualise a smash: fly the slammer in, flip the right chips, restack. */
  private async animateSmash(report: SmashReport, first = true): Promise<void> {
    const pIdx = report.playerIndex;
    const flippedSet = new Set(report.flippedIndices);

    const flippedViews: ChipView[] = [];
    const remainingViews: ChipView[] = [];
    this.stackViews.forEach((v, i) => {
      if (flippedSet.has(i)) flippedViews.push(v);
      else remainingViews.push(v);
    });
    this.stackViews = remainingViews;

    // Slammer dives onto the aimed spot.
    const targetY = this.columnTop + this.aimT * (this.columnBottom - this.columnTop);
    this.slammer.setDepth(48);
    await tweenTo(this, this.slammer, {
      x: STACK_CX + 66,
      y: targetY,
      angle: -150,
      duration: 130,
      ease: 'Quad.easeIn',
    });

    const strong = flippedViews.length > 0;
    const mag = Math.min(0.016, strong ? 0.004 + (this.powerMultiplier - 1) * 0.007 : 0.002);
    shake(this, Math.max(0.002, mag), 130);
    burst(this, STACK_CX, targetY, {
      count: strong ? 26 + flippedViews.length * 2 : 10,
      color: strong ? COLORS.goldNum : 0x8892b0,
      speed: 180 + this.powerMultiplier * 90,
      scale: 0.8,
      lifespan: 440,
    });

    // Feel: woody clack, wood-dust weight and a bright crit on a big swing.
    const power01 = Phaser.Math.Clamp((this.powerMultiplier - PM_MIN) / (PM_MAX - PM_MIN), 0, 1);
    audio.smash(power01);
    const crit = flippedViews.length >= 4;
    if (strong) {
      hitStop(this, crit ? 120 : 70, crit ? 0.18 : 0.42);
    } else {
      audio.miss();
    }
    if (crit) {
      audio.crit();
      flash(this, 140, 255, 220, 160);
      floatText(this, STACK_CX, targetY - 40, '💥 КРИТ!', TEXT_COLORS.magenta, 22);
    } else if (this.powerMultiplier > 1.5) {
      flash(this, 90, 255, 220, 160);
    }

    // Special-move call-outs: which move is firing, and the modifiers in play.
    if (first && report.move && report.move !== 'normal') {
      floatText(this, STACK_CX, targetY - 64, MOVE_BANNER[report.move], TEXT_COLORS.cyan, 20);
    }
    if (report.precise) {
      floatText(this, STACK_CX - 92, targetY + 30, '🎯 точно', TEXT_COLORS.cyan, 15);
    }
    if (report.weakened) {
      floatText(this, STACK_CX + 96, targetY - 30, '🛡 ослаблен', TEXT_COLORS.magenta, 15);
    }

    // Cosmetic combo meter.
    if (strong) {
      if (this.comboOwner === pIdx) this.combo += 1;
      else {
        this.comboOwner = pIdx;
        this.combo = 1;
      }
    } else if (this.comboOwner === pIdx) {
      this.combo = 0;
    }

    await Promise.all(flippedViews.map((v, idx) => this.collectChip(v, pIdx, idx)));

    // Survivors collapse back into a neat column.
    this.layoutStack(true);
    this.updateHeat();

    if (strong) {
      floatText(this, PLAYER_POS[pIdx].x, PLAYER_POS[pIdx].y + 44, `+${flippedViews.length}`, TEXT_COLORS.gold, 18);
      burst(this, PLAYER_POS[pIdx].x, PLAYER_POS[pIdx].y, {
        count: 14,
        color: pIdx === 0 ? COLORS.cyan : COLORS.magenta,
        speed: 180,
      });
    }

    if (report.bonus) this.showBonus(report.bonus);

    // Slammer returns to the hand.
    const home = SLAMMER_HOME[pIdx];
    await tweenTo(this, this.slammer, {
      x: home.x,
      y: home.y,
      angle: 0,
      duration: 200,
      ease: 'Cubic.easeOut',
    });
  }

  private collectChip(view: ChipView, pIdx: 0 | 1, idx = 0): Promise<void> {
    return new Promise((resolve) => {
      view.setDepth(220);
      const delay = idx * 24;
      const angle = (Math.random() - 0.5) * 0.8;
      this.tweens.add({
        targets: view,
        x: view.x + angle * 30,
        y: view.y - 14,
        duration: 90 + delay,
        ease: 'Quad.easeOut',
        onComplete: () => {
          audio.flip(idx);
          void view.flip(true, 140).then(() => {
            view.pop();
            const target = PLAYER_POS[pIdx];
            this.tweens.add({
              targets: view,
              x: target.x,
              y: target.y,
              scale: 0.34,
              alpha: 0.05,
              rotation: Math.random() * 6.28,
              duration: 340,
              ease: 'Cubic.easeIn',
              onComplete: () => {
                view.destroy();
                resolve();
              },
            });
          });
        },
      });
    });
  }

  private showBonus(chip: ChipInstance): void {
    const def = getChip(chip.defId);
    audio.rare();
    floatText(this, STACK_CX, this.columnTop - 18, `🌟 бонус: ${def.name}`, TEXT_COLORS.magenta, 16);
    burst(this, STACK_CX, this.columnTop - 18, { count: 30, color: COLORS.magenta, speed: 260 });
  }

  private updateHeat(): void {
    const ratio = Math.min(1, this.combo / 6);
    const g = this.heatG;
    g.clear();
    const x = 70;
    const y = 566;
    const w = 340;
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(x, y, w, 10, 5);
    if (this.combo > 0) {
      const col = heatColor(ratio);
      g.fillGradientStyle(lighten(col, 0.3), col, darken(col, 0.2), darken(col, 0.3), 1);
      g.fillRoundedRect(x, y, Math.max(w * ratio, 10), 10, 5);
    }
    this.heatLabel.setText(this.combo > 0 ? `🔥 серия ×${this.combo}` : '🔥 серия');
    this.heatLabel.setColor(this.combo > 0 ? COLORS.gold : COLORS.dim);
  }

  private placeSlammer(index: 0 | 1): void {
    const home = SLAMMER_HOME[index];
    this.slammer.setDepth(48);
    this.slammer.setAlpha(1);
    this.slammer.setPosition(home.x, home.y);
    this.slammer.setAngle(0);
    this.slammer.setScale(1);
  }

  private updateTurnUi(): void {
    this.highlightCard();
    const cur = this.state.current;
    const pl = this.state.players[cur];
    const human = !pl.isAI;

    // Special moves are priced in chips already flipped this match.
    this.moveBar.setAffordable(pl.collected.length);
    this.moveBar.setEnabled(human && !this.leaveOpen);
    this.moveBar.clear();
    this.pendingMove = 'normal';

    if (human) {
      this.charging = false;
      this.chargeT = 0;
      this.chargeDir = 1;
      this.powerMultiplier = PM_MIN;
      this.statusText.setText(`Ход: ${pl.name} · зажмите и держите`);
      this.holdPad.setText('🥊  ЗАЖМИ');
      this.holdPad.setHint(`ходит ${pl.name} · тяните по столбику`);
      this.holdPad.setPadEnabled(true);
      this.holdPad.setProgress(0, false);
      this.placeSlammer(cur);
      if (pl.focusBonus > 0) {
        floatText(
          this,
          GAME_WIDTH / 2,
          520,
          `🎯 ПЕРЕХОД: прицел +${Math.round(MISS.BONUS * 100)}%`,
          TEXT_COLORS.gold,
          20,
        );
      }
      if (pl.brace > 0) {
        floatText(this, GAME_WIDTH / 2, 520, '🛡 ВАС ОСЛАБИЛИ', TEXT_COLORS.magenta, 20);
      }
    } else {
      this.holdPad.setText('🤖  ход соперника');
      this.holdPad.setHint('');
      this.holdPad.setPadEnabled(false);
    }

    this.drawGauge();
    this.updatePowerEstimate();
    this.drawReticle();
  }

  private updateHud(): void {
    this.p0Count.setText(String(this.state.players[0].collected.length));
    this.p1Count.setText(String(this.state.players[1].collected.length));
    this.stackText.setText(`столбик: ${this.state.stack.length} фишек`);
  }

  private updatePowerEstimate(): void {
    if (!this.expectedLabel) return;
    const p = powerOf(this.state, this.state.current).power;
    const exp = expectedFlips(this.state.stack, p, this.powerMultiplier, this.aimT);
    const zone = this.aimT < 0.34 ? 'верх' : this.aimT < 0.67 ? 'центр' : 'низ';
    // Active modifiers from the previous turn («переход» / «отбой»).
    const me = this.state.players[this.state.current];
    let mods = '';
    if (me.focusBonus > 0) mods += ` · 🎯+${Math.round(me.focusBonus * 100)}%`;
    if (me.brace > 0) mods += ` · 🛡−${Math.round(me.brace * 100)}%`;
    this.expectedLabel.setText(
      `≈ ${exp.toFixed(1)} фишек · прицел: ${zone}${mods}`,
    );
  }

  private forfeit(): void {
    if (this.finished) return;
    const win: 0 | 1 = this.state.current === 0 ? 1 : 0;
    this.state.stack = [];
    this.state.status = 'finished';
    this.finish(true, win);
  }

  /* ───────────── finish ───────────── */

  private finish(forced = false, forcedWinner?: 0 | 1): void {
    this.finished = true;
    this.busy = true;
    this.charging = false;
    this.reticleG.clear();
    this.holdPad.setPadEnabled(false);

    const result = settleMatch(session.profile, this.state, 0, forced ? forcedWinner === 0 : undefined);
    recordLeaderboard(session.profile);
    session.save();

    // Publish the collection score (best-wins on the server).
    void net().submitScore(uniqueChips(session.profile), session.profile.stats.gamesWon);

    const w = forced ? forcedWinner ?? winner(this.state) : winner(this.state);
    const won = w === 0;
    const title = w === 0 ? '🏆  ПОБЕДА!' : w === 1 ? '😞  ПОРАЖЕНИЕ' : '🤝  НИЧЬЯ';
    const color = w === 0 ? TEXT_COLORS.green : w === 1 ? TEXT_COLORS.red : TEXT_COLORS.gold;

    // Dim backdrop.
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05030f, 0.72).setDepth(500).setInteractive();

    if (won) {
      rayBurst(this, GAME_WIDTH / 2, 320, COLORS.goldNum, 520, -2).setBlendMode(Phaser.BlendModes.ADD);
      coinRain(this, 44, 900);
      burst(this, GAME_WIDTH / 2, 300, { count: 50, color: COLORS.goldNum, speed: 320, lifespan: 800 });
      flash(this, 220, 255, 230, 150);
      audio.win();
    } else if (w === 1) {
      audio.lose();
    } else {
      audio.turn();
    }

    // Result panel.
    const root = this.add.container(GAME_WIDTH / 2, 400).setDepth(510);
    root.add(
      panel(this, 0, 0, GAME_WIDTH - 56, 520, COLORS.panel, 26, {
        glow: won ? COLORS.goldDeep : COLORS.violetDeep,
        rim: won ? COLORS.goldNum : COLORS.strokeHi,
        rimAlpha: 0.7,
      }),
    );

    const titleText = label(this, 0, -206, title, 34, color);
    titleText.setStroke('#000000', 6);
    root.add(titleText);
    popIn(this, titleText, 60, 0.6);

    // Score row.
    const p0 = this.state.players[0];
    const p1 = this.state.players[1];
    root.add(label(this, 0, -142, `${p0.name}   ${p0.collected.length}  —  ${p1.collected.length}   ${p1.name}`, 16, COLORS.text));

    // Reward.
    const rewardY = -96;
    const rbox = this.add.graphics();
    rbox.fillGradientStyle(lighten(COLORS.goldDeep, 0.2), COLORS.goldDeep, COLORS.goldDark, COLORS.goldDark, 1);
    rbox.fillRoundedRect(-140, rewardY - 30, 280, 60, 14);
    rbox.lineStyle(2, COLORS.goldNum, 0.9);
    rbox.strokeRoundedRect(-140, rewardY - 30, 280, 60, 14);
    root.add(rbox);
    const rewardText = label(this, 0, rewardY, `+0 🪙`, 26, '#1a0f04');
    root.add(rewardText);
    countUp(this, rewardText, 0, result.flipped, 800, (v) => `+${Math.round(v)} 🪙`);
    if (result.flipped > 0) audio.coin();

    root.add(label(this, 0, -46, `баланс: ${session.profile.balance}`, 13, COLORS.dim));

    // Achievements.
    let ay = -10;
    for (const a of result.newAchievements) {
      root.add(label(this, 0, ay, `🏅 ${a.name}  (+${a.reward})`, 14, COLORS.gold));
      ay += 26;
    }
    if (result.newAchievements.length > 0) audio.achievement();

    // Newly completed collection series.
    for (const series of result.newSeries) {
      root.add(label(this, 0, ay, `🗂 Серия «${series.name}»  (+${series.reward})`, 14, COLORS.gold));
      ay += 26;
    }

    root.add(
      new Button(this, 0, 110, '↻  ЕЩЁ РАЗ', () => this.scene.restart({ stake: this.stake, opponentIsAI: this.vsAI }), {
        width: 240,
        height: 58,
        variant: 'gold',
        fontSize: 18,
        glow: true,
      }),
    );
    root.add(
      new Button(this, 0, 180, '🏠  В МЕНЮ', () => this.scene.start(SCENE_KEYS.MENU), {
        width: 240,
        height: 54,
        variant: 'ghost',
        fontSize: 17,
      }),
    );

    popIn(this, root, 0, 0.9);
  }
}
