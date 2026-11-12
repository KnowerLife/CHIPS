# CHIPS — deploy guide (Telegram Mini App + online multiplayer)

This document explains how to run CHIPS locally with multiplayer and how to put
it online as a **Telegram Mini App** with **Telegram Stars** payments.

- [Architecture](#architecture)
- [Run locally](#run-locally)
- [Create the Telegram bot](#create-the-telegram-bot)
- [Deploy to Amvera](#deploy-to-amvera)
- [Deploy with Docker (any host)](#deploy-with-docker-any-host)
- [Environment variables](#environment-variables)
- [How payments work](#how-payments-work)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
┌────────────────────────────┐        ┌──────────────────────────────────────┐
│  Client (Phaser 3 + TS)     │        │  server/index.mjs (plain Node ESM)   │
│  built by Vite → ./dist     │        │  • serves ./dist (static SPA)        │
│                             │        │  • /api  REST (config, shop, webhook)│
│  net/Net.ts                 │  SSE   │  • /api/stream  push channel (SSE)   │
│   • EventSource ← server ───┼────────┤  rooms.mjs   RoomManager (2–10 seats)│
│   • POST /api/cmd  ─────────┼───────►│  engine.mjs  authoritative smash     │
│  net/Telegram.ts            │        │  telegram.mjs initData + Stars       │
└────────────────────────────┘        │  store.mjs   JSON persistence        │
                                       └──────────────────────────────────────┘
```

- **Turn-based ⇒ SSE, not WebSockets.** Server → client pushes go over
  `EventSource`; client → server actions are plain `POST /api/cmd`. This keeps
  the backend **dependency-free** (`node:http` only) and deployable anywhere.
- **The server is authoritative.** It owns the RNG and resolves every smash;
  clients only animate the reports (`server/engine.mjs`). The 1-vs-1 offline
  engine (`src/game/systems/MatchEngine.ts`) is untouched.
- **Accounts**: inside Telegram the id is `tg:<user id>` (from verified
  `initData`); in a browser it is `web:<clientId>`.

---

## Run locally

```bash
npm install

# Terminal A + B together (frontend + server):
npm run dev:all

# …or run them separately:
npm run server      # http://localhost:8787  (API + SSE + serves ./dist if built)
npm run dev         # http://localhost:5173  (Vite; proxies /api → :8787)
```

Open <http://localhost:5173>, press **🌐 ИГРЫ ОНЛАЙН**, create a table and add a
bot to start immediately. To test with a second human, open the game in another
browser (or private window) and join the table from the list.

Without `BOT_TOKEN` the server runs in **dev mode**: the shop works end-to-end
using a mock payment (`POST /api/dev/grant`), so you can validate the whole
purchase flow without touching Telegram.

Tests:

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest (client/core)
npm run test:server   # node --test server/*.test.mjs (engine + rooms)
```

---

## Create the Telegram bot

1. Talk to [@BotFather](https://t.me/BotFather) → `/newbot` → get the **token**.
   - `BOT_TOKEN`
   - `BOT_USERNAME` (the `@name`, without `@`)
2. Deploy the app first (next sections) so you have a public HTTPS URL, then:
   - BotFather → `/mybots` → your bot → **Bot Settings → Menu Button /
     Configure Mini App** → set the URL to your `WEBAPP_URL`.
   - Or set `/setmenubutton`.
3. Put `BOT_TOKEN`, `BOT_USERNAME`, `WEBAPP_URL` and `PUBLIC_URL` in the
   environment (see below). On boot the server registers the payment webhook
   automatically at `<PUBLIC_URL>/api/telegram/webhook`.
4. **Stars** are enabled per-bot by Telegram; digital goods sold with `XTR`
   need no payment provider token. If a payment is rejected, check
   `/mybots → Payments` and that your bot is not in a region where Stars are
   unavailable.

---

## Deploy to Amvera

[Amvera](https://amvera.ru) builds the `Dockerfile`, gives you free HTTPS and a
`*.amvera.io` domain.

1. Create a project (e.g. `chips`) and connect your Git repository.
2. Amvera picks up `amvera.yml` automatically. Make sure the app listens on
   **8787** (already set) — Amvera proxies HTTPS → that port.
3. In **Переменные окружения / Environment**, add:
   `BOT_TOKEN`, `BOT_USERNAME`, `WEBAPP_URL` (= your public URL),
   `PUBLIC_URL` (= same public URL).
4. Attach a persistent volume mounted at **`/data`** (the `DATA_DIR`) so the
   JSON store survives restarts.
5. Deploy (push to the connected branch, or use the dashboard **Собрать и
   развернуть**).
6. Health check: `https://<your-domain>/api/health` → `{"ok":true,...}`.

> The tutorial this was based on:
> <https://habr.com/ru/companies/amvera/articles/994030/>.

---

## Deploy with Docker (any host)

```bash
docker build -t chips .
docker run -d --name chips \
  -p 8787:8787 \
  -v chips-data:/data \
  -e BOT_TOKEN=... \
  -e BOT_USERNAME=... \
  -e WEBAPP_URL=https://your.domain \
  -e PUBLIC_URL=https://your.domain \
  chips
```

Put a TLS-terminating reverse proxy (Caddy / nginx / Traefik) in front of it and
point `WEBAPP_URL` / `PUBLIC_URL` at the HTTPS URL. **Telegram requires HTTPS.**

Caddy example:

```
chips.example.com {
    reverse_proxy localhost:8787
}
```

> SSE note: disable proxy response buffering for `/api/stream` (Caddy and nginx
> do this by default with `X-Accel-Buffering: no`, which the server already sends).

---

## Environment variables

| Variable       | Default          | Purpose                                                        |
| -------------- | ---------------- | -------------------------------------------------------------- |
| `PORT`         | `8787`           | HTTP port                                                      |
| `BOT_TOKEN`    | *(empty)*        | Bot token. Empty ⇒ **dev mode** (mock payments, no Telegram IO)|
| `BOT_USERNAME` | *(empty)*        | Bot `@name`, used for invite deep links                        |
| `WEBAPP_URL`   | *(empty)*        | Public Mini App URL                                            |
| `PUBLIC_URL`   | `http://localhost:PORT` | Base URL for webhook registration                       |
| `DATA_DIR`     | `./server/data`  | Folder for the JSON store (mount a volume in prod)             |

---

## How payments work

```
Client                     Server                        Telegram
  │  POST /api/shop/invoice   │                              │
  ├──────────────────────────►│  createInvoiceLink (XTR)     │
  │                           ├─────────────────────────────►│
  │   { orderId, link }       │◄─────────────────────────────┤
  │◄──────────────────────────┤                              │
  │  WebApp.openInvoice(link) │                              │
  ├──────────────────────────────────────────────────────────►
  │                           │   webhook successful_payment │
  │                           │◄─────────────────────────────┤
  │   SSE  wallet:grant       │  (credits the account)       │
  │◄──────────────────────────┤                              │
```

- Orders live in the JSON store; a payment is credited **exactly once**
  (`grantOrder` checks `status === 'paid'`).
- If the player is offline when the webhook arrives, chips are stored as a
  **pending grant** and delivered over SSE the next time they connect.
- Chip packs are defined in `server/telegram.mjs` (`CHIP_PACKAGES`); the client
  shows them from `/api/config` and falls back to `src/game/data/Shop.ts`.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Lobby shows **● офлайн** | The game server isn't running/reachable. In dev start `npm run server`; in prod check `/api/health`. |
| Invite link doesn't open the room | Set `BOT_USERNAME`; the link is `https://t.me/<bot>?startapp=room_<ID>`. |
| "Оплата не прошла" | Stars unavailable for the bot / region, or the bot is in a test mode. Check BotFather → Payments. |
| Purchases credit nothing | The webhook didn't reach the server. Ensure `PUBLIC_URL` is public HTTPS and `/api/telegram/webhook` is reachable; the server registers it on boot. |
| Data disappears after restart | `DATA_DIR` isn't on a persistent volume. Mount one at `/data`. |
| Schema/type drift between client & server | Both mirror `src/game/data/*` ↔ `server/gamedata.mjs`; keep them in sync. |
