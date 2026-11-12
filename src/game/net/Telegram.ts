import { PROFILE_STORAGE_KEY } from '../Constants';

/**
 * Thin wrapper over the Telegram Mini App SDK (`telegram-web-app.js`, loaded in
 * `index.html`). Everything degrades gracefully in a normal browser so the game
 * stays fully playable outside Telegram — the only things that need Telegram are
 * Stars payments, share links and haptics.
 *
 * Docs: https://core.telegram.org/bots/webapps
 */

/* Minimal shapes for the parts of the SDK we touch. */
interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}
interface TgHaptic {
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
  notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  selectionChanged(): void;
}
interface TgWebApp {
  initData: string;
  initDataUnsafe: { user?: TgUser; start_param?: string };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  isExpanded: boolean;
  ready(): void;
  expand(): void;
  close(): void;
  openLink(url: string, opts?: { try_instant_view?: boolean }): void;
  openTelegramLink(url: string): void;
  openInvoice(url: string, cb?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void): void;
  showPopup(params: Record<string, unknown>, cb?: (id: string) => void): void;
  showAlert(message: string, cb?: () => void): void;
  showConfirm(message: string, cb?: (ok: boolean) => void): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  enableClosingConfirmation(): void;
  HapticFeedback?: TgHaptic;
  themeParams?: Record<string, string>;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export function tgApp(): TgWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function isTelegram(): boolean {
  const app = tgApp();
  return !!app && app.platform !== 'unknown' && !!app.initData;
}

/** Call once at boot: expand, colour the header, enable haptics. */
export function initTelegram(): void {
  const app = tgApp();
  if (!app) return;
  try {
    app.ready();
    app.expand();
    app.setHeaderColor('#06031a');
    app.setBackgroundColor('#06031a');
    app.enableClosingConfirmation?.();
  } catch {
    /* older SDKs — ignore */
  }
}

export function initData(): string {
  return tgApp()?.initData ?? '';
}

/** Start parameter of a Mini App deep link (`?startapp=...`). */
export function startParam(): string {
  const app = tgApp();
  if (app?.initDataUnsafe?.start_param) return app.initDataUnsafe.start_param;
  return new URLSearchParams(location.search).get('room') || '';
}

export function tgUser(): TgUser | null {
  return tgApp()?.initDataUnsafe?.user ?? null;
}

/** Haptic tap; no-op outside Telegram. */
export function haptic(kind: 'tap' | 'success' | 'error' | 'warn' | 'select' = 'tap'): void {
  const h = tgApp()?.HapticFeedback;
  if (!h) return;
  try {
    if (kind === 'success') h.notificationOccurred('success');
    else if (kind === 'error') h.notificationOccurred('error');
    else if (kind === 'warn') h.notificationOccurred('warning');
    else if (kind === 'select') h.selectionChanged();
    else h.impactOccurred('light');
  } catch {
    /* ignore */
  }
}

/* ───────────────────────── invite links ───────────────────────── */

/** Stable per-device id used as the account key outside Telegram. */
export function clientId(): string {
  const KEY = `${PROFILE_STORAGE_KEY}.clientId`;
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID?.() || `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9:_-]/g, '');
    localStorage.setItem(KEY, id);
  }
  return id;
}

/**
 * Build the deep link that drops a friend straight into a room.
 *  - Inside Telegram with a configured bot: a Mini App link (`?startapp=room_XXX`)
 *    so the friend opens the game and lands in the room.
 *  - Otherwise: a plain URL with `?room=XXX` (works on the web build too).
 */
export function roomInviteLink(roomId: string, botUsername: string): string {
  if (botUsername && isTelegram()) {
    return `https://t.me/${botUsername}?startapp=room_${roomId}`;
  }
  const base = `${location.origin}${location.pathname}`;
  return `${base}?room=${roomId}`;
}

/**
 * Share a room invite. Uses the native Telegram share sheet when available and
 * falls back to Web Share / clipboard copy. Resolves with how it was shared.
 */
export async function shareRoom(
  roomId: string,
  botUsername: string,
  text: string,
): Promise<'telegram' | 'native' | 'clipboard'> {
  const link = roomInviteLink(roomId, botUsername);
  const app = tgApp();
  const shareText = `${text}\n${link}`;

  if (app) {
    // t.me/share opens the "choose a chat" sheet inside Telegram.
    app.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    return 'telegram';
  }
  const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title: 'CHIPS', text, url: link });
      return 'native';
    } catch {
      /* user cancelled → fall through to clipboard */
    }
  }
  await navigator.clipboard?.writeText(shareText).catch(() => {});
  return 'clipboard';
}

/* ───────────────────────── payments ───────────────────────── */

export type InvoiceResult = 'paid' | 'cancelled' | 'failed' | 'pending' | 'opened';

/**
 * Open a Telegram Stars invoice link. In a browser (no SDK) we simply open the
 * link and report `opened` — the caller then polls the order status.
 */
export function openInvoice(link: string): Promise<InvoiceResult> {
  const app = tgApp();
  if (app && typeof app.openInvoice === 'function') {
    return new Promise((resolve) => {
      try {
        app.openInvoice(link, (status) => resolve(status));
      } catch {
        resolve('failed');
      }
    });
  }
  window.open(link, '_blank');
  return Promise.resolve('opened');
}

/** Alert helper that works with and without the SDK. */
export function notify(message: string): void {
  const app = tgApp();
  if (app?.showAlert) app.showAlert(message);
  else window.alert(message);
}
