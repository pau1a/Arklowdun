import { strict as assert } from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { FamilyView } from '../src/FamilyView.ts';
import { familyRepo } from '../src/repos.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
});

dom.window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
  dom.window.setTimeout(() => callback(performance.now()), 0)) as typeof dom.window.requestAnimationFrame;

(globalThis as any).window = dom.window as typeof globalThis & Window;
(globalThis as any).document = dom.window.document;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as any).HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
(globalThis as any).HTMLButtonElement = dom.window.HTMLButtonElement;

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('FamilyView emits a single drawer save log per attempt', async () => {
  const originalList = familyRepo.list;
  const originalUpdate = familyRepo.update;

  familyRepo.list = async () => [
    {
      id: 'mem-1',
      name: 'Member One',
      household_id: 'hh-1',
      created_at: 0,
      updated_at: 0,
      position: 0,
      birthday: null,
      notes: 'note',
    } as any,
  ];

  let updateCalls = 0;
  familyRepo.update = async () => {
    updateCalls += 1;
  };

  const events: Array<{ level: string; cmd: string; details: Record<string, unknown> }> = [];
  const container = document.createElement('div');
  document.body.appendChild(container);

  await FamilyView(container, {
    getHouseholdId: async () => 'hh-1',
    log: (level, cmd, details) => {
      events.push({ level, cmd, details });
    },
  });

  await flush();

  const memberButton = container.querySelector<HTMLButtonElement>('button[data-id]');
  assert.ok(memberButton, 'member button present');
  memberButton!.click();
  await flush();

  const backButton = container.querySelector<HTMLButtonElement>('#family-back');
  assert.ok(backButton, 'back button present');
  backButton!.click();
  await flush();

  assert.equal(updateCalls, 1, 'update called exactly once');
  const drawerLogs = events.filter((entry) => entry.cmd === 'ui.family.drawer.save');
  assert.equal(drawerLogs.length, 1, `expected one drawer save log, saw ${drawerLogs.length}`);
  const startLogs = events.filter((entry) => entry.cmd === 'ui.family.drawer.save.start');
  assert.equal(startLogs.length, 1, 'expected one drawer save start log');

  document.body.removeChild(container);
  familyRepo.list = originalList;
  familyRepo.update = originalUpdate;
});
