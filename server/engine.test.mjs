/**
 * Server-side tests (`node --test`). No Vitest here on purpose: the server is
 * plain ESM so it stays dependency-free and deploys with a bare `node` runtime.
 *
 * Run: npm run test:server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Rng,
  createMatch,
  smash,
  playTurn,
  pickAiFocus,
  pickAiMove,
  pickAiPower,
  flipChance,
  aimBonus,
  powerOf,
  ranking,
  winners,
  MAX_TURNS,
} from './engine.mjs';
import { RoomManager } from './rooms.mjs';
import { SMASH, AIM, MISS, MOVES } from './gamedata.mjs';

/* ───────────────────────── rng ───────────────────────── */

test('Rng is deterministic for a given seed', () => {
  const a = new Rng(1234);
  const b = new Rng(1234);
  for (let i = 0; i < 50; i++) {
    const x = a.next();
    assert.equal(x, b.next());
    assert.ok(x >= 0 && x < 1);
  }
});

/* ───────────────────────── flip chance ───────────────────────── */

test('flipChance matches the documented formula', () => {
  // (BASE_FLIP + power*POWER_TO_FLIP - weight*WEIGHT_PENALTY) * shock * (0.9+0.2*pm)
  const p1 = flipChance(1.0, 1.0, 0, 1.0);
  assert.ok(Math.abs(p1 - 0.2277) < 1e-9, `expected ~0.2277, got ${p1}`);

  const p2 = flipChance(1.0, 1.4, 0, 1.0);
  assert.ok(Math.abs(p2 - 0.21978) < 1e-9, `expected ~0.21978, got ${p2}`);

  const p3 = flipChance(1.0, 1.0, 10, 1.0); // shock = 1 - 10*0.024 = 0.76
  assert.ok(Math.abs(p3 - 0.173052) < 1e-9, `expected ~0.173052, got ${p3}`);

  const p4 = flipChance(1.0, 1.0, 0, 1.85);
  assert.ok(Math.abs(p4 - 0.3330575) < 1e-7, `expected ~0.3330575, got ${p4}`);

  // clamped into [MIN_FLIP, MAX_FLIP]
  const lo = flipChance(0, 50, 1000, 0.5);
  assert.equal(lo, SMASH.MIN_FLIP);
});

test('aiming raises the flip chance at the aimed depth', () => {
  const flat = flipChance(1.0, 1.0, 2, 1.0);
  const aimed = flipChance(1.0, 1.0, 2, 1.0, { focus: 0.5, span: 5 });
  assert.ok(aimed > flat, `expected ${aimed} > ${flat}`);

  // Peak bonus lands exactly on the aimed depth.
  assert.equal(aimBonus(2, 5, 0.5), AIM.BONUS);
  assert.ok(aimBonus(0, 5, 0.5) < AIM.BONUS);
  // Outside the spread there is no bonus at all.
  assert.equal(aimBonus(0, 5, 0.99), 0);
  assert.equal(aimBonus(4, 5, 0.01), 0);
});

/* ───────────────────────── match ───────────────────────── */

test('a 3-player match consumes the pot and finishes', () => {
  const state = createMatch({
    stake: 20,
    seed: 42,
    players: [
      { id: 'a', name: 'A', bitaId: null },
      { id: 'b', name: 'B', bitaId: 'bit_star' },
      { id: 'c', name: 'C', bitaId: 'bit_crown' },
    ],
  });
  assert.equal(state.stack.length, 60);
  assert.equal(state.players.length, 3);

  let guard = 0;
  while (state.status === 'active' && guard++ < MAX_TURNS + 10) {
    smash(state, { powerMultiplier: 1.0 });
  }
  assert.equal(state.status, 'finished');
  assert.equal(state.stack.length, 0);

  const total = state.players.reduce((s, p) => s + p.collected.length, 0);
  assert.equal(total, 60, 'every anted chip must end up collected');

  // turn counter advanced by exactly the number of smashes
  assert.equal(state.turn, state.log.length);
});

test('turn order rotates around the ring', () => {
  const state = createMatch({
    stake: 5,
    seed: 7,
    firstPlayerIndex: 0,
    players: [
      { id: 'a', name: 'A', bitaId: null },
      { id: 'b', name: 'B', bitaId: null },
      { id: 'c', name: 'C', bitaId: null },
    ],
  });
  const order = [];
  for (let i = 0; i < 3; i++) {
    order.push(state.current);
    smash(state, { powerMultiplier: 1 });
  }
  assert.deepEqual(order, [0, 1, 2]);
});

test('matches are deterministic for the same seed', () => {
  const mk = () =>
    createMatch({
      stake: 10,
      seed: 999,
      firstPlayerIndex: 0,
      players: [
        { id: 'a', name: 'A', bitaId: 'bit_fire' },
        { id: 'b', name: 'B', bitaId: null },
      ],
    });
  const s1 = mk();
  const s2 = mk();
  const shape = (s) => {
    const out = [];
    while (s.status === 'active') {
      const r = smash(s, { powerMultiplier: 1.2 });
      out.push(`${r.playerIndex}:${r.flippedIndices.join(',')}:${r.remaining}`);
    }
    return out.join('|');
  };
  assert.equal(shape(s1), shape(s2));
});

test('ranking and winners report the top collectors', () => {
  const state = createMatch({
    stake: 3,
    seed: 5,
    players: [
      { id: 'a', name: 'A', bitaId: null },
      { id: 'b', name: 'B', bitaId: null },
    ],
  });
  while (state.status === 'active') smash(state, { powerMultiplier: 1 });
  const rank = ranking(state);
  assert.equal(rank.length, 2);
  assert.ok(rank[0].won >= rank[1].won);
  const w = winners(state);
  assert.ok(w.length >= 1);
  const best = Math.max(...state.players.map((p) => p.collected.length));
  for (const i of w) assert.equal(state.players[i].collected.length, best);
});

/* ──────────── aiming, «переход» and special moves (S2) ──────────── */

test('smash honours the aim (regression: the server used to ignore focus)', () => {
  const mk = (seed) =>
    createMatch({
      stake: 10,
      seed,
      firstPlayerIndex: 0,
      players: [
        { id: 'a', name: 'A', bitaId: null },
        { id: 'b', name: 'B', bitaId: null },
      ],
    });
  let differ = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const top = smash(mk(seed), { powerMultiplier: 1, focus: 0 });
    const bottom = smash(mk(seed), { powerMultiplier: 1, focus: 1 });
    if (top.flippedIndices.join(',') !== bottom.flippedIndices.join(',')) differ += 1;
  }
  assert.ok(differ > 0, 'aiming at a different depth must change the outcome');
});

test('a whiffed turn hands the next player a «переход» bonus', () => {
  const state = createMatch({
    stake: 5,
    seed: 3,
    firstPlayerIndex: 0,
    players: [
      { id: 'a', name: 'A', bitaId: null },
      { id: 'b', name: 'B', bitaId: null },
    ],
  });
  // A guaranteed whiff: no roll can ever succeed.
  state.rng = {
    next: () => 0.999,
    int: () => 0,
    chance: () => false,
    pick: (arr) => arr[0],
    shuffle: (arr) => arr,
    weighted: (items) => items[0],
  };
  const res = playTurn(state, { powerMultiplier: 1, focus: 0.5 });
  assert.equal(res.missed, true);
  assert.equal(state.players[1].focusBonus, MISS.BONUS);
  assert.equal(state.players[0].focusBonus, 0);
});

test('«отбой» weakens the next smash and pays a chip back into the pot', () => {
  const mkMiss = () => {
    const s = createMatch({
      stake: 5,
      seed: 3,
      firstPlayerIndex: 0,
      players: [
        { id: 'a', name: 'A', bitaId: null },
        { id: 'b', name: 'B', bitaId: null },
      ],
    });
    s.rng = {
      next: () => 0.999,
      int: (min) => min,
      chance: () => false,
      pick: (arr) => arr[0],
      shuffle: (arr) => arr,
      weighted: (items) => items[0],
    };
    return s;
  };

  const s = mkMiss();
  s.players[0].collected.push({ defId: 'chupa_green', faceUp: true });
  const before = s.stack.length + s.players[0].collected.length + s.players[1].collected.length;

  const res = playTurn(s, { move: 'brace', powerMultiplier: 1 });
  assert.equal(res.cost, MOVES.BRACE.COST);
  assert.equal(s.players[1].brace, MOVES.BRACE.WEAKEN);
  assert.equal(
    s.stack.length + s.players[0].collected.length + s.players[1].collected.length,
    before,
  );

  const hit = playTurn(s, { powerMultiplier: 1 });
  assert.equal(s.log[s.log.length - 1].weakened, true);
  assert.equal(s.players[1].brace, 0);
});

test('«точный удар» forces MIN_FLIPS chips and «двойной удар» takes two passes', () => {
  const mkMiss = () => {
    const s = createMatch({
      stake: 5,
      seed: 3,
      firstPlayerIndex: 0,
      players: [
        { id: 'a', name: 'A', bitaId: null },
        { id: 'b', name: 'B', bitaId: null },
      ],
    });
    s.rng = {
      next: () => 0.999,
      int: (min) => min,
      chance: () => false,
      pick: (arr) => arr[0],
      shuffle: (arr) => arr,
      weighted: (items) => items[0],
    };
    return s;
  };

  const precise = mkMiss();
  precise.players[0].collected.push({ defId: 'chupa_green', faceUp: true });
  precise.players[0].collected.push({ defId: 'chupa_red', faceUp: true });
  const pRes = playTurn(precise, { move: 'precise', focus: 0.5, powerMultiplier: 1 });
  assert.equal(pRes.reports[0].flipped.length, MOVES.PRECISE.MIN_FLIPS);
  assert.equal(pRes.reports[0].precise, true);
  assert.equal(pRes.cost, MOVES.PRECISE.COST);

  const dbl = mkMiss();
  dbl.players[0].collected.push({ defId: 'chupa_green', faceUp: true });
  const dRes = playTurn(dbl, { move: 'double', focus: 0.5, powerMultiplier: 1 });
  assert.equal(dRes.reports.length, 2);
  assert.equal(dbl.turn, 2);
  assert.equal(dbl.current, 1);
});

test('a bot-driven 4-player match still consumes the pot with moves enabled', () => {
  const state = createMatch({
    stake: 10,
    seed: 4242,
    players: [
      { id: 'a', name: 'A', bitaId: null },
      { id: 'b', name: 'B', bitaId: null },
      { id: 'c', name: 'C', bitaId: 'bit_star' },
      { id: 'd', name: 'D', bitaId: null },
    ],
  });
  let guard = 0;
  while (state.status === 'active' && guard++ < 4000) {
    const i = state.current;
    const pm = pickAiPower(state.rng, 0.7);
    playTurn(state, {
      powerMultiplier: pm,
      focus: pickAiFocus(state, i, state.rng, 0.7, pm),
      move: pickAiMove(state, i, state.rng),
    });
  }
  assert.equal(state.status, 'finished');
  assert.equal(state.stack.length, 0);
  const total = state.players.reduce((sum, p) => sum + p.collected.length, 0);
  assert.equal(total, 40, 'every anted chip must end up collected');
});

// Боты в том же матче иногда тратят спец-удары — иначе механика мертвая.
test('bots sometimes spend special moves in a 4-player game', () => {
  let specialSeen = 0;
  for (let seed = 1; seed <= 20 && specialSeen === 0; seed++) {
    const state = createMatch({
      stake: 10,
      seed: seed * 137 + 11,
      players: [
        { id: 'a', name: 'A', bitaId: null },
        { id: 'b', name: 'B', bitaId: null },
        { id: 'c', name: 'C', bitaId: null },
        { id: 'd', name: 'D', bitaId: null },
      ],
    });
    let guard = 0;
    while (state.status === 'active' && guard++ < 4000) {
      const i = state.current;
      const pm = pickAiPower(state.rng, 0.7);
      const mv = pickAiMove(state, i, state.rng);
      if (mv !== 'normal') specialSeen++;
      playTurn(state, {
        powerMultiplier: pm,
        focus: pickAiFocus(state, i, state.rng, 0.7, pm),
        move: mv,
      });
    }
  }
  assert.ok(specialSeen > 0, 'expected at least one special move across 20 seeds');
});

/* ───────────────────────── rooms ───────────────────────── */
function makeManager() {
  const inbox = new Map(); // clientId -> events[]
  const send = (clientId, event) => {
    if (!inbox.has(clientId)) inbox.set(clientId, []);
    inbox.get(clientId).push(event);
  };
  const rm = new RoomManager(send, () => {});
  return { rm, inbox };
}

const P = (id, name, bitaId = null) => ({ id, name, photo: null, bitaId });

test('create/join/list rooms and lobby privacy', () => {
  const { rm } = makeManager();
  const created = rm.create('c1', { name: 'Тест', stake: 50, maxPlayers: 4, isPublic: true }, P('u1', 'Host'));
  assert.ok(created.ok);
  const roomId = created.room.id;

  assert.equal(rm.listRooms().length, 1);
  assert.equal(rm.listRooms()[0].stake, 50);

  const joined = rm.join('c2', roomId, null, P('u2', 'Guest'));
  assert.ok(joined.ok);
  assert.equal(joined.room.players.length, 2);

  // private room does not appear in the lobby list
  rm.update('c1', roomId, { isPublic: false });
  assert.equal(rm.listRooms().length, 0);
  rm.dispose();
});

test('password protected room rejects a wrong password', () => {
  const { rm } = makeManager();
  const created = rm.create('c1', { name: 'Secret', stake: 10, maxPlayers: 3, password: 'кот' }, P('u1', 'Host'));
  const roomId = created.room.id;
  assert.equal(rm.join('c2', roomId, 'собака', P('u2', 'X')).error, 'bad_password');
  assert.ok(rm.join('c2', roomId, 'кот', P('u2', 'X')).ok);
  rm.dispose();
});

test('room enforces the player cap', () => {
  const { rm } = makeManager();
  const created = rm.create('c1', { name: 'Cap', stake: 10, maxPlayers: 2 }, P('u1', 'Host'));
  const roomId = created.room.id;
  assert.ok(rm.join('c2', roomId, null, P('u2', 'B')).ok);
  assert.equal(rm.join('c3', roomId, null, P('u3', 'C')).error, 'full');
  rm.dispose();
});

test('host starts a match; turns are enforced; bots auto-play', () => {
  const { rm, inbox } = makeManager();
  const created = rm.create('c1', { name: 'M', stake: 5, maxPlayers: 4 }, P('u1', 'Host'));
  const roomId = created.room.id;
  rm.join('c2', roomId, null, P('u2', 'B'));
  rm.addBot('c1', roomId, 'Bot');

  assert.ok(rm.start('c1', roomId).ok);
  assert.equal(rm.rooms.get(roomId).status, 'playing');

  const match = rm.rooms.get(roomId).match;
  const currentId = match.players[match.current].id;

  // Non-current players cannot smash.
  const wrong = currentId === 'u1' ? 'c2' : 'c1';
  assert.equal(rm.smash(wrong, roomId, 1).error, 'not_your_turn');

  const good = currentId === 'u1' ? 'c1' : 'c2';
  assert.ok(rm.smash(good, roomId, 1).ok);
  assert.ok((inbox.get('c1') || []).some((e) => e.t === 'match:smash'));
  rm.dispose();
});

test('empty rooms are removed once everyone leaves', () => {
  const { rm } = makeManager();
  const created = rm.create('c1', { name: 'Bye', stake: 10, maxPlayers: 2 }, P('u1', 'Host'));
  const roomId = created.room.id;
  rm.leave('c1');
  assert.equal(rm.rooms.has(roomId), false);
  rm.dispose();
});

test('forge level upgrades the bita power on the server', () => {
  const m = createMatch({
    stake: 5,
    players: [{ id: 'a', name: 'A', bitaId: 'bit_crown', bitaLevel: 5 }],
    firstPlayerIndex: 0,
  });
  const powered = powerOf(m, 0);
  assert.ok(Math.abs(powered.power - 2.0 * (1 + 0.08 * 4)) < 1e-9, `expected forged power ~2.64, got ${powered.power}`);
  const bare = createMatch({ stake: 5, players: [{ id: 'a', name: 'A', bitaId: 'bit_crown' }], firstPlayerIndex: 0 }, new Rng(7));
  assert.equal(powerOf(bare, 0).power, 2.0);
});

test('room player state carries the forge level', () => {
  const { rm } = makeManager();
  const created = rm.create('c1', { name: 'Lvl', stake: 5, maxPlayers: 2 }, P('u1', 'Host'));
  const roomId = created.room.id;
  rm.join('c2', roomId, null, P('u2', 'B'));
  assert.equal(rm.rooms.get(roomId).players.get('u1').bitaLevel, 1);
  rm.dispose();
});
