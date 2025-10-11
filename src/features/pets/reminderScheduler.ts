import {
  isPermissionGranted as defaultIsPermissionGranted,
  requestPermission as defaultRequestPermission,
  sendNotification as defaultSendNotification,
} from "@lib/ipc/notification";
import { logUI as defaultLogUI } from "@lib/uiLog";

import { updateDiagnosticsSection } from "../../diagnostics/runtime";

export type ReminderKey = `${string}:${string}`;

export interface SchedulerStats {
  activeTimers: number;
  buckets: number;
  queueDepth: number;
}

type ReminderRecord = {
  medical_id: string;
  pet_id: string;
  date: string;
  reminder_at: string;
  description: string;
  pet_name?: string;
};

type ScheduleOptions = {
  householdId: string;
  petNames?: Record<string, string | undefined>;
};

type ScheduleBatch = {
  records: ReminderRecord[];
  opts: ScheduleOptions;
};

const MAX_TIMEOUT = 2_147_483_647;

type ReminderDependencies = {
  isPermissionGranted: typeof defaultIsPermissionGranted;
  requestPermission: typeof defaultRequestPermission;
  sendNotification: typeof defaultSendNotification;
  logUI: typeof defaultLogUI;
};

let deps: ReminderDependencies = {
  isPermissionGranted: defaultIsPermissionGranted,
  requestPermission: defaultRequestPermission,
  sendNotification: defaultSendNotification,
  logUI: defaultLogUI,
};

const registry = new Map<ReminderKey, ReturnType<typeof setTimeout>>();
const keyToPet = new Map<ReminderKey, string>();
const petToKeys = new Map<string, Set<ReminderKey>>();
const catchupKeys = new Set<ReminderKey>();
const knownPetNames = new Map<string, string>();

let pendingBatches: ScheduleBatch[] = [];
let pendingProcessing: Promise<void> | null = null;
let permissionState: "unknown" | "granted" | "denied" = "unknown";
let permissionRequest: Promise<"granted" | "denied"> | null = null;
let permissionDeniedLogged = false;
let currentHouseholdId: string | null = null;

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function buildKey(record: Pick<ReminderRecord, "medical_id" | "reminder_at">): ReminderKey {
  return `${record.medical_id}:${record.reminder_at}`;
}

function ensurePetMap(petId: string): Set<ReminderKey> {
  let keys = petToKeys.get(petId);
  if (!keys) {
    keys = new Set();
    petToKeys.set(petId, keys);
  }
  return keys;
}

function trackKey(record: ReminderRecord, key: ReminderKey): void {
  keyToPet.set(key, record.pet_id);
  ensurePetMap(record.pet_id).add(key);
}

function untrackKey(key: ReminderKey): void {
  const petId = keyToPet.get(key);
  if (petId) {
    const bucket = petToKeys.get(petId);
    if (bucket) {
      bucket.delete(key);
      if (bucket.size === 0) {
        petToKeys.delete(petId);
      }
    }
  }
  keyToPet.delete(key);
}

function cancelKey(key: ReminderKey): void {
  const handle = registry.get(key);
  if (handle !== undefined) {
    clearTimeout(handle);
    registry.delete(key);
    untrackKey(key);
    deps.logUI("INFO", "ui.pets.reminder_canceled", {
      key,
      household_id: currentHouseholdId ?? undefined,
    });
  }
}

function parseReminder(reminderAt: string): number | null {
  const ts = Date.parse(reminderAt);
  return Number.isFinite(ts) ? ts : null;
}

function parseEventDate(dateStr: string): number | null {
  const ts = Date.parse(dateStr);
  return Number.isFinite(ts) ? ts : null;
}

function formatEventDate(dateStr: string): string {
  const parsed = parseEventDate(dateStr);
  if (parsed === null) return dateStr;
  return new Date(parsed).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function resolvePetName(record: ReminderRecord): string {
  if (record.pet_name && record.pet_name.trim().length > 0) {
    return record.pet_name;
  }
  const cached = knownPetNames.get(record.pet_id);
  if (cached && cached.trim().length > 0) {
    return cached;
  }
  return "Pet";
}

function logPermissionDenied(): void {
  if (permissionDeniedLogged) return;
  permissionDeniedLogged = true;
  deps.logUI("WARN", "ui.pets.reminder_permission_denied", {
    household_id: currentHouseholdId ?? undefined,
  });
}

async function ensurePermission(): Promise<"granted" | "denied"> {
  if (permissionState !== "unknown") {
    if (permissionState === "denied") logPermissionDenied();
    return permissionState;
  }
  if (permissionRequest) {
    const state = await permissionRequest;
    if (state === "denied") logPermissionDenied();
    return state;
  }
  permissionRequest = (async () => {
    let granted = await deps.isPermissionGranted();
    if (!granted) {
      const result = await deps.requestPermission();
      granted = result === "granted";
    }
    permissionState = granted ? "granted" : "denied";
    if (!granted) {
      logPermissionDenied();
    }
    return permissionState;
  })();

  try {
    return await permissionRequest;
  } finally {
    permissionRequest = null;
  }
}

function scheduleNotification(record: ReminderRecord, reminderAtMs: number, key: ReminderKey): void {
  const start = now();
  const title = `Reminder: ${resolvePetName(record)} medical due`;
  const body = `${record.description} (${formatEventDate(record.date)})`;
  void deps.sendNotification({
    title,
    body,
    tag: `pets:${record.medical_id}`,
    silent: false,
  });
  deps.logUI("INFO", "ui.pets.reminder_fired", {
    key,
    pet_id: record.pet_id,
    medical_id: record.medical_id,
    reminder_at: record.reminder_at,
    elapsed_ms: Math.max(0, Date.now() - reminderAtMs),
    household_id: currentHouseholdId ?? undefined,
  });
  deps.logUI("INFO", "perf.pets.timing", {
    name: "reminders.fire",
    duration_ms: Math.max(0, Math.round(now() - start)),
    ok: true,
    pet_id: record.pet_id,
    medical_id: record.medical_id,
    household_id: currentHouseholdId ?? undefined,
  });
}

function processCatchup(record: ReminderRecord, key: ReminderKey, reminderAtMs: number): void {
  if (catchupKeys.has(key)) {
    return;
  }
  catchupKeys.add(key);
  scheduleNotification(record, reminderAtMs, key);
  deps.logUI("INFO", "ui.pets.reminder_catchup", {
    key,
    pet_id: record.pet_id,
    medical_id: record.medical_id,
    reminder_at: record.reminder_at,
    household_id: currentHouseholdId ?? undefined,
  });
}

function scheduleAt(record: ReminderRecord, key: ReminderKey, reminderAtMs: number, now: number): void {
  const delay = Math.max(0, reminderAtMs - now);
  const nextDelay = Math.min(delay, MAX_TIMEOUT);

  const handle = setTimeout(() => {
    if (delay > MAX_TIMEOUT) {
      deps.logUI("DEBUG", "ui.pets.reminder_chained", {
        key,
        remaining_ms: Math.max(0, reminderAtMs - Date.now()),
        household_id: currentHouseholdId ?? undefined,
      });
      scheduleAt(record, key, reminderAtMs, Date.now());
      return;
    }
    try {
      scheduleNotification(record, reminderAtMs, key);
    } finally {
      registry.delete(key);
      untrackKey(key);
      publishDiagnostics();
    }
  }, nextDelay);

  const existing = registry.get(key);
  if (existing !== undefined) {
    clearTimeout(existing);
  }
  registry.set(key, handle);
  trackKey(record, key);
  publishDiagnostics();
}

function scheduleRecord(record: ReminderRecord): void {
  const key = buildKey(record);
  if (registry.has(key)) {
    return;
  }
  const reminderAtMs = parseReminder(record.reminder_at);
  if (reminderAtMs === null) {
    deps.logUI("WARN", "ui.pets.reminder_invalid", {
      key,
      reason: "invalid_reminder_at",
      reminder_at: record.reminder_at,
      household_id: currentHouseholdId ?? undefined,
    });
    return;
  }

  const now = Date.now();
  if (reminderAtMs <= now) {
    const eventDateMs = parseEventDate(record.date);
    if (eventDateMs !== null) {
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      if (eventDateMs >= today.getTime()) {
        processCatchup(record, key, reminderAtMs);
        return;
      }
    }
    // Reminder is in the past and not eligible for catch-up; treat as fired.
    catchupKeys.add(key);
    return;
  }

  deps.logUI("INFO", "ui.pets.reminder_scheduled", {
    key,
    pet_id: record.pet_id,
    medical_id: record.medical_id,
    reminder_at: record.reminder_at,
    delay_ms: Math.max(0, reminderAtMs - now),
    household_id: currentHouseholdId ?? undefined,
  });

  scheduleAt(record, key, reminderAtMs, now);
}

function processQueue(): void {
  const batches = pendingBatches;
  pendingBatches = [];
  for (const batch of batches) {
    currentHouseholdId = batch.opts.householdId;
    if (batch.opts.petNames) {
      for (const [petId, name] of Object.entries(batch.opts.petNames)) {
        if (typeof name === "string" && name.trim().length > 0) {
          knownPetNames.set(petId, name);
        }
      }
    }
    for (const record of batch.records) {
      scheduleRecord(record);
    }
  }
}

function triggerProcessing(): void {
  if (pendingProcessing) {
    return;
  }
  pendingProcessing = (async () => {
    const permission = await ensurePermission();
    if (permission === "denied") {
      pendingBatches = [];
      return;
    }
    processQueue();
  })()
    .catch((error) => {
      console.error("reminderScheduler processing failed", error);
    })
    .finally(() => {
      pendingProcessing = null;
    });
}

export const reminderScheduler = {
  init(): void {
    reminderScheduler.cancelAll();
    pendingBatches = [];
  },
  scheduleMany(records: ReminderRecord[], opts: ScheduleOptions): void {
    const start = now();
    let ok = true;
    try {
      if (!records.length) {
        // Still ensure permission cache is populated for future calls.
        if (permissionState === "unknown") {
          pendingBatches.push({ records: [], opts });
          triggerProcessing();
        }
        if (opts.petNames) {
          for (const [petId, name] of Object.entries(opts.petNames)) {
            if (typeof name === "string" && name.trim().length > 0) {
              knownPetNames.set(petId, name);
            }
          }
        }
        currentHouseholdId = opts.householdId;
        return;
      }

      pendingBatches.push({ records: [...records], opts });
      if (opts.petNames) {
        for (const [petId, name] of Object.entries(opts.petNames)) {
          if (typeof name === "string" && name.trim().length > 0) {
            knownPetNames.set(petId, name);
          }
        }
      }
      currentHouseholdId = opts.householdId;
      triggerProcessing();
    } catch (error) {
      ok = false;
      throw error;
    } finally {
      const duration = Math.max(0, Math.round(now() - start));
      const stats = reminderScheduler.stats();
      deps.logUI("INFO", "perf.pets.timing", {
        name: "reminders.schedule_many",
        duration_ms: duration,
        ok,
        scheduled: records.length,
        household_id: opts.householdId,
        queue_depth: stats.queueDepth,
      });
    }
  },
  rescheduleForPet(petId: string): void {
    const keys = petToKeys.get(petId);
    if (!keys) return;
    for (const key of Array.from(keys)) {
      cancelKey(key);
    }
    petToKeys.delete(petId);
    publishDiagnostics();
  },
  cancelAll(): void {
    const start = now();
    const canceled = registry.size;
    const previousHousehold = currentHouseholdId;
    for (const key of Array.from(registry.keys())) {
      cancelKey(key);
    }
    keyToPet.clear();
    petToKeys.clear();
    pendingBatches = [];
    pendingProcessing = null;
    currentHouseholdId = null;
    publishDiagnostics();
    deps.logUI("INFO", "perf.pets.timing", {
      name: "reminders.cancel_all",
      duration_ms: Math.max(0, Math.round(now() - start)),
      ok: true,
      canceled,
      household_id: previousHousehold ?? undefined,
    });
  },
  stats(): SchedulerStats {
    const bucketIds = new Set<string>();
    for (const key of registry.keys()) {
      const [, reminderAt] = key.split(":");
      if (reminderAt) bucketIds.add(reminderAt);
    }
    let queueDepth = registry.size;
    for (const batch of pendingBatches) {
      queueDepth += batch.records.length;
    }
    return {
      activeTimers: registry.size,
      buckets: bucketIds.size,
      queueDepth,
    };
  },
};

function publishDiagnostics(): void {
  const stats = reminderScheduler.stats();
  updateDiagnosticsSection("pets", {
    reminder_active_timers: stats.activeTimers,
    reminder_buckets: stats.buckets,
    reminder_queue_depth: stats.queueDepth,
  });
}

export const __testing = {
  reset(): void {
    deps = {
      ...deps,
      logUI: () => {},
    };
    reminderScheduler.cancelAll();
    catchupKeys.clear();
    knownPetNames.clear();
    permissionState = "unknown";
    permissionRequest = null;
    permissionDeniedLogged = false;
    pendingBatches = [];
    pendingProcessing = null;
    currentHouseholdId = null;
    deps = {
      isPermissionGranted: defaultIsPermissionGranted,
      requestPermission: defaultRequestPermission,
      sendNotification: defaultSendNotification,
      logUI: defaultLogUI,
    };
  },
  setDependencies(overrides: Partial<ReminderDependencies>): void {
    deps = {
      ...deps,
      ...overrides,
    };
  },
  waitForIdle(): Promise<void> {
    return pendingProcessing ?? Promise.resolve();
  },
  getCatchupKeys(): Set<ReminderKey> {
    return catchupKeys;
  },
};
