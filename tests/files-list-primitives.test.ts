import { strict as assert } from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import createFilesList, {
  type FilesListItem,
} from '@features/files/components/FilesList';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window as unknown as typeof globalThis & Window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;

const sampleItem: FilesListItem = {
  entry: { name: 'example.txt', isFile: true },
  relativePath: 'example.txt',
  typeLabel: 'File',
  sizeLabel: '',
  modifiedLabel: '',
};

test('FilesList uses primitives for interactive controls', () => {
  const list = createFilesList({
    onActivate: () => {},
    getRowActions: () => [
      {
        label: 'Delete',
        onSelect: () => {},
      },
    ],
    emptyState: {
      title: 'Empty',
      actionLabel: 'New file',
    },
    onEmptyAction: () => {},
  });

  list.setItems([sampleItem]);
  const rowButtons = Array.from(list.element.querySelectorAll('button'));
  assert.ok(rowButtons.length > 0, 'expected row actions to render buttons');
  for (const button of rowButtons) {
    assert.equal(button.dataset.ui, 'button', 'row actions must use UI Button primitive');
  }

  const rawInputs = list.element.querySelectorAll('input, select');
  assert.equal(rawInputs.length, 0, 'no raw inputs should be rendered by FilesList');

  list.setItems([]);
  const emptyButtons = Array.from(list.element.querySelectorAll('button'));
  for (const button of emptyButtons) {
    assert.equal(button.dataset.ui, 'button', 'empty state must use UI Button primitive');
  }
});
