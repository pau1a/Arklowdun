import { strict as assert } from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(
  '<!doctype html><html><body><div id="modal-root"></div><div id="search-live"></div><button id="sidebar-search"></button><button id="focus-origin">Origin</button></body></html>',
  { url: 'http://localhost/' },
);

const { window } = dom;
const { document } = window;

Object.defineProperty(window.navigator, 'platform', {
  value: 'MacIntel',
  configurable: true,
});

if (!window.matchMedia) {
  window.matchMedia = () =>
    ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as MediaQueryList;
}

globalThis.window = window as unknown as typeof globalThis & Window;
globalThis.document = document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLInputElement = window.HTMLInputElement;
globalThis.Element = window.Element;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.Event = window.Event;
globalThis.navigator = window.navigator as Navigator;
globalThis.matchMedia = window.matchMedia.bind(window);

test('command palette shortcut opens and closes with focus restore', async () => {
  const { initCommandPalette } = await import('@ui/CommandPalette');
  const {
    initKeyboardMap,
    __resetKeyboardMapForTests: resetKeys,
    isShortcutReserved,
  } = await import('@ui/keys');

  resetKeys();

  const palette = initCommandPalette();
  assert.ok(palette, 'command palette should initialise');

  initKeyboardMap({
    openCommandPalette: () => {
      palette?.open();
    },
  });

  const origin = document.getElementById('focus-origin') as HTMLButtonElement;
  origin.focus();

  const openEvent = new window.KeyboardEvent('keydown', {
    key: 'k',
    metaKey: true,
    bubbles: true,
  });
  document.dispatchEvent(openEvent);

  await new Promise((resolve) => setTimeout(resolve, 0));

  const paletteRoot = document.getElementById('command-palette');
  assert.ok(paletteRoot, 'palette root should exist');
  assert.equal(paletteRoot?.getAttribute('role'), 'dialog');
  assert.equal(paletteRoot?.getAttribute('aria-modal'), 'true');
  assert.equal(paletteRoot?.hidden, false, 'palette should be visible');

  const focusTarget = document.getElementById('cp-input');
  assert.equal(document.activeElement, focusTarget, 'focus should move inside palette');

  const escEvent = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  document.dispatchEvent(escEvent);

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(document.activeElement, origin, 'focus should return to opener after closing');

  assert.ok(isShortcutReserved('['), 'previous pane shortcut should be reserved');
  assert.ok(isShortcutReserved(']'), 'next pane shortcut should be reserved');

  resetKeys();
});
