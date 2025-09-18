import { strict as assert } from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import createInput from '@ui/Input';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
(globalThis as any).window = dom.window as unknown as typeof globalThis & Window;
(globalThis as any).document = dom.window.document;
(globalThis as any).HTMLElement = dom.window.HTMLElement;

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('createInput wires dataset and initial attributes', async () => {
  const input = createInput({
    id: 'name',
    name: 'name',
    placeholder: 'Full name',
    autoFocus: true,
    ariaLabel: 'Full name',
    required: true,
  });

  assert.equal(input.dataset.ui, 'input');
  assert.equal(input.id, 'name');
  assert.equal(input.name, 'name');
  assert.equal(input.placeholder, 'Full name');
  assert.equal(input.autofocus, true);
  assert.equal(input.getAttribute('aria-label'), 'Full name');
  assert.equal(input.required, true);

  let value = '';
  input.addEventListener('input', () => {
    value = input.value;
  });
  input.value = 'Ada';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await nextTick();
  assert.equal(value, 'Ada');
});

test('input.update toggles attributes and invalid state', () => {
  const input = createInput({ placeholder: 'Email' });

  input.update({
    value: 'user@example.com',
    disabled: true,
    invalid: true,
    className: 'highlight',
  });

  assert.equal(input.value, 'user@example.com');
  assert.equal(input.disabled, true);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.ok(input.classList.contains('highlight'));

  input.update({ invalid: false, className: '' });
  assert.equal(input.getAttribute('aria-invalid'), 'false');
  assert.equal(input.className.includes('highlight'), false);
});
