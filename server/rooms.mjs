/**
 * In-memory room/lobby manager + authoritative match orchestration.
 *
 * A "server" in the product sense == a Room here: a table with a stake, a
 * player cap (2–10), an optional password and a public/private flag. Anyone can
 * see public rooms in the "ИГРЫ ОНЛАЙН" list and join; private/secret rooms are
 * reachable only by invite link.
 *
 * Transport is SSE + POST (see `index.mjs`), so this module is transport
 * agnostic: it emits events through the injected `send(clientId, event)` sink.
 */

import {
  createMatch,
  collectSummary,
  pickAiFocus,
  pickAiMove,
  pickAiPower,
  playTurn,
  ranking,
  winners,
} from './engine.mjs';
import { AI } from './gamedata.mjs';

/** Moves a client is allowed to ask for. */
const MOVE_KINDS = new Set(['normal', 'precise', 'brace', 'double']);

const ROOM_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMPTY_ROOM_TTL_MS = 60_000;
const IDLE_ROOM_TTL_MS = 3 * 60 * 60 * 1000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const MAX_STAKE = 1_000_000;

/** Public room projection sent to the lobby list. */
function publicSummary(room) {
  const host = room.players.get(room.hostId);
  return {
    id: room.id,
    name: room.name,
    hostName: host ? host.name : '—',
    players: room.players.size,
    maxPlayers: room.maxPlayers,
    stake: room.stake,
    locked: !!room.password,
    status: room.status,
  };
}

/** Full room projection (players list, cfg, status) sent to members. */
function stateView(room) {
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    stake: room.stake,
    maxPlayers: room.maxPlayers,
    isPublic: room.isPublic,
    locked: !!room.password,
    status: room.status,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      photo: p.photo,
      bitaId: p.bitaId,
      bitaLevel: p.bitaLevel ?? 1,
      isBot: p.isBot,
      isHost: p.id === room.hostId,
      connected: p.connected,
    })),
  };
}

export class RoomManager {
  /**
   * @param {(clientId: string, event: object) => void} send
   * @param {(event: object) => void} broadcastLobby  notify lobby watchers
   */
  constructor(send, broadcastLobby) {
    this.send = send;
    this.broadcastLobby = broadcastLobby;
    /** @type {Map<string, any>} */
    this.rooms = new Map();
    /** clientId -> roomId */
    this.membership = new Map();
    /** Lobby watchers = clientIds subscribed to the room list. */
    this.watchers = new Set();
    this._timer = setInterval(() => this.sweep(), 15_000);
    if (this._timer.unref) this._timer.unref();
  }

  dispose() {
    clearInterval(this._timer);
  }

  newRoomId() {
    let id;
    do {
      id = Array.from({ length: 5 }, () => ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)]).join('');
    } while (this.rooms.has(id));
    return id;
  }

  /* ───────────────────────── lobby ───────────────────────── */

  listRooms() {
    return [...this.rooms.values()]
      .filter((r) => r.isPublic && r.status !== 'finished' && r.players.size < r.maxPlayers)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(publicSummary);
  }

  watch(clientId) {
    this.watchers.add(clientId);
    this.send(clientId, { t: 'rooms', rooms: this.listRooms() });
  }

  unwatch(clientId) {
    this.watchers.delete(clientId);
  }

  pushLobby() {
    const rooms = this.listRooms();
    for (const id of this.watchers) this.send(id, { t: 'rooms', rooms });
  }

  /* ───────────────────────── commands ───────────────────────── */

  create(clientId, cfg, profile) {
    // A player sits at one table at a time.
    this.leave(clientId);
    const room = {
      id: this.newRoomId(),
      name: sanitizeName(cfg?.name) || `Стол ${profile.name}`.slice(0, 24),
      hostId: profile.id,
      stake: clampInt(cfg?.stake, 1, MAX_STAKE, 100),
      maxPlayers: clampInt(cfg?.maxPlayers, MIN_PLAYERS, MAX_PLAYERS, 4),
      isPublic: cfg?.isPublic !== false,
      password: sanitizePassword(cfg?.password),
      status: 'waiting',
      players: new Map(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      match: null,
      lastActivity: Date.now(),
    };
    this.rooms.set(room.id, room);
    const res = this._addPlayer(room, clientId, profile);
    this.pushLobby();
    return res;
  }

  join(clientId, roomId, password, profile) {
    const room = this.rooms.get(String(roomId || '').toUpperCase());
    if (!room) return { error: 'not_found' };
    if (room.status === 'playing') return { error: 'in_progress' };
    if (room.status === 'finished') return { error: 'finished' };
    if (room.players.size >= room.maxPlayers && !room.players.has(profile.id)) {
      return { error: 'full' };
    }
    if (room.password && sanitizePassword(password) !== room.password) {
      return { error: 'bad_password' };
    }
    // Leave any previous table only once the new join is known to be valid.
    this.leave(clientId);
    const res = this._addPlayer(room, clientId, profile);
    this.pushLobby();
    return res;
  }

  _addPlayer(room, clientId, profile) {
    // Same account reconnecting -> take over the existing seat.
    let player = room.players.get(profile.id);
    if (player) {
      player.clientId = clientId;
      player.connected = true;
      player.name = profile.name || player.name;
      player.bitaId = profile.bitaId ?? player.bitaId;
      player.bitaLevel = profile.bitaLevel ?? player.bitaLevel ?? 1;
    } else {
      player = {
        id: profile.id,
        clientId,
        name: profile.name || 'Игрок',
        photo: profile.photo ?? null,
        bitaId: profile.bitaId ?? null,
        bitaLevel: profile.bitaLevel ?? 1,
        isBot: false,
        connected: true,
        joinedAt: Date.now(),
      };
      room.players.set(player.id, player);
    }
    this.membership.set(clientId, room.id);
    room.updatedAt = Date.now();
    room.lastActivity = Date.now();
    const view = stateView(room);
    this._broadcast(room, { t: 'room:state', room: view });
    this.send(clientId, { t: 'room:joined', room: view, youId: profile.id });
    return { ok: true, room: view, youId: profile.id };
  }

  addBot(clientId, roomId, name) {
    const room = this._hostRoom(clientId, roomId);
    if (room.error) return room;
    if (room.status === 'playing') return { error: 'in_progress' };
    if (room.players.size >= room.maxPlayers) return { error: 'full' };
    const id = `bot_${Math.random().toString(36).slice(2, 8)}`;
    room.players.set(id, {
      id,
      clientId: null,
      name: sanitizeName(name) || `Бот ${room.players.size}`,
      photo: null,
      bitaId: pickBotBita(),
      bitaLevel: 1,
      isBot: true,
      connected: true,
      joinedAt: Date.now(),
    });
    room.updatedAt = Date.now();
    this._broadcast(room, { t: 'room:state', room: stateView(room) });
    this.pushLobby();
    return { ok: true };
  }

  leave(clientId, hard = false) {
    const roomId = this.membership.get(clientId);
    if (!roomId) return { ok: true };
    const room = this.rooms.get(roomId);
    this.membership.delete(clientId);
    if (!room) return { ok: true };
    // find the player that owned this clientId
    const player = [...room.players.values()].find((p) => p.clientId === clientId);
    if (player) {
      if (room.status === 'playing') {
        // Keep the seat but mark disconnected (they can rejoin the same match).
        player.connected = false;
      } else {
        room.players.delete(player.id);
      }
    }
    this._afterDeparture(room, hard);
    return { ok: true };
  }

  kick(clientId, roomId, targetId) {
    const room = this._hostRoom(clientId, roomId);
    if (room.error) return room;
    const target = room.players.get(targetId);
    if (!target) return { error: 'no_target' };
    if (target.id === room.hostId) return { error: 'cannot_kick_host' };
    if (target.clientId) {
      this.send(target.clientId, { t: 'room:kicked', roomId: room.id });
      this.membership.delete(target.clientId);
    }
    room.players.delete(targetId);
    room.updatedAt = Date.now();
    this._broadcast(room, { t: 'room:state', room: stateView(room) });
    this.pushLobby();
    return { ok: true };
  }

  update(clientId, roomId, cfg) {
    const room = this._hostRoom(clientId, roomId);
    if (room.error) return room;
    if (room.status === 'playing') return { error: 'in_progress' };
    if (cfg.stake !== undefined) room.stake = clampInt(cfg.stake, 1, MAX_STAKE, room.stake);
    if (cfg.maxPlayers !== undefined) {
      room.maxPlayers = clampInt(cfg.maxPlayers, MIN_PLAYERS, MAX_PLAYERS, room.maxPlayers);
      while (room.players.size > room.maxPlayers) {
        // drop the newest non-host player
        const victim = [...room.players.values()]
          .filter((p) => p.id !== room.hostId)
          .sort((a, b) => b.joinedAt - a.joinedAt)[0];
        if (!victim) break;
        if (victim.clientId) this.send(victim.clientId, { t: 'room:kicked', roomId: room.id, reason: 'shrunk' });
        room.players.delete(victim.id);
      }
    }
    if (cfg.name !== undefined) room.name = sanitizeName(cfg.name) || room.name;
    if (cfg.isPublic !== undefined) room.isPublic = !!cfg.isPublic;
    if (cfg.password !== undefined) room.password = sanitizePassword(cfg.password);
    room.updatedAt = Date.now();
    this._broadcast(room, { t: 'room:state', room: stateView(room) });
    this.pushLobby();
    return { ok: true };
  }

  start(clientId, roomId) {
    const room = this._hostRoom(clientId, roomId);
    if (room.error) return room;
    if (room.status === 'playing') return { error: 'in_progress' };
    if (room.players.size < MIN_PLAYERS) return { error: 'need_players' };
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const players = [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      photo: p.photo,
      isBot: p.isBot,
      bitaId: p.bitaId,
      bitaLevel: p.bitaLevel ?? 1,
    }));
    // Start on a human turn so a table never opens on a bot's move.
    const humanIdx = players.map((p, i) => (p.isBot ? -1 : i)).filter((i) => i >= 0);
    const firstPlayerIndex = humanIdx.length
      ? humanIdx[Math.floor(Math.random() * humanIdx.length)]
      : 0;
    room.match = createMatch({ stake: room.stake, players, seed, firstPlayerIndex });
    room.status = 'playing';
    room.result = null;
    room.lastActivity = Date.now();
    const payload = serializeMatch(room.match);
    this._broadcast(room, { t: 'match:start', roomId: room.id, match: payload });
    this.pushLobby();
    return { ok: true };
  }

  smash(clientId, roomId, powerMultiplier, focus, move) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'not_found' };
    if (!room.match || room.match.status !== 'active') return { error: 'not_active' };
    const player = [...room.players.values()].find((p) => p.clientId === clientId);
    if (!player) return { error: 'not_member' };
    if (room.match.players[room.match.current].id !== player.id) return { error: 'not_your_turn' };

    const pm = clampNum(powerMultiplier, 0.5, 1.85, 1.0);
    const fc = focus === undefined || focus === null ? undefined : clampNum(focus, 0, 1, 0.5);
    const mv = MOVE_KINDS.has(move) ? move : 'normal';
    const reports = playTurn(room.match, { powerMultiplier: pm, focus: fc, move: mv }).reports;
    // Auto-play any following bot turns so humans never wait on bots.
    let guard = 0;
    while (room.match.status === 'active' && room.match.players[room.match.current].isBot && guard++ < MAX_PLAYERS) {
      const botIndex = room.match.current;
      const botPm = pickAiPower(room.match.rng, AI.SKILL);
      const botFocus = pickAiFocus(room.match, botIndex, room.match.rng, AI.SKILL, botPm);
      const botMove = pickAiMove(room.match, botIndex, room.match.rng);
      reports.push(
        ...playTurn(room.match, { powerMultiplier: botPm, focus: botFocus, move: botMove }).reports,
      );
    }
    room.lastActivity = Date.now();
    this._broadcast(room, {
      t: 'match:smash',
      roomId: room.id,
      reports,
      state: serializeMatch(room.match),
    });
    this._maybeFinish(room);
    return { ok: true };
  }

  _maybeFinish(room) {
    if (room.match && room.match.status === 'finished') {
      room.status = 'finished';
      const rank = ranking(room.match);
      const win = winners(room.match);
      room.result = {
        summary: collectSummary(room.match),
        ranking: rank,
        winners: win,
        stake: room.stake,
        turns: room.match.turn,
      };
      this._broadcast(room, { t: 'match:end', roomId: room.id, result: room.result });
    }
  }

  /** Return to the lobby from a finished match (host-driven or automatic). */
  reset(clientId, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'not_found' };
    if (room.hostId !== profileIdFor(room, clientId)) return { error: 'not_host' };
    room.status = 'waiting';
    room.match = null;
    room.result = null;
    // drop bots so a fresh table starts clean
    for (const [id, p] of room.players) if (p.isBot) room.players.delete(id);
    this._broadcast(room, { t: 'room:state', room: stateView(room) });
    this.pushLobby();
    return { ok: true };
  }

  /* ───────────────────────── helpers ───────────────────────── */

  _hostRoom(clientId, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'not_found' };
    if (room.hostId !== profileIdFor(room, clientId)) return { error: 'not_host' };
    return room;
  }

  _broadcast(room, event) {
    for (const p of room.players.values()) {
      if (p.clientId) this.send(p.clientId, event);
    }
  }

  /** Re-send the current room (and match) state to one client. */
  sync(clientId) {
    const roomId = this.membership.get(clientId);
    const room = roomId ? this.rooms.get(roomId) : null;
    if (!room) return { error: 'not_found' };
    const player = [...room.players.values()].find((p) => p.clientId === clientId);
    if (player) player.connected = true;
    this.send(clientId, { t: 'room:state', room: stateView(room) });
    if (room.match) {
      this.send(clientId, {
        t: 'match:sync',
        roomId: room.id,
        match: serializeMatch(room.match),
        result: room.result,
      });
    }
    return { ok: true };
  }

  _afterDeparture(room, hard) {
    if (room.players.size === 0) {
      this.rooms.delete(room.id);
      this.pushLobby();
      return;
    }
    if (!room.players.has(room.hostId) || hard === 'hostLeft') {
      // migrate host to the oldest remaining human
      const next = [...room.players.values()]
        .filter((p) => !p.isBot)
        .sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) room.hostId = next.id;
    }
    this._broadcast(room, { t: 'room:state', room: stateView(room) });
    this.pushLobby();
  }

  sweep() {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      const humans = [...room.players.values()].filter((p) => !p.isBot && p.connected);
      const age = now - room.createdAt;
      if (room.players.size === 0 && age > EMPTY_ROOM_TTL_MS) {
        this.rooms.delete(id);
      } else if (humans.length === 0 && now - room.lastActivity > IDLE_ROOM_TTL_MS) {
        this.rooms.delete(id);
      }
    }
    this.pushLobby();
  }
}

/* ───────────────────────── projections ───────────────────────── */

/** Trim the heavy internals (rng) before sending to clients. */
export function serializeMatch(match, compact = false) {
  const base = {
    status: match.status,
    current: match.current,
    stake: match.stake,
    turn: match.turn,
    players: match.players.map((p) => ({
      id: p.id,
      name: p.name,
      photo: p.photo,
      isBot: p.isBot,
      bitaId: p.bitaId ?? null,
      bitaLevel: p.bitaLevel ?? 1,
      connected: p.connected,
      count: p.collected.length,
      focusBonus: p.focusBonus || 0,
      brace: p.brace || 0,
      collected: compact ? undefined : p.collected,
    })),
    stackCount: match.stack.length,
    stack: compact ? undefined : match.stack,
  };
  return base;
}

/* ───────────────────────── utils ───────────────────────── */

function profileIdFor(room, clientId) {
  const p = [...room.players.values()].find((x) => x.clientId === clientId);
  return p ? p.id : null;
}

function sanitizeName(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
}

function sanitizePassword(v) {
  if (typeof v !== 'string' || v.length === 0) return null;
  return v.replace(/[\u0000-\u001f]/g, '').slice(0, 32);
}

function clampInt(v, min, max, dflt) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

function clampNum(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

function pickBotBita() {
  const ids = ['bit_plastic', 'bit_star', 'bit_rocket', 'bit_diamond', 'bit_crown', 'bit_fire'];
  return ids[Math.floor(Math.random() * ids.length)];
}
