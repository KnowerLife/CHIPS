/**
 * End-to-end smoke test for the CHIPS online service **without a browser**.
 *
 *   node server/index.mjs &          # or: npm run server
 *   node scripts/smoke-online.mjs
 *
 * Drives two SSE clients through the full flow — create → join → add bot →
 * start → smash until the match ends → dev purchase — and asserts the events
 * each client receives. Exits non-zero on the first failure, so it doubles as a
 * post-deploy health check.
 */

const BASE = process.env.SMOKE_URL || 'http://localhost:8787';

/* ───────────────────────── tiny SSE client ───────────────────────── */

class SseClient {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.events = [];
    this.waiters = [];
  }

  async open() {
    const qs = new URLSearchParams({ clientId: this.id, name: this.name });
    const res = await fetch(`${BASE}/api/stream?${qs}`, { headers: { accept: 'text/event-stream' } });
    if (!res.ok) throw new Error(`stream ${res.status}`);
    this.reader = res.body.getReader();
    this.decoder = new TextDecoder();
    this.buffer = '';
    this._pump();
    return this;
  }

  async _pump() {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.buffer += this.decoder.decode(value, { stream: true });
        let idx;
        while ((idx = this.buffer.indexOf('\n\n')) >= 0) {
          const chunk = this.buffer.slice(0, idx);
          this.buffer = this.buffer.slice(idx + 2);
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            let ev;
            try {
              ev = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            this.events.push(ev);
            for (const w of [...this.waiters]) w();
          }
        }
      }
    } catch {
      /* closed */
    }
  }

  /** Wait until `pred` matches any received event (checks history first). */
  wait(pred, label, timeoutMs = 5000) {
    const found = this.events.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`[${this.name}] timeout waiting for ${label}. got: ${this.events.map((e) => e.t).join(',')}`));
      }, timeoutMs);
      const check = () => {
        const hit = this.events.find(pred);
        if (hit) {
          cleanup();
          resolve(hit);
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== check);
      };
      this.waiters.push(check);
    });
  }

  last() {
    return this.events[this.events.length - 1];
  }
}

async function cmd(clientId, type, payload = {}) {
  const res = await fetch(`${BASE}/api/cmd`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId, type, payload }),
  });
  return res.json();
}

/* ───────────────────────── assertions ───────────────────────── */

let checks = 0;
function ok(cond, msg) {
  checks += 1;
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

/* ───────────────────────── the flow ───────────────────────── */

async function main() {
  console.log(`\nCHIPS online smoke test → ${BASE}\n`);

  const health = await (await fetch(`${BASE}/api/health`)).json();
  ok(health.ok === true, 'health endpoint responds');

  const cfg = await (await fetch(`${BASE}/api/config`)).json();
  ok(Array.isArray(cfg.packages) && cfg.packages.length > 0, `config returns ${cfg.packages?.length} chip packs`);
  ok(cfg.limits.maxPlayers === 10, 'config advertises 10 max players');

  const alice = await new SseClient('smoke-alice', 'Alice').open();
  const bob = await new SseClient('smoke-bob', 'Bob').open();
  await alice.wait((e) => e.t === 'ready', 'ready');
  await bob.wait((e) => e.t === 'ready', 'ready');
  ok(true, 'two SSE clients connected');

  await cmd(alice.id, 'rooms:watch');
  await alice.wait((e) => e.t === 'rooms', 'initial rooms list');

  const created = await cmd(alice.id, 'room:create', {
    cfg: { name: 'Смоук-стол', stake: 10, maxPlayers: 4, isPublic: true, password: null },
  });
  ok(created.ok === true, 'Alice created a table');
  const roomId = created.room.id;

  await cmd(bob.id, 'rooms:watch');
  await bob.wait((e) => e.t === 'rooms' && e.rooms.some((r) => r.id === roomId), 'table appears in lobby');

  const joined = await cmd(bob.id, 'room:join', { roomId, password: null });
  ok(joined.ok === true, 'Bob joined the table');
  const stateEv = await alice.wait((e) => e.t === 'room:state' && e.room.players.length === 2, 'lobby shows 2 players');
  ok(stateEv.room.players.length === 2, 'Alice sees 2 players at the table');

  await cmd(alice.id, 'room:addBot', { roomId });
  const withBot = await alice.wait((e) => e.t === 'room:state' && e.room.players.length === 3, 'bot added');
  ok(withBot.room.players.some((p) => p.isBot), 'a bot seat was added');

  // Password-protected tables, tested with throwaway clients so Alice stays host
  // of the main table. A player also may only sit at ONE table at a time.
  const carol = await new SseClient('smoke-carol', 'Carol').open();
  const dave = await new SseClient('smoke-dave', 'Dave').open();
  await carol.wait((e) => e.t === 'ready', 'ready');
  await dave.wait((e) => e.t === 'ready', 'ready');

  const locked = await cmd(carol.id, 'room:create', { cfg: { name: 'Секрет', stake: 5, maxPlayers: 2, isPublic: false, password: 'кот' } });
  ok(locked.ok === true, 'Carol created a private table with a password');
  ok(locked.room.locked === true, 'the private table is flagged as locked');

  const badpw = await cmd(dave.id, 'room:join', { roomId: locked.room.id, password: 'собака' });
  ok(badpw.error === 'bad_password', 'wrong password is rejected');
  const goodpw = await cmd(dave.id, 'room:join', { roomId: locked.room.id, password: 'кот' });
  ok(goodpw.ok === true, 'right password lets Dave in');

  // Dave creating his own table must remove him from Carol's.
  await cmd(dave.id, 'room:create', { cfg: { name: 'Дом Дейва', stake: 5, maxPlayers: 2, isPublic: true } });
  const carolAlone = await carol.wait((e) => e.t === 'room:state' && e.room.players.length === 1, 'prev table loses Dave');
  ok(carolAlone.room.players.length === 1, 'a player can only sit at one table');
  await cmd(dave.id, 'room:leave');
  await cmd(carol.id, 'room:leave');

  const started = await cmd(alice.id, 'room:start', { roomId });
  ok(started.ok === true, 'Alice started the match');
  const start = await alice.wait((e) => e.t === 'match:start', 'match:start');
  await bob.wait((e) => e.t === 'match:start', 'match:start (Bob)');
  ok(start.match.stackCount === 30, `pot has stake×players chips (30, got ${start.match.stackCount})`);

  // Someone cannot smash out of turn.
  const names = start.match.players.map((p) => p.name);
  const firstPlayer = start.match.players[start.match.current];
  const wrongSmash = await cmd(firstPlayer.name === 'Alice' ? bob.id : alice.id, 'match:smash', { roomId, powerMultiplier: 1 });
  ok(wrongSmash.error === 'not_your_turn', 'out-of-turn smash is rejected');

  // Play the match to completion (bots auto-play on the server).
  let state = start.match;
  let turns = 0;
  let ended = null;
  while (state.status === 'active' && turns < 300) {
    const current = state.players[state.current];
    if (current.isBot) {
      // Should not happen: the server auto-plays bot turns after a human action.
      throw new Error(`state pointed at a bot (${current.name}) — auto-play did not run`);
    }
    const who = current.name === 'Alice' ? alice : bob;
    const prevTurn = state.turn;
    const res = await cmd(who.id, 'match:smash', { roomId, powerMultiplier: 1.2 });
    if (res.error) {
      throw new Error(
        `smash failed: ${res.error} (current=${current.name} idx=${state.current} ` +
          `turn=${state.turn} status=${state.status} roster=${state.players.map((p) => `${p.name}:${p.id}`).join('|')})`,
      );
    }
    // Wait for the *next* turn — either an advancing match:smash or the end.
    const ev = await who.wait(
      (e) => e.t === 'match:end' || (e.t === 'match:smash' && e.state.turn > prevTurn),
      'turn advance',
    );
    if (ev.t === 'match:end') {
      ended = ev;
      break;
    }
    state = ev.state;
    turns += 1;
  }

  // If the loop exited without seeing match:end, wait for it.
  if (!ended) ended = await alice.wait((e) => e.t === 'match:end', 'match:end', 8000);
  ok(!!ended, 'match ended with a result');
  const totalWon = ended.result.summary.reduce((s, p) => s + p.won, 0);
  ok(totalWon === 30, `every anted chip was collected (30, got ${totalWon})`);
  ok(ended.result.ranking.length === names.length, 'ranking covers every player');
  ok(typeof ended.result.winners[0] === 'number', 'a winner index was reported');

  // Dev purchase (no bot token in this environment).
  const invoice = await (await fetch(`${BASE}/api/shop/invoice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: alice.id, packageId: 'pack_small', name: 'Alice' }),
  })).json();
  ok(!!invoice.orderId, 'invoice created');
  if (invoice.devMode) {
    const grant = await (await fetch(`${BASE}/api/dev/grant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: alice.id, orderId: invoice.orderId }),
    })).json();
    ok(grant.ok === true, 'dev grant accepted');
    const wg = await alice.wait((e) => e.t === 'wallet:grant', 'wallet:grant');
    ok(wg.amount === 500, `wallet:grant carried the pack amount (500, got ${wg.amount})`);
  } else {
    ok(!!invoice.link, 'real invoice link returned');
  }

  console.log(`\n✅ ALL ${checks} CHECKS PASSED\n`);
  process.exit(0);
}

// Open SSE connections keep the event loop alive, so the process is ended
// explicitly on both paths; this watchdog guarantees it can never hang.
const watchdog = setTimeout(() => {
  console.error('\n❌ SMOKE TEST FAILED: global timeout\n');
  process.exit(2);
}, 90_000);

main().catch((err) => {
  clearTimeout(watchdog);
  console.error(`\n❌ SMOKE TEST FAILED: ${err.message}\n`);
  process.exit(1);
});
