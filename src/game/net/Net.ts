import type {
  ChipPack,
  CreateRoomCfg,
  LeaderboardResponse,
  ServerConfig,
  ServerEvent,
  UpdateRoomCfg,
} from './Protocol';
import type { MoveKind } from '../Types';
import { clientId as getClientId, initData as tgInitData } from './Telegram';

/**
 * Client for the CHIPS online service.
 *
 * Server → client pushes arrive over an `EventSource` (`/api/stream`);
 * client → server actions are plain `POST /api/cmd`. The class also exposes the
 * shop endpoints (Telegram Stars invoices) and a tiny typed event bus.
 *
 * Everything is best-effort: with no server running the game stays playable
 * offline — `connect()` reports the failure and the UI shows an offline state.
 */

/** Base URL of the API. Empty string = same origin (proxied in dev / served in prod). */
const API_BASE = '';

export type NetStatus = 'idle' | 'connecting' | 'online' | 'offline';

type EventName = ServerEvent['t'];

export interface NetProfile {
  name: string;
  photo?: string | null;
  bitaId?: string | null;
  bitaLevel?: number;
}

export class Net {
  private es: EventSource | null = null;
  private listeners = new Map<string, Set<(ev: ServerEvent) => void>>();
  private statusListeners = new Set<(s: NetStatus) => void>();
  private reconnectTimer: number | null = null;
  private backoff = 1000;
  private profile: NetProfile = { name: 'Игрок' };
  private configCache: ServerConfig | null = null;

  readonly clientId: string;
  status: NetStatus = 'idle';
  accountId: string | null = null;
  serverConfig: ServerConfig | null = null;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  /* ───────────────────────── status ───────────────────────── */

  onStatus(fn: (s: NetStatus) => void): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    // Copy first: a listener may unsubscribe itself while running, and one
    // stale listener throwing must not stop the others (or the caller).
    for (const fn of [...this.statusListeners]) {
      try {
        fn(s);
      } catch (err) {
        console.error('[net] status listener failed', err);
      }
    }
  }

  /* ───────────────────────── typed event bus ───────────────────────── */

  on<T extends EventName>(t: T, fn: (ev: Extract<ServerEvent, { t: T }>) => void): () => void {
    let set = this.listeners.get(t);
    if (!set) {
      set = new Set();
      this.listeners.set(t, set);
    }
    const wrapped = fn as (ev: ServerEvent) => void;
    set.add(wrapped);
    return () => set!.delete(wrapped);
  }

  private emit(ev: ServerEvent): void {
    const set = this.listeners.get(ev.t);
    if (set) for (const fn of [...set]) this.safeCall(fn, ev);
    const all = this.listeners.get('*');
    if (all) for (const fn of [...all]) this.safeCall(fn, ev);
  }

  /** A scene that shut down mid-flight must not break dispatch for others. */
  private safeCall(fn: (ev: ServerEvent) => void, ev: ServerEvent): void {
    try {
      fn(ev);
    } catch (err) {
      console.error(`[net] handler for '${ev.t}' failed`, err);
    }
  }

  /* ───────────────────────── connection ───────────────────────── */

  /** Fetch the server config (shop catalog, bot username, dev flag). */
  async fetchConfig(): Promise<ServerConfig | null> {
    try {
      const res = await fetch(`${API_BASE}/api/config`);
      if (!res.ok) throw new Error(String(res.status));
      this.serverConfig = (await res.json()) as ServerConfig;
      this.configCache = this.serverConfig;
      return this.serverConfig;
    } catch {
      return this.configCache;
    }
  }

  /** Fetch the global leaderboard. Returns null when the server is unreachable. */
  async fetchLeaderboard(): Promise<LeaderboardResponse | null> {
    try {
      const res = await fetch(`${API_BASE}/api/leaderboard`);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as LeaderboardResponse;
    } catch {
      return null;
    }
  }

  connect(profile: NetProfile): void {
    this.profile = profile;
    this.setStatus('connecting');
    this.openStream();
    void this.fetchConfig();
  }

  private openStream(): void {
    this.closeStream();
    const params = new URLSearchParams({
      clientId: this.clientId,
      name: this.profile.name || 'Игрок',
      bitaId: this.profile.bitaId || '',
      bitaLevel: String(Math.max(1, Math.min(5, Math.floor(this.profile.bitaLevel ?? 1) || 1))),
    });
    if (this.profile.photo) params.set('photo', this.profile.photo);
    const initData = tgInitData();
    if (initData) params.set('initData', initData);

    let es: EventSource;
    try {
      es = new EventSource(`${API_BASE}/api/stream?${params.toString()}`);
    } catch {
      this.setStatus('offline');
      return;
    }
    this.es = es;

    es.onopen = () => {
      this.backoff = 1000;
      this.setStatus('online');
    };
    es.onerror = () => {
      // EventSource auto-reconnects; if it is closed for good, retry ourselves.
      if (es.readyState === EventSource.CLOSED) {
        this.setStatus('offline');
        this.scheduleReconnect();
      }
    };
    es.onmessage = (msg) => {
      let ev: ServerEvent;
      try {
        ev = JSON.parse(msg.data) as ServerEvent;
      } catch {
        return;
      }
      if (ev.t === 'ready') {
        this.accountId = ev.accountId;
        this.setStatus('online');
      }
      this.emit(ev);
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.backoff = Math.min(this.backoff * 1.7, 15000);
      this.openStream();
    }, this.backoff);
  }

  private closeStream(): void {
    if (this.es) {
      this.es.onopen = null;
      this.es.onerror = null;
      this.es.onmessage = null;
      this.es.close();
      this.es = null;
    }
  }

  disconnect(): void {
    this.closeStream();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setStatus('idle');
  }

  /* ───────────────────────── commands ───────────────────────── */

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return { error: 'no_stream' };
    }
  }

  /** Send a command. Resolves with `{ ok }` or `{ error: code }`. */
  send(type: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.post('/api/cmd', { clientId: this.clientId, initData: tgInitData(), type, payload });
  }

  /* ───────────────────────── convenience commands ───────────────────────── */

  watchRooms(): Promise<Record<string, unknown>> {
    return this.send('rooms:watch');
  }
  unwatchRooms(): Promise<Record<string, unknown>> {
    return this.send('rooms:unwatch');
  }
  createRoom(cfg: CreateRoomCfg): Promise<Record<string, unknown>> {
    return this.send('room:create', { cfg });
  }
  joinRoom(roomId: string, password?: string): Promise<Record<string, unknown>> {
    return this.send('room:join', { roomId, password: password ?? null });
  }
  leaveRoom(): Promise<Record<string, unknown>> {
    return this.send('room:leave');
  }
  kick(roomId: string, targetId: string): Promise<Record<string, unknown>> {
    return this.send('room:kick', { roomId, targetId });
  }
  updateRoom(roomId: string, cfg: UpdateRoomCfg): Promise<Record<string, unknown>> {
    return this.send('room:update', { roomId, cfg });
  }
  addBot(roomId: string, name?: string): Promise<Record<string, unknown>> {
    return this.send('room:addBot', { roomId, name });
  }
  startMatch(roomId: string): Promise<Record<string, unknown>> {
    return this.send('room:start', { roomId });
  }
  resetRoom(roomId: string): Promise<Record<string, unknown>> {
    return this.send('room:reset', { roomId });
  }
  syncRoom(): Promise<Record<string, unknown>> {
    return this.send('room:sync');
  }
  smash(
    roomId: string,
    powerMultiplier: number,
    focus?: number,
    move?: MoveKind,
  ): Promise<Record<string, unknown>> {
    return this.send('match:smash', { roomId, powerMultiplier, focus, move });
  }

  /** Publish the local collection score to the global leaderboard. */
  submitScore(chips: number, wins: number): Promise<Record<string, unknown>> {
    return this.send('leaderboard:submit', { chips, wins });
  }

  /* ───────────────────────── shop ───────────────────────── */

  /** Create a Stars invoice for a chip pack. Returns `{ orderId, link, chips, devMode }`. */
  async buyPack(pack: ChipPack | { id: string }, opts: { stars?: number; chips?: number } = {}): Promise<{
    ok?: boolean;
    orderId?: string;
    link?: string | null;
    chips?: number;
    stars?: number;
    devMode?: boolean;
    error?: string;
  }> {
    return (await this.post('/api/shop/invoice', {
      clientId: this.clientId,
      initData: tgInitData(),
      packageId: pack.id,
      name: this.profile.name,
      ...opts,
    })) as never;
  }

  /** Dev-mode fallback: credit an order without a real payment. */
  async devGrant(orderId: string): Promise<{ ok?: boolean; chips?: number; error?: string }> {
    return (await this.post('/api/dev/grant', { clientId: this.clientId, orderId })) as never;
  }

  /** Poll an order (used when `openInvoice` cannot report the result). */
  async orderStatus(orderId: string): Promise<{ status?: string; chips?: number; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/api/shop/order/${encodeURIComponent(orderId)}`);
      return (await res.json()) as never;
    } catch {
      return { error: 'network' };
    }
  }
}

/** Shared singleton — created in `main.ts` and imported by scenes. */
let singleton: Net | null = null;
export function net(): Net {
  if (!singleton) singleton = new Net(getClientId());
  return singleton;
}
