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

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 16) as unknown as number;
  window.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);
}

if (!("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  // @ts-expect-error jsdom stub
  window.ResizeObserver = ResizeObserverStub;
}

if (!("PerformanceObserver" in window)) {
  class PerformanceObserverStub {
    observe() {}
    disconnect() {}
  }
  // @ts-expect-error jsdom stub
  window.PerformanceObserver = PerformanceObserverStub;
}

globalThis.window = window as unknown as typeof globalThis & Window;
globalThis.document = document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLInputElement = window.HTMLInputElement;
globalThis.Element = window.Element;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.Event = window.Event;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
// @ts-expect-error jsdom stub assignment
globalThis.ResizeObserver = window.ResizeObserver;
// @ts-expect-error jsdom stub assignment
globalThis.PerformanceObserver = window.PerformanceObserver;
if (!('navigator' in globalThis)) {
  Object.defineProperty(globalThis, 'navigator', {
    get: () => window.navigator as Navigator,
    configurable: true,
  });
}
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

test('command palette exposes pets commands', async () => {
  const { initCommandPalette } = await import('@ui/CommandPalette');
  const runtime = await import('../src/diagnostics/runtime');
  runtime.__testing.reset();
  runtime.__testing.disableFilePersistence();
  const palette = initCommandPalette();
  assert.ok(palette, 'palette should initialise');
  palette?.open();

  const input = document.getElementById('cp-input') as HTMLInputElement;
  input.value = 'pets';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));

  await new Promise((resolve) => setTimeout(resolve, 350));

  const options = Array.from(
    document.querySelectorAll<HTMLLIElement>('#cp-list li[role="option"]'),
  );
  assert.ok(options.length > 0, 'static pets commands should appear');
  const first = options[0];
  assert.match(first.textContent ?? '', /Pets/i);

  window.location.hash = '#/dashboard';
  first.click();

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.location.hash, '#/pets#focus-search');

  await runtime.__testing.waitForIdle();
  const snapshot = runtime.__testing.getSnapshot();
  assert.equal(snapshot.pets?.palette_invocations, 1);
});

test('pets controller queues focus requests until list registers', async () => {
  const {
    requestPetsFocus,
    registerPetsListController,
    unregisterPetsListController,
  } = await import('@features/pets/pageController');

  const flushController = {
    focusCreate: () => {},
    focusSearch: () => {},
    submitCreateForm: () => false,
    focusRow: () => {},
  };

  registerPetsListController(flushController);
  unregisterPetsListController(flushController);

  const actions: string[] = [];
  requestPetsFocus('create');
  requestPetsFocus('search');

  const controller = {
    focusCreate: () => actions.push('create'),
    focusSearch: () => actions.push('search'),
    submitCreateForm: () => false,
    focusRow: () => {},
  };

  registerPetsListController(controller);
  assert.deepEqual(actions, ['create', 'search']);

  actions.length = 0;
  requestPetsFocus('search');
  assert.deepEqual(actions, ['search']);

  unregisterPetsListController(controller);
});

async function flushAnimationFrames(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

test('pets page reordering controls emit callbacks and restore focus', async () => {
  const { createPetsPage, createFilterModels } = await import('@features/pets/PetsPage');
  const container = document.createElement('div');
  document.body.appendChild(container);

  const page = createPetsPage(container);
  page.listViewport.style.height = '400px';
  page.listViewport.style.width = '400px';

  const pets = [
    {
      id: 'pet-1',
      name: 'Alpha',
      type: 'Cat',
      household_id: 'hh',
      position: 0,
      created_at: 0,
      updated_at: 0,
    },
    {
      id: 'pet-2',
      name: 'Beta',
      type: 'Dog',
      household_id: 'hh',
      position: 1,
      created_at: 0,
      updated_at: 0,
    },
  ];

  const reorders: Array<{ id: string; delta: number }> = [];
  page.setCallbacks({
    onReorderPet: (id, delta) => {
      reorders.push({ id, delta });
    },
  });

  page.setPets(pets as any);
  page.setFilter(createFilterModels(pets as any, ''));

  await flushAnimationFrames(2);

  const rows = Array.from(container.querySelectorAll<HTMLDivElement>('.pets__card'));
  assert.equal(rows.length >= 2, true, 'expected rows to be rendered');

  const focusCalls: Array<string | undefined> = [];
  const originalFocus = window.HTMLElement.prototype.focus;
  window.HTMLElement.prototype.focus = function focusProxy(this: HTMLElement, ...args: unknown[]) {
    focusCalls.push(this.dataset?.id ?? this.id ?? this.className);
    return originalFocus.apply(this, args as []);
  };

  try {
    page.focusRow('pet-2');
    await flushAnimationFrames(3);
  } finally {
    window.HTMLElement.prototype.focus = originalFocus;
  }

  assert.ok(
    focusCalls.some((id) => id === 'pet-2' || id?.includes('pets__card')),
    'expected focusRow to invoke focus on the active row',
  );

  const moveEvent = new window.KeyboardEvent('keydown', {
    key: 'ArrowUp',
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  rows[1]?.dispatchEvent(moveEvent);

  assert.equal(moveEvent.defaultPrevented, true);
  assert.deepEqual(reorders, [{ id: 'pet-2', delta: -1 }]);

  page.destroy();
  container.remove();
});

test('pets page ignores reorder shortcuts while editing inline', async () => {
  const { createPetsPage, createFilterModels } = await import('@features/pets/PetsPage');
  const container = document.createElement('div');
  document.body.appendChild(container);

  const page = createPetsPage(container);
  page.listViewport.style.height = '400px';
  page.listViewport.style.width = '400px';

  const pets = [
    {
      id: 'pet-1',
      name: 'Alpha',
      type: 'Cat',
      household_id: 'hh',
      position: 0,
      created_at: 0,
      updated_at: 0,
    },
    {
      id: 'pet-2',
      name: 'Beta',
      type: 'Dog',
      household_id: 'hh',
      position: 1,
      created_at: 0,
      updated_at: 0,
    },
  ];

  const reorders: Array<{ id: string; delta: number }> = [];
  page.setCallbacks({
    onReorderPet: (id, delta) => {
      reorders.push({ id, delta });
    },
  });

  page.setPets(pets as any);
  page.setFilter(createFilterModels(pets as any, ''));

  await flushAnimationFrames(2);

  const rows = Array.from(container.querySelectorAll<HTMLDivElement>('.pets__card'));
  assert.equal(rows.length >= 2, true, 'expected rows to be rendered');
  const editBtn = Array.from(rows[1]?.querySelectorAll('button') ?? []).find(
    (button) => button.textContent === 'Edit',
  ) as HTMLButtonElement | undefined;
  assert.ok(editBtn, 'edit button should exist');
  editBtn?.click();

  await flushAnimationFrames(1);

  const nameInput = rows[1]?.querySelector('input');
  assert.ok(nameInput, 'inline editor should render name input');

  const moveEvent = new window.KeyboardEvent('keydown', {
    key: 'ArrowUp',
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  nameInput?.dispatchEvent(moveEvent);

  assert.equal(moveEvent.defaultPrevented, false, 'reorder shortcut should not fire while editing');
  assert.deepEqual(reorders, []);

  page.destroy();
  container.remove();
});
