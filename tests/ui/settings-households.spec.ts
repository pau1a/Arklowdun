import { expect, test } from '@playwright/test';

const householdStub = `(() => {
  const households = [
    {
      id: '0',
      name: 'Default household',
      is_default: 1,
      tz: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      deleted_at: null,
      color: '#2563EB',
    },
  ];
  let activeId = '0';
  let counter = 1;
  const listeners = new Map();

  const emitEvent = (event, payload) => {
    const bucket = listeners.get(event);
    if (!bucket) return;
    for (const handler of bucket.values()) {
      try {
        handler({ event, payload });
      } catch (error) {
        console.error(error);
      }
    }
  };

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event, id) {
      const bucket = listeners.get(event);
      if (!bucket) return;
      bucket.delete(id);
      if (bucket.size === 0) listeners.delete(event);
    },
  };

  window.__TAURI_INTERNALS__ = {
    transformCallback(callback) {
      return callback;
    },
    convertFileSrc(path) {
      return path;
    },
    invoke(cmd, args = {}) {
      switch (cmd) {
        case 'plugin:event|listen': {
          const handler = args.handler;
          const id = 'listener_' + Math.random().toString(16).slice(2);
          const bucket = listeners.get(args.event) ?? new Map();
          bucket.set(id, handler);
          listeners.set(args.event, bucket);
          return Promise.resolve(id);
        }
        case 'plugin:event|unlisten': {
          const { event, eventId } = args;
          window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
          return Promise.resolve();
        }
        case 'household_list': {
          const includeDeleted = Boolean(args?.includeDeleted);
          const filtered = includeDeleted
            ? households
            : households.filter((item) => item.deleted_at === null);
          return Promise.resolve(filtered.map((item) => ({ ...item })));
        }
        case 'household_get_active':
          return Promise.resolve(activeId);
        case 'household_set_active': {
          const id = args?.id;
          const target = households.find((item) => item.id === id);
          if (!target) {
            return Promise.reject({ code: 'HOUSEHOLD_NOT_FOUND' });
          }
          if (target.deleted_at !== null) {
            return Promise.reject({ code: 'HOUSEHOLD_DELETED' });
          }
          if (id === activeId) {
            return Promise.reject({ code: 'HOUSEHOLD_ALREADY_ACTIVE' });
          }
          activeId = id;
          emitEvent('household:changed', { id });
          return Promise.resolve(null);
        }
        case 'household_create': {
          const id = 'hh-' + counter++;
          const record = {
            id,
            name: args?.name ?? id,
            is_default: 0,
            tz: null,
            created_at: Date.now(),
            updated_at: Date.now(),
            deleted_at: null,
            color: args?.color ?? null,
          };
          households.push(record);
          return Promise.resolve({ ...record });
        }
        case 'household_update': {
          const id = args?.id;
          const target = households.find((item) => item.id === id);
          if (!target) {
            return Promise.reject({ code: 'HOUSEHOLD_NOT_FOUND' });
          }
          if (target.deleted_at !== null) {
            return Promise.reject({ code: 'HOUSEHOLD_DELETED' });
          }
          if (typeof args?.name === 'string') {
            target.name = args.name;
          }
          if ('color' in args) {
            target.color = args.color ?? null;
          }
          target.updated_at = Date.now();
          return Promise.resolve({ ...target });
        }
        case 'household_delete': {
          const id = args?.id;
          const target = households.find((item) => item.id === id);
          if (!target) {
            return Promise.reject({ code: 'HOUSEHOLD_NOT_FOUND' });
          }
          if (target.is_default) {
            return Promise.reject({ code: 'DEFAULT_UNDELETABLE' });
          }
          if (target.deleted_at !== null) {
            return Promise.reject({ code: 'HOUSEHOLD_DELETED' });
          }
          target.deleted_at = Date.now();
          target.updated_at = target.deleted_at;
          let fallbackId = null;
          if (activeId === id) {
            fallbackId = '0';
            activeId = fallbackId;
            emitEvent('household:changed', { id: fallbackId });
          }
          return Promise.resolve({ fallbackId });
        }
        case 'household_restore': {
          const id = args?.id;
          const target = households.find((item) => item.id === id);
          if (!target) {
            return Promise.reject({ code: 'HOUSEHOLD_NOT_FOUND' });
          }
          target.deleted_at = null;
          target.updated_at = Date.now();
          return Promise.resolve({ ...target });
        }
        default:
          return Promise.resolve(null);
      }
    },
  };

  const stubWindow = {
    label: 'main',
    close: () => Promise.resolve(),
    minimize: () => Promise.resolve(),
    maximize: () => Promise.resolve(),
    unmaximize: () => Promise.resolve(),
    isMaximized: () => Promise.resolve(false),
    isDecorated: () => Promise.resolve(false),
    show: () => Promise.resolve(),
    hide: () => Promise.resolve(),
    setFocus: () => Promise.resolve(),
  };

  window.__TAURI_INTERNALS__.currentWindow = stubWindow;
  window.__TAURI_INTERNALS__.getCurrentWindow = () => stubWindow;
  window.__TAURI_INTERNALS__.metadata = {
    currentWindow: { label: 'main' },
    currentWebview: { windowLabel: 'main', label: 'main' },
  };
})();`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(householdStub);
});

test.describe('Settings households lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: 'Create household' })).toBeVisible();
  });

  test('create, rename, delete, and restore a household', async ({ page }) => {
    await page.getByRole('button', { name: 'Create household' }).click();
    await page.getByPlaceholder('Household name').fill('Secondary household');
    await page.locator('.settings__household-color').nth(1).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const row = page
      .locator('.settings__household-row')
      .filter({ hasText: 'Secondary household' });
    const rowId = await row.first().getAttribute('data-household-id');
    expect(rowId).toBeTruthy();
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Rename' }).click();
    await row.locator('.settings__household-edit .settings__household-input').fill('Guest suite');
    await row.getByRole('button', { name: 'Save' }).click();
    const renamedRow = page.locator(
      `.settings__household-row[data-household-id="${rowId}"]`,
    );
    await expect(renamedRow).toContainText('Guest suite');

    page.once('dialog', (dialog) => dialog.accept());
    await renamedRow.getByRole('button', { name: 'Delete' }).click();

    await page.locator('[data-ui="switch"]').click();
    const deletedRow = page
      .locator('.settings__household-deleted .settings__household-row')
      .filter({ hasText: 'Guest suite' });
    await expect(deletedRow).toBeVisible();
    await expect(deletedRow.locator('.settings__household-badge--deleted')).toBeVisible();

    await deletedRow.getByRole('button', { name: 'Restore' }).click();
    await expect(
      page
        .locator('.settings__household-list .settings__household-row')
        .filter({ hasText: 'Guest suite' }),
    ).toBeVisible();
  });

  test('deleting the active household falls back to default', async ({ page }) => {
    await page.getByRole('button', { name: 'Create household' }).click();
    await page.getByPlaceholder('Household name').fill('Temporary');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const tempRow = page
      .locator('.settings__household-row')
      .filter({ hasText: 'Temporary' });
    await tempRow.getByRole('button', { name: 'Set active' }).click();
    await expect(tempRow.locator('.settings__household-badge--active')).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await tempRow.getByRole('button', { name: 'Delete' }).click();

    const defaultRow = page
      .locator('.settings__household-row')
      .filter({ hasText: 'Default household' });
    await expect(defaultRow.locator('.settings__household-badge--active')).toBeVisible();
  });

  test('deleting the default household surfaces an error toast', async ({ page }) => {
    const defaultRow = page
      .locator('.settings__household-row')
      .filter({ hasText: 'Default household' });

    page.once('dialog', (dialog) => dialog.accept());
    await defaultRow.getByRole('button', { name: 'Delete' }).click();

    const errorToast = page
      .locator('#ui-toast-region .toast')
      .filter({ hasText: 'The default household cannot be deleted.' });
    await expect(errorToast).toBeVisible();
  });
});
