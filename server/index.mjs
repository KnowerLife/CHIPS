/**
 * CHIPS online service — HTTP (REST + static) + Server-Sent Events transport.
 *
 * Why SSE instead of WebSockets?
 *   The game is turn-based, so one push channel (server → client) plus plain
 *   POSTs (client → server) is plenty, needs **zero dependencies**, passes
 *   through every proxy and is trivially deployable on a free PaaS. If realtime
 *   twitch gameplay is ever added, swap this file for a WS server — the
 *   `RoomManager` is transport-agnostic.
 *
 * Endpoints
 *   GET  /api/health                 liveness probe
 *   GET  /api/config                 feature flags + shop catalog (+ bot username)
 *   GET  /api/stream?...             SSE push channel (rooms, match, wallet)
 *   POST /api/cmd                    client → server commands (see `handleCommand`)
 *   POST /api/shop/invoice           create a Telegram Stars invoice for a pack
 *   POST /api/shop/order/:id         poll order status (fallback if SSE missed)
 *   POST /api/dev/grant              dev-mode chip grant (no BOT_TOKEN)
 *   POST /api/telegram/webhook       Telegram update receiver
 *   GET  /*                          static build from ./dist (SPA fallback)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { RoomManager, MAX_PLAYERS, MIN_PLAYERS, MAX_STAKE, serializeMatch } from './rooms.mjs';
import {
  CHIP_PACKAGES,
  createInvoiceLink,
  findPackage,
  getConfig,
  sendMessage,
  answerPreCheckout,
  setWebhook,
  validateInitData,
  webAppKeyboard,
} from './telegram.mjs';
import {
  addPending,
  completeOrder,
  createOrder,
  drainPending,
  ensureAccount,
  getOrder,
  getLeaderboard,
  flushNow,
  submitScore,
} from './store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const cfg = getConfig();

/* ───────────────────────── client registry ───────────────────────── */

/** clientId -> { res, profile, accountId, refs, lastSeen } */
const clients = new Map();

function send(clientId, event) {
  const c = clients.get(clientId);
  if (!c || !c.res) return;
  try {
    c.res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    /* connection is going away; cleanup happens on 'close' */
  }
}

function emitToAccount(accountId, event) {
  for (const [id, c] of clients) if (c.accountId === accountId) send(id, event);
}

function profileFor(client) {
  return {
    id: client.accountId,
    name: client.profile.name,
    photo: client.profile.photo,
    bitaId: client.profile.bitaId,
    bitaLevel: client.profile.bitaLevel,
  };
}

const rooms = new RoomManager(send, () => rooms.pushLobby());

/* ───────────────────────── helpers ───────────────────────── */

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/** Clamp a client-supplied forge level to the legal 1…5 range. */
function clampLevel(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(5, n);
}

/** Resolve a stable account id: Telegram user when verified, else web client. */
function resolveAccount(body) {
  const clientId = String(body.clientId || '').slice(0, 64) || crypto.randomUUID();
  let accountId = `web:${clientId}`;
  let tgUser = null;
  if (body.initData) {
    const data = validateInitData(body.initData);
    if (data && data.user && data.user.id) {
      tgUser = data.user;
      accountId = `tg:${data.user.id}`;
    }
  }
  return { clientId, accountId, tgUser };
}

/* ───────────────────────── SSE ───────────────────────── */

function handleStream(req, res, url) {
  const clientId = String(url.searchParams.get('clientId') || '').slice(0, 64) || crypto.randomUUID();
  const initData = url.searchParams.get('initData') || '';
  const { accountId, tgUser } = resolveAccount({ clientId, initData });

  const client = clients.get(clientId) || { profile: {} };
  client.res = res;
  client.accountId = accountId;
  client.tgUser = tgUser;
  client.profile = {
    name: decodeURIComponent(url.searchParams.get('name') || '') || (tgUser ? `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim() : '') || 'Игрок',
    photo: url.searchParams.get('photo') || (tgUser && tgUser.photo_url) || null,
    bitaId: url.searchParams.get('bitaId') || client.profile.bitaId || null,
    bitaLevel: clampLevel(url.searchParams.get('bitaLevel') || client.profile.bitaLevel),
  };
  client.lastSeen = Date.now();
  clients.set(clientId, client);

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');
  send(clientId, { t: 'ready', clientId, accountId, devMode: cfg.devMode });

  // Deliver any chips bought while offline.
  const pending = drainPending(accountId);
  if (pending > 0) send(clientId, { t: 'wallet:grant', amount: pending, reason: 'purchase' });

  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* ignore */
    }
  }, 25_000);
  if (ping.unref) ping.unref();

  const cleanup = () => {
    clearInterval(ping);
    rooms.unwatch(clientId);
    if (clients.get(clientId) === client) {
      client.res = null;
    }
    rooms.leave(clientId);
  };
  req.on('close', cleanup);
  res.on('error', cleanup);
}

/* ───────────────────────── commands ───────────────────────── */

async function handleCommand(body) {
  const { clientId, accountId } = resolveAccount(body);
  const client = clients.get(clientId);
  if (!client || !client.res) return { error: 'no_stream' };
  const profile = profileFor(client);
  const p = body.payload || {};

  switch (body.type) {
    case 'hello':
      send(clientId, { t: 'hello:ack', profile });
      return { ok: true };

    case 'rooms:watch':
      rooms.watch(clientId);
      return { ok: true };
    case 'rooms:unwatch':
      rooms.unwatch(clientId);
      return { ok: true };

    case 'room:create':
      return rooms.create(clientId, p.cfg, profile);
    case 'room:join':
      return rooms.join(clientId, p.roomId, p.password, profile);
    case 'room:leave':
      return rooms.leave(clientId);
    case 'room:kick':
      return rooms.kick(clientId, p.roomId, p.targetId);
    case 'room:update':
      return rooms.update(clientId, p.roomId, p.cfg);
    case 'room:addBot':
      return rooms.addBot(clientId, p.roomId, p.name);
    case 'room:start':
      return rooms.start(clientId, p.roomId);
    case 'room:reset':
      return rooms.reset(clientId, p.roomId);
    case 'room:sync':
      return rooms.sync(clientId);
    case 'match:smash':
      return rooms.smash(clientId, p.roomId, p.powerMultiplier, p.focus, p.move);
    case 'leaderboard:submit': {
      const score = submitScore(
        accountId,
        profile.name,
        p.chips,
        p.wins,
      );
      return { ok: true, chips: score.chips, wins: score.wins };
    }

    default:
      return { error: 'unknown_command' };
  }
}

/* ───────────────────────── shop ───────────────────────── */

async function handleInvoice(body) {
  const { clientId, accountId } = resolveAccount(body);
  const pack = findPackage(body.packageId);
  if (!pack) return { error: 'unknown_package' };

  const orderId = crypto.randomUUID();
  const customStars = body.stars ? Math.max(1, Math.floor(Number(body.stars))) : undefined;
  const chips = body.chips ? Math.max(1, Math.floor(Number(body.chips))) : pack.chips;
  const price = customStars ?? pack.stars;

  createOrder({
    id: orderId,
    accountId,
    clientId,
    packageId: pack.id,
    chips,
    stars: price,
    title: pack.title,
  });
  ensureAccount(accountId, body.name);

  if (cfg.devMode) {
    return { ok: true, orderId, devMode: true, chips, stars: price, link: null };
  }
  try {
    const link = await createInvoiceLink({ ...pack, chips }, orderId, price);
    return { ok: true, orderId, link, chips, stars: price, devMode: false };
  } catch (err) {
    return { error: 'invoice_failed', message: String(err.message || err) };
  }
}

/** Credit a paid order exactly once. */
function grantOrder(orderId, meta) {
  const order = getOrder(orderId);
  if (!order) return null;
  if (order.status === 'paid') return order;
  completeOrder(orderId);
  const connected = [...clients.values()].some((c) => c.accountId === order.accountId && c.res);
  if (connected) {
    emitToAccount(order.accountId, { t: 'wallet:grant', amount: order.chips, reason: 'purchase', orderId });
  } else {
    addPending(order.accountId, order.chips, { orderId, packageId: order.packageId });
  }
  return order;
}

/* ───────────────────────── Telegram webhook ───────────────────────── */

async function handleWebhook(update) {
  try {
    if (update.pre_checkout_query) {
      await answerPreCheckout(update.pre_checkout_query.id, true);
      return;
    }
    const msg = update.message || update.edited_message;
    if (msg && msg.successful_payment) {
      const sp = msg.successful_payment;
      const order = grantOrder(sp.invoice_payload, sp);
      if (order && msg.chat) {
        await sendMessage(
          msg.chat.id,
          `✅ Оплата получена! Зачислено <b>${order.chips}</b> фишек. Вернитесь в игру.`,
        );
      }
      return;
    }
    if (msg && typeof msg.text === 'string' && msg.text.startsWith('/start')) {
      const { webappUrl } = getConfig();
      const text = [
        '<b>CHIPS</b> — дворовая игра «Сотки/Фишки» 🎮',
        '',
        'Собирай коллекцию кэпсов, обыгрывай друзей и играй онлайн до 10 человек за столом.',
      ].join('\n');
      if (webappUrl) await sendMessage(msg.chat.id, text, webAppKeyboard(webappUrl));
      else await sendMessage(msg.chat.id, text);
    }
  } catch (err) {
    console.warn('[webhook] error:', err.message);
  }
}

/* ───────────────────────── static files ───────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

function serveStatic(req, res, url) {
  if (!fs.existsSync(DIST_DIR)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Frontend build not found. Run `npm run build` first (dist/).');
    return;
  }
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
  let filePath = path.join(DIST_DIR, safe);
  if (!filePath.startsWith(DIST_DIR)) filePath = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html'); // SPA fallback
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

/* ───────────────────────── server ───────────────────────── */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    return res.end();
  }

  if (pathname === '/api/health') return json(res, 200, { ok: true, rooms: rooms.rooms.size, uptime: process.uptime() });

  if (pathname === '/api/config') {
    return json(res, 200, {
      devMode: cfg.devMode,
      botUsername: cfg.botUsername,
      webappUrl: cfg.webappUrl,
      packages: CHIP_PACKAGES,
      limits: { minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, maxStake: MAX_STAKE },
    });
  }

  if (pathname === '/api/leaderboard') {
    return json(res, 200, { entries: getLeaderboard(20), online: true });
  }

  if (pathname === '/api/stream' && req.method === 'GET') return handleStream(req, res, url);

  if (pathname === '/api/cmd' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await handleCommand(body);
    // Game-level rejections (out-of-turn, missing room, …) are normal traffic,
    // not HTTP failures — answer 200 and let the client read `result.error`.
    // Returning 4xx here would spam the browser console for routine actions.
    return json(res, 200, result);
  }

  if (pathname === '/api/shop/invoice' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await handleInvoice(body);
    return json(res, 200, result);
  }

  if (pathname.startsWith('/api/shop/order/')) {
    const id = pathname.split('/').pop();
    const order = getOrder(id);
    if (!order) return json(res, 200, { error: 'not_found' });
    return json(res, 200, { id: order.id, status: order.status, chips: order.chips });
  }

  if (pathname === '/api/dev/grant' && req.method === 'POST') {
    if (!cfg.devMode) return json(res, 403, { error: 'dev_only' });
    const body = await readBody(req);
    const order = getOrder(body.orderId);
    if (!order) return json(res, 404, { error: 'not_found' });
    const paid = grantOrder(body.orderId, { dev: true });
    return json(res, 200, { ok: true, chips: paid ? paid.chips : 0 });
  }

  if (pathname === '/api/telegram/webhook' && req.method === 'POST') {
    const update = await readBody(req);
    await handleWebhook(update);
    return json(res, 200, { ok: true });
  }

  // everything else → static SPA
  return serveStatic(req, res, url);
});

server.listen(cfg.port, () => {
  const mode = cfg.devMode ? 'DEV (no BOT_TOKEN — mock payments enabled)' : 'PRODUCTION';
  console.log(`[chips] server on http://localhost:${cfg.port} — ${mode}`);
  if (!cfg.devMode && cfg.publicUrl && !cfg.publicUrl.includes('localhost')) {
    setWebhook(cfg.publicUrl)
      .then(() => console.log('[chips] telegram webhook registered →', `${cfg.publicUrl}/api/telegram/webhook`))
      .catch((err) => console.warn('[chips] setWebhook failed:', err.message));
  }
});

function shutdown() {
  console.log('\n[chips] shutting down…');
  rooms.dispose();
  flushNow();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { server, rooms, serializeMatch };
