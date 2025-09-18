// Node 22+: navigator is a read-only getter; do not reassign globalThis.navigator.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import createModal from '@ui/Modal';
import createButton from '@ui/Button';
import { __resetKeyboardMapForTests } from '@ui/keys';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const domWindow = dom.window;
const { navigator: windowNavigator } = domWindow;
(globalThis as any).window = domWindow as unknown as typeof globalThis & Window;
(globalThis as any).document = domWindow.document;
(globalThis as any).HTMLElement = domWindow.HTMLElement;
(globalThis as any).KeyboardEvent = domWindow.KeyboardEvent;

if (!('navigator' in globalThis)) {
  Object.defineProperty(globalThis, 'navigator', {
    get: () => windowNavigator as Navigator,
    configurable: true,
  });
} else {
  const targetNavigator = globalThis.navigator as Navigator & Record<string, unknown>;
  const sourceNavigator = windowNavigator as Navigator & Record<string, unknown>;
  const keysToCopy = ['platform', 'language', 'languages', 'userAgent'] as const;

  for (const key of keysToCopy) {
    const value = sourceNavigator[key];
    if (value === undefined) continue;
    if (key in targetNavigator && targetNavigator[key] === value) continue;

    try {
      Object.defineProperty(targetNavigator, key, {
        configurable: true,
        enumerable: true,
        value,
      });
      continue;
    } catch {
      try {
        Object.defineProperty(targetNavigator, key, {
          configurable: true,
          enumerable: true,
          get: () => sourceNavigator[key],
        });
      } catch {
        // Ignore failures when the runtime marks navigator properties as non-configurable.
      }
    }
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test.beforeEach(() => {
  __resetKeyboardMapForTests();
  dom.window.document.body.innerHTML = '';
});

test('modal toggles open state and attaches overlay metadata', async () => {
  const heading = document.createElement('h2');
  heading.id = 'modal-title';
  heading.textContent = 'Example modal';

  const closeButton = createButton({ label: 'Close', type: 'button' });

  const modal = createModal({
    open: false,
    titleId: 'modal-title',
    descriptionId: 'modal-description',
    onOpenChange(open) {
      if (!open) modal.setOpen(false);
    },
  });

  const description = document.createElement('p');
  description.id = 'modal-description';
  description.textContent = 'Modal description';

  modal.dialog.append(heading, description, closeButton);

  assert.equal(modal.root.dataset.ui, 'modal');
  assert.equal(modal.root.isConnected, false);

  modal.setOpen(true);
  await flush();

  assert.equal(modal.isOpen(), true);
  assert.equal(modal.root.hasAttribute('hidden'), false);
  assert.equal(modal.dialog.getAttribute('aria-labelledby'), 'modal-title');
  assert.equal(modal.dialog.getAttribute('aria-describedby'), 'modal-description');
  assert.equal(document.body.style.overflow, 'hidden');

  modal.update({ descriptionId: undefined });
  assert.equal(modal.dialog.hasAttribute('aria-describedby'), false);

  modal.setOpen(false);
  await flush();

  assert.equal(modal.isOpen(), false);
  assert.equal(document.body.style.overflow, '');
  assert.equal(modal.root.isConnected, false);
});

test('modal respects closeOnOverlayClick flag', async () => {
  const heading = document.createElement('h2');
  heading.id = 'modal-title';

  const modal = createModal({
    open: true,
    titleId: 'modal-title',
    closeOnOverlayClick: false,
    onOpenChange(open) {
      if (!open) modal.setOpen(false);
    },
  });
  modal.dialog.append(heading);

  await flush();
  const overlayClick = new dom.window.MouseEvent('click', { bubbles: true });
  modal.root.dispatchEvent(overlayClick);
  await flush();
  assert.equal(modal.isOpen(), true, 'modal should ignore overlay clicks when disabled');

  modal.update({ closeOnOverlayClick: true });
  modal.root.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flush();
  assert.equal(modal.isOpen(), false, 'modal should close once overlay clicks are enabled');
});
