import test from 'node:test';
import { strict as assert } from 'node:assert';
import {
  actions,
  selectors,
  subscribe,
  getState,
  __resetStore,
} from '../src/store/index.ts';

const sampleNote = () => ({
  id: 'note-1',
  text: 'Sample note',
  color: '#FFF4B8',
  x: 10,
  y: 20,
  z: 1,
  position: 0,
  household_id: 'household',
  created_at: Date.now(),
  updated_at: Date.now(),
  deleted_at: null,
});

test.beforeEach(() => {
  __resetStore();
});

test('setActivePane notifies subscribers only on change', () => {
  const updates: string[] = [];
  const unsubscribe = subscribe(selectors.app.activePane, (pane) => {
    updates.push(pane);
  });

  assert.deepEqual(updates, ['dashboard']);

  actions.setActivePane('calendar');
  actions.setActivePane('calendar');
  actions.setActivePane('notes');

  assert.deepEqual(updates, ['dashboard', 'calendar', 'notes']);
  unsubscribe();
});

test('notes snapshot cloning prevents external mutation', () => {
  const note = sampleNote();
  const payload = actions.notes.updateSnapshot({
    items: [note],
    ts: 123,
    source: 'test',
  });

  assert.equal(payload.count, 1);
  assert.equal(payload.ts, 123);

  const storedItems = selectors.notes.items(getState());
  assert.equal(storedItems.length, 1);
  assert.notStrictEqual(storedItems[0], note);
  assert.equal(storedItems[0]?.text, 'Sample note');

  note.text = 'Mutated externally';
  const afterMutation = selectors.notes.items(getState());
  assert.equal(afterMutation[0]?.text, 'Sample note');
});

