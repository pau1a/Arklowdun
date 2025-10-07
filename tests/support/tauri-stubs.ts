export const settingsInitStub = `(() => {
  const bootstrap = window.__ARKLOWDUN_FIXTURE__ ?? {};
  const STORAGE_KEYS = {
    households: "__ARKLOWDUN_TEST_HOUSEHOLDS__",
    activeId: "__ARKLOWDUN_TEST_ACTIVE_ID__",
    counter: "__ARKLOWDUN_TEST_COUNTER__",
  };

  const canUseStorage = (() => {
    try {
      return typeof localStorage !== "undefined";
    } catch {
      return false;
    }
  })();

  const loadPersistedState = () => {
    if (!canUseStorage) return null;
    try {
      const rawHouseholds = localStorage.getItem(STORAGE_KEYS.households);
      const rawActiveId = localStorage.getItem(STORAGE_KEYS.activeId);
      const rawCounter = localStorage.getItem(STORAGE_KEYS.counter);
      const households = rawHouseholds ? JSON.parse(rawHouseholds) : null;
      const counter = rawCounter != null ? Number.parseInt(rawCounter, 10) : null;
      if (!Array.isArray(households)) {
        return null;
      }
      return {
        households,
        activeId: typeof rawActiveId === "string" ? rawActiveId : null,
        counter: Number.isFinite(counter) ? counter : null,
      };
    } catch {
      return null;
    }
  };

  const persistState = (state) => {
    if (!canUseStorage) return;
    try {
      localStorage.setItem(
        STORAGE_KEYS.households,
        JSON.stringify(state.households ?? []),
      );
      if (state.activeId == null) {
        localStorage.removeItem(STORAGE_KEYS.activeId);
      } else {
        localStorage.setItem(STORAGE_KEYS.activeId, state.activeId);
      }
      localStorage.setItem(
        STORAGE_KEYS.counter,
        String(state.counter ?? state.households?.length ?? 0),
      );
    } catch {
      // ignore storage failures in tests
    }
  };

  const persisted = loadPersistedState();

  const households =
    persisted?.households ??
    bootstrap.households ?? [
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
  let activeId = persisted?.activeId ?? bootstrap.activeId ?? '0';
  let counter = persisted?.counter ?? bootstrap.counter ?? households.length;
  if (typeof counter !== "number" || !Number.isFinite(counter)) {
    counter = households.length;
  }
  if (counter < households.length) {
    counter = households.length;
  }
  counter = Math.max(counter, 1);
  const listeners = new Map();
  const dbHealth = bootstrap.dbHealth ?? {
    status: 'ok',
    checks: [],
    offenders: [],
    schema_hash: 'test-schema',
    app_version: '1.0.0-test',
    generated_at: new Date().toISOString(),
  };

  const syncFixture = () => {
    const previous = window.__ARKLOWDUN_FIXTURE__ ?? {};
    window.__ARKLOWDUN_FIXTURE__ = {
      ...previous,
      households,
      activeId,
      counter,
      dbHealth,
    };
    persistState({ households, activeId, counter });
  };
  const getFixture = () => window.__ARKLOWDUN_FIXTURE__ ?? {};
  syncFixture();

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

  const expectCommandArgs = (command, input) => {
    if (!input || typeof input !== 'object' || !('args' in input)) {
      return {
        error: {
          code: 'APP/UNKNOWN',
          message: 'missing required key args for command ' + command,
        },
      };
    }
    const nested = input.args;
    if (!nested || typeof nested !== 'object') {
      return {
        error: {
          code: 'APP/UNKNOWN',
          message: 'invalid args payload for command ' + command,
        },
      };
    }
    return { params: nested };
  };

  const isHexColor = (value) =>
    typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());

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
          syncFixture();
          return Promise.resolve(null);
        }
        case 'household_create': {
          const { params, error } = expectCommandArgs('household_create', args);
          if (error) {
            return Promise.reject(error);
          }
          const id = 'hh-' + counter++;
          let color = null;
          if (Object.prototype.hasOwnProperty.call(params, 'color')) {
            if (params.color == null || params.color === '') {
              color = null;
            } else if (isHexColor(params.color)) {
              color = params.color.trim().toUpperCase();
            } else {
              return Promise.reject({ code: 'INVALID_COLOR' });
            }
          }
          const record = {
            id,
            name: typeof params.name === 'string' ? params.name : id,
            is_default: 0,
            tz: null,
            created_at: Date.now(),
            updated_at: Date.now(),
            deleted_at: null,
            color,
          };
          households.push(record);
          syncFixture();
          return Promise.resolve({ ...record });
        }
        case 'household_update': {
          const { params, error } = expectCommandArgs('household_update', args);
          if (error) {
            return Promise.reject(error);
          }
          const id = params.id;
          if (typeof id !== 'string' || id.trim() === '') {
            return Promise.reject({
              code: 'APP/UNKNOWN',
              message: 'household_update requires an id string',
            });
          }
          const target = households.find((item) => item.id === id);
          if (!target) {
            return Promise.reject({ code: 'HOUSEHOLD_NOT_FOUND' });
          }
          if (target.deleted_at !== null) {
            return Promise.reject({ code: 'HOUSEHOLD_DELETED' });
          }
          if (typeof params.name === 'string') {
            target.name = params.name;
          }
          if (Object.prototype.hasOwnProperty.call(params, 'color')) {
            if (params.color == null || params.color === '') {
              target.color = null;
            } else if (isHexColor(params.color)) {
              target.color = params.color.trim().toUpperCase();
            } else {
              return Promise.reject({ code: 'INVALID_COLOR' });
            }
          }
          target.updated_at = Date.now();
          syncFixture();
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
          syncFixture();
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
          syncFixture();
          return Promise.resolve({ ...target });
        }
        case 'db_get_health_report':
          return Promise.resolve({ ...dbHealth });
        case 'db_recheck':
          dbHealth.generated_at = new Date().toISOString();
          syncFixture();
          return Promise.resolve({ ...dbHealth });
        case 'categories_list':
          return Promise.resolve([]);
        case 'about_metadata':
          return Promise.resolve({ appVersion: '1.0.0-test', commitHash: 'test-commit' });
        case 'diagnostics_summary':
          return Promise.resolve({
            platform: 'test-platform',
            arch: 'x86_64',
            appVersion: '1.0.0-test',
            commitHash: 'test-commit',
            rustLog: undefined,
            rustLogSource: undefined,
            logPath: '/tmp/app.log',
            logAvailable: false,
            logTail: [],
            logTruncated: false,
            logLinesReturned: 0,
          });
        case 'file_move': {
          const maintenance = getFixture().maintenance ?? {};
          const move = maintenance.move ?? {};
          if (move.errorCode) {
            return Promise.reject({ code: move.errorCode });
          }
          const moved = typeof move.moved === 'number' ? move.moved : 1;
          const renamed = Boolean(move.renamed);
          return Promise.resolve({ moved, renamed });
        }
        case 'attachments_repair': {
          const cancel = Boolean(args?.cancel);
          const mode = args?.mode ?? 'scan';
          if (cancel) {
            const fixture = getFixture();
            const maintenance = fixture.maintenance ?? {};
            const existingRepair = maintenance.repair ?? {};
            const updatedRepair = { ...existingRepair, cancelled: true };
            maintenance.repair = updatedRepair;
            window.__ARKLOWDUN_FIXTURE__ = { ...fixture, maintenance };
            return Promise.resolve({ scanned: 0, missing: 0, repaired: 0, cancelled: true });
          }

          const computeResult = () => {
            const fixture = getFixture();
            const maintenance = fixture.maintenance ?? {};
            const repair = maintenance.repair ?? {};
            const scanned =
              typeof repair.scanned === 'number' && Number.isFinite(repair.scanned)
                ? repair.scanned
                : 5;
            const cancelled = Boolean(repair.cancelled);
            const missing =
              typeof repair.missing === 'number' && Number.isFinite(repair.missing)
                ? repair.missing
                : cancelled
                ? 0
                : 2;
            const repaired =
              mode === 'apply'
                ? typeof repair.repaired === 'number' && Number.isFinite(repair.repaired)
                  ? repair.repaired
                  : cancelled
                  ? 0
                  : 2
                : 0;
            return { scanned, missing, repaired, cancelled };
          };

          const repairState = (getFixture().maintenance ?? {}).repair ?? {};
          const delay =
            typeof repairState.delayMs === 'number' && Number.isFinite(repairState.delayMs)
              ? repairState.delayMs
              : 0;
          if (delay > 0) {
            return new Promise((resolve) => {
              setTimeout(() => resolve(computeResult()), delay);
            });
          }

          return Promise.resolve(computeResult());
        }
        case 'attachments_repair_manifest_export':
          return Promise.resolve('/tmp/missing.csv');
        case 'open_diagnostics_doc':
          return Promise.resolve();
        case 'diagnostics_doc_path':
          return Promise.resolve('/tmp/diagnostics.md');
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
