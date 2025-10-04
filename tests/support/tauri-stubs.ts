export const settingsInitStub = `(() => {
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
  const dbHealth = {
    status: 'ok',
    checks: [],
    offenders: [],
    schema_hash: 'test-schema',
    app_version: '1.0.0-test',
    generated_at: new Date().toISOString(),
  };

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
        case 'db_get_health_report':
          return Promise.resolve({ ...dbHealth });
        case 'db_recheck':
          dbHealth.generated_at = new Date().toISOString();
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
