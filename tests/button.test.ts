import { strict as assert } from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import createButton from '@ui/Button';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
(globalThis as any).window = dom.window as unknown as typeof globalThis & Window;
(globalThis as any).document = dom.window.document;
(globalThis as any).HTMLElement = dom.window.HTMLElement;

const nextAnimationFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

test('createButton applies dataset, variant, and label', async () => {
  const button = createButton({ label: 'Save', variant: 'primary', autoFocus: true });

  assert.equal(button.dataset.ui, 'button');
  assert.equal(button.textContent, 'Save');
  assert.equal(button.type, 'button');
  assert.ok(button.classList.contains('btn'));
  assert.ok(button.classList.contains('btn--accent'));
  assert.equal(button.autofocus, true);

  let clicked = false;
  button.addEventListener('click', () => {
    clicked = true;
  });
  button.click();
  await nextAnimationFrame();
  assert.equal(clicked, true);
});

test('button.update mutates variant, size, label, and aria state', () => {
  const button = createButton({ label: 'Archive', variant: 'ghost', size: 'md' });

  button.update({
    variant: 'danger',
    size: 'sm',
    label: 'Delete',
    ariaPressed: true,
    className: 'extra-class',
  });

  assert.ok(button.classList.contains('btn--danger'));
  assert.ok(button.classList.contains('btn--sm'));
  assert.equal(button.textContent, 'Delete');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.ok(button.classList.contains('extra-class'));

  button.update({ ariaPressed: false, className: '' });
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.classList.contains('extra-class'), false);
});
