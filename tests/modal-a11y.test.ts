import { strict as assert } from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import createModal from '@ui/Modal';
import createInput from '@ui/Input';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window as unknown as typeof globalThis & Window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;

test('modal enforces dialog semantics and handles escape', async () => {
  const input = createInput({ type: 'text', ariaLabel: 'Name', autoFocus: true });
  let lastOpen: boolean | null = null;
  const heading = document.createElement('h2');
  heading.id = 'modal-title';
  heading.textContent = 'Modal Title';

  const opener = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();

  let modal = createModal({
    open: false,
    titleId: 'modal-title',
    initialFocus: () => input,
    onOpenChange(open) {
      lastOpen = open;
      if (!open) {
        modal.setOpen(false);
      }
    },
  });

  modal.dialog.append(heading, input);
  modal.setOpen(true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(modal.dialog.getAttribute('aria-modal'), 'true');
  assert.ok(
    modal.dialog.contains(document.activeElement),
    'focus should move inside the modal when opened',
  );

  const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  modal.dialog.dispatchEvent(esc);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(lastOpen, false, 'escape should request modal close');
});
