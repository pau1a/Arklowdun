import { strict as assert } from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import createModal from '@ui/Modal';
import createButton from '@ui/Button';
import { __resetKeyboardMapForTests } from '@ui/keys';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
(globalThis as any).window = dom.window as unknown as typeof globalThis & Window;
(globalThis as any).document = dom.window.document;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).KeyboardEvent = dom.window.KeyboardEvent;
(globalThis as any).navigator = dom.window.navigator as Navigator;

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
