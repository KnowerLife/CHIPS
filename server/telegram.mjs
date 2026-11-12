/**
 * Telegram Bot API helper — Mini App auth + Telegram Stars (XTR) payments.
 *
 * Design notes
 * ------------
 *  - The Mini App (web view) sends `initData` on connect. We verify its HMAC so
 *    a client cannot spoof another user's id (see `validateInitData`).
 *  - Chip packs are bought with **Telegram Stars**: we create an invoice link
 *    via `createInvoiceLink` (currency `XTR`), the client opens it with
 *    `Telegram.WebApp.openInvoice`, and the bot receives `successful_payment`
 *    through the webhook, which is where chips are actually credited.
 *  - With no `BOT_TOKEN` (local dev / plain browser) we run in **dev mode**:
 *    invoices resolve to a mock link and granting is done through
 *    `POST /api/dev/grant`, so the whole flow is testable without Telegram.
 *
 * Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

import crypto from 'node:crypto';

export const CHIP_PACKAGES = [
  { id: 'pack_small', title: 'Горсть фишек', chips: 500, stars: 25, emoji: '🪙' },
  { id: 'pack_medium', title: 'Мешок фишек', chips: 2500, stars: 100, emoji: '💰', bonus: 0 },
  { id: 'pack_large', title: 'Сундук фишек', chips: 10000, stars: 350, emoji: '🧰' },
  { id: 'pack_mega', title: 'Казначейство', chips: 50000, stars: 1500, emoji: '🏦' },
  { id: 'donate_small', title: 'Поддержать игру', chips: 200, stars: 15, emoji: '❤️' },
];

export function getConfig() {
  const botToken = process.env.BOT_TOKEN || '';
  const botUsername = (process.env.BOT_USERNAME || '').replace(/^@/, '');
  return {
    botToken,
    botUsername,
    webappUrl: process.env.WEBAPP_URL || '',
    port: Number(process.env.PORT || 8787),
    devMode: !botToken,
    publicUrl: process.env.PUBLIC_URL || `http://localhost:${Number(process.env.PORT || 8787)}`,
  };
}

/** Call a Bot API method. Returns `result` or throws. */
export async function callApi(method, params) {
  const { botToken } = getConfig();
  if (!botToken) throw new Error('dev_mode: BOT_TOKEN is not configured');
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.ok) {
    throw new Error(`telegram ${method} failed: ${data ? data.description : res.status}`);
  }
  return data.result;
}

/**
 * Validate Mini App `initData`. Returns the parsed fields or null when invalid.
 * `user` is JSON-decoded for convenience.
 */
export function validateInitData(initData) {
  const { botToken, devMode } = getConfig();
  if (!initData || typeof initData !== 'string') return null;

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const hash = params.get('hash');
  params.delete('hash');
  if (!hash) return null;

  if (devMode) {
    // No secret to check against — parse but flag as unverified (dev only).
    return { ...parseParams(params), verified: false };
  }

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = crypto.createHmac('sha256', botToken).update('WebAppData').digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computed !== hash) return null;
  return { ...parseParams(params), verified: true };
}

function parseParams(params) {
  const out = {};
  for (const [k, v] of params.entries()) out[k] = v;
  if (typeof out.user === 'string') {
    try {
      out.user = JSON.parse(out.user);
    } catch {
      /* leave as string */
    }
  }
  return out;
}

/** Locate a package definition by id. */
export function findPackage(id) {
  return CHIP_PACKAGES.find((p) => p.id === id) || null;
}

/**
 * Create a Telegram Stars invoice link for a chip pack.
 * @param {{id:string,title:string,description?:string,chips:number,stars:number}} pack
 * @param {string} payload  order id echoed back in `successful_payment`
 * @param {number} [priceStars] override price (used for custom "поддержать" amounts)
 */
export async function createInvoiceLink(pack, payload, priceStars) {
  const price = Math.max(1, Math.floor(priceStars ?? pack.stars));
  return callApi('createInvoiceLink', {
    title: pack.title,
    description: pack.description || `${pack.chips} фишек в игре CHIPS`,
    payload,
    currency: 'XTR',
    prices: [{ label: pack.title, amount: price }],
  });
}

/** Register the webhook pointing at this service. */
export async function setWebhook(baseUrl) {
  return callApi('setWebhook', {
    url: `${baseUrl}/api/telegram/webhook`,
    allowed_updates: ['message', 'pre_checkout_query', 'callback_query'],
  });
}

export async function deleteWebhook() {
  return callApi('deleteWebhook', { drop_pending_updates: false });
}

export async function sendMessage(chatId, text, replyMarkup) {
  return callApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });
}

export async function answerPreCheckout(queryId, ok, errorMessage) {
  return callApi('answerPreCheckoutQuery', {
    pre_checkout_query_id: queryId,
    ok,
    error_message: errorMessage,
  });
}

/** Keyboard that opens the Mini App from a chat message. */
export function webAppKeyboard(webappUrl) {
  return {
    inline_keyboard: [[{ text: '🎮 Играть в CHIPS', web_app: { url: webappUrl } }]],
  };
}
