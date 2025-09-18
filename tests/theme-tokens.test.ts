import { strict as assert } from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  pretendToBeVisual: true,
});

globalThis.window = dom.window as unknown as typeof globalThis & Window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

type MediaListener = (event: MediaQueryListEvent) => void;
const mediaListeners = new Set<MediaListener>();

(dom.window as unknown as { matchMedia: Window['matchMedia'] }).matchMedia = (query: string) => {
  const listeners = mediaListeners;
  const mediaQueryList: MediaQueryList = {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type !== 'change') return;
      if (typeof listener === 'function') {
        listeners.add(listener as MediaListener);
      } else if (listener && typeof listener.handleEvent === 'function') {
        listeners.add(listener.handleEvent.bind(listener) as MediaListener);
      }
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type !== 'change') return;
      if (typeof listener === 'function') {
        listeners.delete(listener as MediaListener);
      } else if (listener && typeof listener.handleEvent === 'function') {
        listeners.delete(listener.handleEvent.bind(listener) as MediaListener);
      }
    },
    addListener: (listener: MediaQueryListListener) => {
      listeners.add(listener as unknown as MediaListener);
    },
    removeListener: (listener: MediaQueryListListener) => {
      listeners.delete(listener as unknown as MediaListener);
    },
    dispatchEvent: () => true,
  };
  return mediaQueryList;
};
globalThis.matchMedia = dom.window.matchMedia.bind(dom.window);

dom.window.document.documentElement.style.setProperty('--space-2', '8px');
dom.window.document.documentElement.style.setProperty('--color-accent', '#ff7e36');
dom.window.document.documentElement.style.setProperty('--color-accent-text', '#ffffff');

type ThemeModule = typeof import('@ui/theme');
const themeModulePromise: Promise<ThemeModule> = import('@ui/theme');

function triggerMediaChange(matches = true): void {
  const event = {
    matches,
    media: '(prefers-color-scheme: dark)',
  } as MediaQueryListEvent;
  for (const listener of Array.from(mediaListeners)) {
    listener(event);
  }
}

test('getToken reads CSS custom properties from the root element', async () => {
  const theme = await themeModulePromise;
  assert.equal(theme.getToken('--space-2'), '8px');
  assert.equal(theme.getNumber('--space-2', 'px', -1), 8);
  assert.equal(theme.getColor('--color-accent'), '#ff7e36');
});

test('theme cache invalidates after theme:invalidate events', async () => {
  const theme = await themeModulePromise;
  assert.equal(theme.getColor('--color-accent'), '#ff7e36');
  dom.window.document.documentElement.style.setProperty('--color-accent', '#3366ff');
  dom.window.document.documentElement.style.setProperty('--space-2', '12px');
  document.dispatchEvent(new Event('theme:invalidate'));
  assert.equal(theme.getColor('--color-accent'), '#3366ff');
  assert.equal(theme.getNumber('--space-2', 'px'), 12);
});

test('onThemeChange subscribers fire for media query updates', async () => {
  const theme = await themeModulePromise;
  let count = 0;
  const unsubscribe = theme.onThemeChange(() => {
    count += 1;
  });
  triggerMediaChange(true);
  assert.equal(count, 1);
  triggerMediaChange(false);
  assert.equal(count, 2);
  document.dispatchEvent(new Event('theme:invalidate'));
  assert.equal(count, 3);
  unsubscribe();
  triggerMediaChange(true);
  assert.equal(count, 3);
});
