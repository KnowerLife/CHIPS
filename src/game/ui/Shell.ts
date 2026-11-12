/**
 * Desktop/browser shell helpers: fullscreen and the DOM chrome around the
 * canvas.
 *
 * The game itself is a fixed-size Phaser canvas; everything here is additive
 * glue so that a desktop browser feels like a native window (F to fullscreen,
 * a button in the side pane) and so that the same build can be installed as a
 * PWA. All browser APIs are guarded — running under Node (tests) is safe.
 */

/** Is the document currently fullscreen? */
export function isFullscreen(): boolean {
  try {
    return typeof document !== 'undefined' && !!document.fullscreenElement;
  } catch {
    return false;
  }
}

/** Toggle fullscreen on `<html>`. Silently no-ops when unsupported. */
export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (typeof document === 'undefined') return false;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return false;
    }
    const el = document.documentElement;
    if (el.requestFullscreen) {
      await el.requestFullscreen();
      return true;
    }
  } catch {
    /* denied by the browser or unsupported on this element */
  }
  return isFullscreen();
}

/** Update the shell's fullscreen buttons to reflect the current state. */
function syncFullscreenButtons(): void {
  try {
    if (typeof document === 'undefined') return;
    const on = isFullscreen();
    for (const el of document.querySelectorAll<HTMLElement>('[data-fullscreen]')) {
      el.dataset.active = on ? 'true' : 'false';
      const label = el.dataset.labelOn ?? 'Выйти из полного экрана';
      const off = el.dataset.labelOff ?? 'Полный экран';
      el.setAttribute('aria-label', on ? label : off);
      el.setAttribute('title', on ? label : off);
      const text = el.querySelector<HTMLElement>('[data-fullscreen-text]');
      if (text) text.textContent = on ? label : off;
    }
  } catch {
    /* non-DOM embedding */
  }
}

/**
 * Wire the shell once at boot: fullscreen buttons, the `F` shortcut, and the
 * fullscreen-change sync. Returns a teardown function (used by tests).
 */
export function initShell(): () => void {
  if (typeof document === 'undefined') return () => {};

  const onClick = (event: Event): void => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-fullscreen]');
    if (!target) return;
    event.preventDefault();
    void toggleFullscreen();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.code !== 'KeyF' || event.repeat) return;
    // Never steal `F` from a real text field (room names, stakes, chat).
    const el = document.activeElement as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
    event.preventDefault();
    void toggleFullscreen();
  };

  // PWA install prompt: Chromium fires this once the manifest + SW are live.
  let installEvent: (Event & { prompt?: () => Promise<void> }) | null = null;
  const installBtn = document.querySelector<HTMLButtonElement>('#btn-install');
  const onBeforeInstall = (event: Event): void => {
    event.preventDefault();
    installEvent = event as Event & { prompt?: () => Promise<void> };
    if (installBtn) installBtn.hidden = false;
  };
  const onInstallClick = (): void => {
    if (!installEvent) return;
    const e = installEvent;
    installEvent = null;
    if (installBtn) installBtn.hidden = true;
    void e.prompt?.();
  };

  document.addEventListener('click', onClick);
  document.addEventListener('fullscreenchange', syncFullscreenButtons);
  window.addEventListener('keydown', onKey);
  window.addEventListener('beforeinstallprompt', onBeforeInstall);
  installBtn?.addEventListener('click', onInstallClick);
  syncFullscreenButtons();

  return () => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('fullscreenchange', syncFullscreenButtons);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    installBtn?.removeEventListener('click', onInstallClick);
  };
}

/**
 * Register the offline/service-worker shell in production builds only. In dev
 * the SW would cache Vite's HMR modules and fight the dev server.
 */
export function registerServiceWorker(): void {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!import.meta.env.PROD) return;
    const url = `${import.meta.env.BASE_URL}sw.js`;
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register(url).catch(() => {
        /* offline shell is a bonus, never a failure */
      });
    });
  } catch {
    /* ignore */
  }
}
