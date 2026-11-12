import type { ChipInstance, MoveKind, GlobalLeaderboardEntry } from '../Types';

export type { GlobalLeaderboardEntry };

/**
 * Wire protocol between the CHIPS client and `server/index.mjs`.
 *
 * Transport: Server-Sent Events for server→client, `POST /api/cmd` for
 * client→server. Every event/command name is a plain string so it stays easy to
 * trace in devtools; the types below are the contract.
 */

/* ───────────────────────── server → client events ───────────────────────── */

export interface EvReady {
  t: 'ready';
  clientId: string;
  accountId: string;
  devMode: boolean;
}

export interface EvRooms {
  t: 'rooms';
  rooms: RoomSummary[];
}

export interface EvRoomJoined {
  t: 'room:joined';
  room: RoomState;
  youId: string;
}

export interface EvRoomState {
  t: 'room:state';
  room: RoomState;
}

export interface EvRoomKicked {
  t: 'room:kicked';
  roomId: string;
  reason?: string;
}

export interface EvMatchStart {
  t: 'match:start';
  roomId: string;
  match: OnlineMatchView;
}

export interface EvMatchSmash {
  t: 'match:smash';
  roomId: string;
  reports: SmashReport[];
  state: OnlineMatchView;
}

export interface EvMatchEnd {
  t: 'match:end';
  roomId: string;
  result: MatchResult;
}

export interface EvMatchSync {
  t: 'match:sync';
  roomId: string;
  match: OnlineMatchView;
  result: MatchResult | null;
}

export interface EvWalletGrant {
  t: 'wallet:grant';
  amount: number;
  reason: string;
  orderId?: string;
}

export interface EvHelloAck {
  t: 'hello:ack';
  profile: { id: string; name: string; photo: string | null; bitaId: string | null };
}

export interface EvError {
  t: 'error';
  message?: string;
  code?: string;
}

export type ServerEvent =
  | EvReady
  | EvRooms
  | EvRoomJoined
  | EvRoomState
  | EvRoomKicked
  | EvMatchStart
  | EvMatchSmash
  | EvMatchEnd
  | EvMatchSync
  | EvWalletGrant
  | EvHelloAck
  | EvError;

/* ───────────────────────── domain shapes ───────────────────────── */

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface RoomSummary {
  id: string;
  name: string;
  hostName: string;
  players: number;
  maxPlayers: number;
  stake: number;
  locked: boolean;
  status: RoomStatus;
}

export interface RoomPlayer {
  id: string;
  name: string;
  photo: string | null;
  bitaId: string | null;
  bitaLevel: number;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
}

export interface RoomState {
  id: string;
  name: string;
  hostId: string;
  stake: number;
  maxPlayers: number;
  isPublic: boolean;
  locked: boolean;
  status: RoomStatus;
  players: RoomPlayer[];
}

export interface OnlineMatchPlayer {
  id: string;
  name: string;
  photo: string | null;
  isBot: boolean;
  bitaId: string | null;
  bitaLevel: number;
  connected: boolean;
  count: number;
  /** «Переход» bonus waiting on this player's next smash. */
  focusBonus?: number;
  /** «Отбой» penalty waiting on this player's next smash (0…1). */
  brace?: number;
  collected?: ChipInstance[];
}

export interface OnlineMatchView {
  status: 'active' | 'finished';
  current: number;
  stake: number;
  turn: number;
  players: OnlineMatchPlayer[];
  stackCount: number;
  stack?: ChipInstance[];
}

export interface SmashReport {
  playerIndex: number;
  flipped: ChipInstance[];
  flippedIndices: number[];
  bonus: ChipInstance | null;
  remaining: number;
  outcome: 'flipped' | 'none';
  /** Special move that produced this pass («двойной удар» yields two). */
  move?: MoveKind;
  /** This pass was weakened by the opponent's «отбой». */
  weakened?: boolean;
  /** «Точный удар» had to force the flip. */
  precise?: boolean;
}

export interface MatchResult {
  summary: Array<{
    id: string;
    name: string;
    won: number;
    anted: number;
    byRarity: Record<string, number>;
  }>;
  ranking: Array<{ i: number; won: number }>;
  winners: number[];
  stake: number;
  turns: number;
}

export interface ChipPack {
  id: string;
  title: string;
  chips: number;
  stars: number;
  emoji: string;
  bonus?: number;
}

export interface ServerConfig {
  devMode: boolean;
  botUsername: string;
  webappUrl: string;
  packages: ChipPack[];
  limits: { minPlayers: number; maxPlayers: number; maxStake: number };
}

/** The server's global leaderboard, as returned by `GET /api/leaderboard`. */
export interface LeaderboardResponse {
  entries: GlobalLeaderboardEntry[];
  /** True when the table is served from a live server. */
  online: boolean;
}

/* ───────────────────────── create-room payload ───────────────────────── */

export interface CreateRoomCfg {
  name: string;
  stake: number;
  maxPlayers: number;
  isPublic: boolean;
  password?: string | null;
}

export interface UpdateRoomCfg {
  name?: string;
  stake?: number;
  maxPlayers?: number;
  isPublic?: boolean;
  password?: string | null;
}

/* ───────────────────────── error codes ───────────────────────── */

/** Human-readable (ru) messages for server error codes. */
export function errorText(code: string | undefined): string {
  switch (code) {
    case 'not_found':
      return 'Стол не найден';
    case 'in_progress':
      return 'Игра уже идёт';
    case 'finished':
      return 'Игра завершена';
    case 'full':
      return 'Стол заполнен';
    case 'bad_password':
      return 'Неверный пароль';
    case 'need_players':
      return 'Нужно минимум 2 игрока';
    case 'not_host':
      return 'Только хозяин стола';
    case 'no_stream':
      return 'Нет связи с сервером';
    case 'no_target':
      return 'Игрок не найден';
    case 'cannot_kick_host':
      return 'Нельзя выгнать хозяина';
    case 'not_member':
      return 'Вы не за столом';
    case 'not_active':
      return 'Матч не активен';
    case 'not_your_turn':
      return 'Сейчас не ваш ход';
    case 'unknown_package':
      return 'Товар не найден';
    default:
      return 'Ошибка сервера';
  }
}
