/**
 * CHIPS sound engine — every SFX is **synthesised at runtime with WebAudio**,
 * so the game ships zero audio assets (important for a Telegram Mini App where
 * bundle weight is latency).
 *
 * Contract:
 *  - Nothing is created until `unlock()` runs inside a user gesture (autoplay
 *    policy). `main.ts` wires that to the first pointer/key event.
 *  - A muted game schedules nothing at all — no gain nodes, no CPU.
 *  - Safe to import in Node/tests: every browser API is guarded.
 *
 * The palette is deliberately "дворовая аркада": woody clack of the bita,
 * plastic tick of flipping caps, coin blips and two short stingers.
 */

import { getSettings } from '../systems/Settings';

type Ctor = new () => AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let unlocked = false;

/* ───────────────────────── core plumbing ───────────────────────── */

function ctor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Lazily create the context. Returns null when WebAudio is unavailable. */
function ac(): AudioContext | null {
  if (ctx) return ctx;
  const C = ctor();
  if (!C) return null;
  try {
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
    return null;
  }
  return ctx;
}

/** True when sound may be scheduled right now. */
function enabled(): boolean {
  if (getSettings().muted) return false;
  if (!unlocked) return false;
  return ac() !== null && master !== null;
}

/**
 * Call from a real user gesture. Creates/resumes the context and remembers that
 * the player has interacted (so later programmatic sounds are allowed).
 */
export function unlockAudio(): void {
  const c = ac();
  if (!c) return;
  unlocked = true;
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

/** Suspend/resume playback — used when the tab/app goes to the background. */
export function setAudioActive(active: boolean): void {
  if (!ctx) return;
  try {
    if (!active && ctx.state === 'running') void ctx.suspend();
    else if (active && ctor() && ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* ignore */
  }
}

/* ───────────────────────── primitives ───────────────────────── */

interface ToneOpts {
  freq: number;
  /** Glide target; omitted for a steady pitch. */
  to?: number;
  type?: OscillatorType;
  dur: number;
  gain?: number;
  delay?: number;
}

function tone(o: ToneOpts): void {
  const c = ctx;
  if (!c || !master) return;
  const t0 = c.currentTime + (o.delay ?? 0);
  const osc = c.createOscillator();
  osc.type = o.type ?? 'square';
  osc.frequency.setValueAtTime(Math.max(1, o.freq), t0);
  if (o.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + o.dur);
  }
  const g = c.createGain();
  const peak = o.gain ?? 0.25;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.03);
}

interface NoiseOpts {
  dur: number;
  gain?: number;
  delay?: number;
  /** Low-pass cutoff at impact, sweeping to `sweepTo` over `dur`. */
  cutoff?: number;
  sweepTo?: number;
  q?: number;
}

function noise(o: NoiseOpts): void {
  const c = ctx;
  if (!c || !master) return;
  if (!noiseBuffer) {
    const len = Math.floor(c.sampleRate * 0.5);
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime + (o.delay ?? 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;

  const flt = c.createBiquadFilter();
  flt.type = 'lowpass';
  flt.Q.value = o.q ?? 0.8;
  flt.frequency.setValueAtTime(o.cutoff ?? 3200, t0);
  if (o.sweepTo !== undefined) {
    flt.frequency.exponentialRampToValueAtTime(Math.max(60, o.sweepTo), t0 + o.dur);
  }

  const g = c.createGain();
  const peak = o.gain ?? 0.3;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

  src.connect(flt);
  flt.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + o.dur + 0.02);
}

/* ───────────────────────── charge (continuous) ───────────────────────── */

let chargeOsc: OscillatorNode | null = null;
let chargeGain: GainNode | null = null;

/** Start the rising "натяжение удара" tone. Idempotent. */
export function startCharge(): void {
  if (getSettings().muted) return;
  const c = ac();
  if (!c || !master || !unlocked) return;
  stopCharge();
  const t0 = c.currentTime;
  chargeOsc = c.createOscillator();
  chargeOsc.type = 'sawtooth';
  chargeOsc.frequency.setValueAtTime(90, t0);
  chargeGain = c.createGain();
  chargeGain.gain.setValueAtTime(0.0001, t0);
  chargeGain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.08);
  const flt = c.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.value = 900;
  chargeOsc.connect(flt);
  flt.connect(chargeGain);
  chargeGain.connect(master);
  chargeOsc.start();
  lastChargeT = -1;
  lastChargeAt = 0;
}

/** Track the charge (0..1) with a rising pitch + tremolo. */
let lastChargeT = -1;
let lastChargeAt = 0;
function setChargePower(t: number): void {
  if (!ctx || !chargeOsc || !chargeGain) return;
  const p = Math.max(0, Math.min(1, t));
  const now = ctx.currentTime;
  // Called every animation frame — throttle so the AudioParam timeline does
  // not accumulate thousands of automation events over a long match.
  if (Math.abs(p - lastChargeT) < 0.006 && now - lastChargeAt < 0.12) return;
  lastChargeT = p;
  lastChargeAt = now;
  chargeOsc.frequency.setTargetAtTime(96 + p * 300, now, 0.02);
  chargeGain.gain.setTargetAtTime(0.035 + p * 0.05, now, 0.02);
}

/** Stop the charge loop (with a short release tail). */
function stopCharge(): void {
  if (!ctx || !chargeOsc || !chargeGain) {
    chargeOsc = null;
    chargeGain = null;
    return;
  }
  const now = ctx.currentTime;
  try {
    chargeGain.gain.cancelScheduledValues(now);
    chargeGain.gain.setTargetAtTime(0.0001, now, 0.02);
    chargeOsc.stop(now + 0.12);
  } catch {
    /* already stopped */
  }
  chargeOsc = null;
  chargeGain = null;
}

/* ───────────────────────── public SFX palette ───────────────────────── */

export const audio = {
  /** First user gesture — must run before any sound is audible. */
  unlock(): void {
    unlocked = true;
    const c = ac();
    if (c && c.state === 'suspended') void c.resume();
  },

  /** Soft UI tap (buttons, toggles). */
  click(): void {
    if (!enabled()) return;
    tone({ freq: 620, to: 880, type: 'triangle', dur: 0.05, gain: 0.12 });
  },

  /** Panel / modal open. */
  open(): void {
    if (!enabled()) return;
    tone({ freq: 320, to: 720, type: 'sine', dur: 0.16, gain: 0.16 });
  },

  /** Panel / modal close. */
  close(): void {
    if (!enabled()) return;
    tone({ freq: 620, to: 280, type: 'sine', dur: 0.14, gain: 0.14 });
  },

  /** Start the charge-up loop. */
  chargeStart(): void {
    if (!enabled()) return;
    startCharge();
  },

  /** Live charge power (0..1) → rising pitch. */
  chargeSet(t: number): void {
    if (!enabled()) return;
    setChargePower(t);
  },

  /** Release the charge loop. */
  chargeStop(): void {
    stopCharge();
  },

  /**
   * The бита landing on the stack. `power01` (0..1) scales the punch:
   * a low-power tap is a dry click, a full swing is a woody crack + thump.
   */
  smash(power01: number): void {
    if (!enabled()) return;
    const p = Math.max(0, Math.min(1, power01));
    noise({ dur: 0.09 + p * 0.06, gain: 0.22 + p * 0.22, cutoff: 5200, sweepTo: 700, q: 1.1 });
    tone({ freq: 190 - p * 40, to: 62, type: 'sine', dur: 0.16 + p * 0.08, gain: 0.3 });
    if (p > 0.66) tone({ freq: 1400, to: 300, type: 'square', dur: 0.07, gain: 0.1 });
  },

  /** One cap flipping over — pitch climbs with the index for a "cascade". */
  flip(index: number): void {
    if (!enabled()) return;
    const i = Math.max(0, Math.min(9, index));
    tone({ freq: 900 + i * 110, to: 1500 + i * 120, type: 'triangle', dur: 0.045, gain: 0.11 });
    tone({ freq: 2100 + i * 90, type: 'sine', dur: 0.02, gain: 0.05, delay: 0.004 });
  },

  /** Big hit: bright arpeggio + shimmer. */
  crit(): void {
    if (!enabled()) return;
    const notes = [784, 988, 1319, 1568];
    notes.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.22, gain: 0.16, delay: i * 0.05 }));
    noise({ dur: 0.3, gain: 0.1, cutoff: 9000, sweepTo: 2000, delay: 0.02 });
  },

  /** Whiffed smash — no cap moved. */
  miss(): void {
    if (!enabled()) return;
    noise({ dur: 0.14, gain: 0.14, cutoff: 900, sweepTo: 200, q: 2 });
    tone({ freq: 240, to: 120, type: 'sawtooth', dur: 0.22, gain: 0.14 });
  },

  /** Chips / stars / daily reward. */
  coin(): void {
    if (!enabled()) return;
    tone({ freq: 988, type: 'square', dur: 0.06, gain: 0.13 });
    tone({ freq: 1319, type: 'square', dur: 0.1, gain: 0.12, delay: 0.055 });
  },

  /** Rare chip discovered. */
  rare(): void {
    if (!enabled()) return;
    [659, 880, 1175, 1568].forEach((f, i) =>
      tone({ freq: f, type: 'sine', dur: 0.34, gain: 0.15, delay: i * 0.07 }),
    );
  },

  /** Purchase / equip in the market. */
  buy(): void {
    if (!enabled()) return;
    tone({ freq: 520, to: 1040, type: 'sawtooth', dur: 0.12, gain: 0.14 });
    tone({ freq: 1560, type: 'sine', dur: 0.18, gain: 0.1, delay: 0.09 });
  },

  /** Achievement unlocked. */
  achievement(): void {
    if (!enabled()) return;
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 0.28, gain: 0.15, delay: i * 0.09 }),
    );
  },

  /** Match won. */
  win(): void {
    if (!enabled()) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 0.32, gain: 0.17, delay: i * 0.1 }),
    );
    noise({ dur: 0.6, gain: 0.07, cutoff: 8000, sweepTo: 1500 });
  },

  /** Match lost / forfeited. */
  lose(): void {
    if (!enabled()) return;
    [494, 415, 349, 262].forEach((f, i) =>
      tone({ freq: f, type: 'sine', dur: 0.34, gain: 0.15, delay: i * 0.12 }),
    );
  },

  /** Turn passed to the opponent (subtle ping). */
  turn(): void {
    if (!enabled()) return;
    tone({ freq: 720, to: 900, type: 'sine', dur: 0.1, gain: 0.1 });
  },

  /** Out-of-affordability / invalid action buzz. */
  error(): void {
    if (!enabled()) return;
    tone({ freq: 180, to: 110, type: 'square', dur: 0.16, gain: 0.14 });
  },
};

/** True once the audio context is live and unmuted (for UI labels). */
export function audioReady(): boolean {
  return unlocked && !!ctx;
}

/** Debug snapshot (browser console / smoke tests). */
export function audioDebug(): { unlocked: boolean; state: string | null; muted: boolean } {
  return {
    unlocked,
    state: ctx ? ctx.state : null,
    muted: getSettings().muted,
  };
}

/** Silence + tear down the charge loop (scene shutdown). */
export function silenceAll(): void {
  stopCharge();
}
