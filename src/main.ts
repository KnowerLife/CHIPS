import Phaser from 'phaser';
import './styles.css';
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from './game/Constants';
import { BootScene } from './game/scenes/BootScene';
import { MenuScene } from './game/scenes/MenuScene';
import { MatchScene } from './game/scenes/MatchScene';
import { CollectionScene } from './game/scenes/CollectionScene';
import { MarketScene } from './game/scenes/MarketScene';
import { LeaderboardScene } from './game/scenes/LeaderboardScene';
import { OnlineScene } from './game/scenes/OnlineScene';
import { RoomScene } from './game/scenes/RoomScene';
import { session } from './game/State';
import { addChips } from './game/systems/Economy';
import { bitaLevel } from './game/systems/Forge';
import { audio, audioDebug } from './game/ui/Audio';
import { getSettings, updateSettings } from './game/systems/Settings';
import { initTelegram } from './game/net/Telegram';
import { net } from './game/net/Net';
import { initShell, registerServiceWorker } from './game/ui/Shell';

/**
 * Phaser bootstrap for CHIPS.
 *
 * The game uses a fixed logical resolution (`GAME_WIDTH` x `GAME_HEIGHT`) and
 * `Scale.FIT` so the same build runs on desktop, tablet, mobile browsers and
 * inside the Telegram Mini App.
 */

// Lightweight mobile/debug error surface (helps when DevTools unavailable).
function showBootError(msg: string): void {
  try {
    let el = document.getElementById('boot-error');
    if (!el) {
      el = document.createElement('pre');
      el.id = 'boot-error';
      el.style.cssText =
        'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;max-height:45vh;overflow:auto;' +
        'padding:10px 12px;border-radius:10px;background:rgba(120,0,0,.94);color:#fff;' +
        'font:12px/1.4 monospace;white-space:pre-wrap;word-break:break-word;pointer-events:auto';
      document.body.appendChild(el);
    }
    el.textContent = (el.textContent ? el.textContent + '\n\n' : '') + msg;
  } catch {
    /* ignore */
  }
}
window.addEventListener('error', (e) => {
  const msg = e.error?.stack || e.message || String(e);
  showBootError(`[error] ${msg}${e.filename ? `\n@ ${e.filename}:${e.lineno}:${e.colno}` : ''}`);
});
window.addEventListener('unhandledrejection', (e) => {
  const r = (e as PromiseRejectionEvent).reason;
  showBootError(`[unhandledrejection] ${r?.stack || r || e}`);
});
window.addEventListener('chips:boot-error', (e) => {
  showBootError(`[boot] ${(e as CustomEvent).detail || 'unknown boot error'}`);
});

// Mini App setup (no-op in a plain browser) + open the online push channel.
initTelegram();
net().connect({
  name: session.profile.name,
  bitaId: session.profile.equippedBita,
  bitaLevel: bitaLevel(session.profile, session.profile.equippedBita),
});

// Desktop chrome: fullscreen button/`F`, PWA install prompt, offline shell.
initShell();
registerServiceWorker();

// Audio can only start inside a user gesture (autoplay policy) — arm it on the
// first interaction of any kind, once, and then let the scenes play freely.
// `pointerdown` covers modern browsers; `mousedown`/`touchstart`/`keydown` are
// there for older engines and synthetic input (automated smoke tests).
for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click'] as const) {
  window.addEventListener(ev, () => audio.unlock(), { once: true, passive: true });
}

// Chips bought with Telegram Stars (or granted by the server for any reason)
// are credited to the local profile here, so the balance is always right no
// matter which scene is on screen. Scenes subscribe separately to refresh UI.
net().on('wallet:grant', (ev) => {
  if (ev.amount > 0) {
    addChips(session.profile, ev.amount);
    session.save();
  }
});

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#06031a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // Real DOM elements for text inputs (table name, password, custom stake).
  dom: {
    createContainer: true,
  },
  render: {
    antialias: true,
    roundPixels: false,
  },
  scene: [
    BootScene,
    MenuScene,
    MatchScene,
    CollectionScene,
    MarketScene,
    LeaderboardScene,
    OnlineScene,
    RoomScene,
  ],
};

const game = new Phaser.Game(config);

// Expose handles for quick debugging in the browser console.
(window as unknown as { CHIPS: unknown }).CHIPS = {
  game,
  scenes: SCENE_KEYS,
  session,
  net,
  audio,
  audioDebug,
  settings: getSettings,
  updateSettings,
};

export default game;
