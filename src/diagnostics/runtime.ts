const DIAGNOSTICS_FILE = "diagnostics.json";

export type DiagnosticsSection = Record<string, unknown>;
type DiagnosticsSnapshot = Record<string, DiagnosticsSection>;

type SafeFsModule = typeof import("../files/safe-fs");

let fsModulePromise: Promise<SafeFsModule | null> | null = null;
let filePersistenceDisabled = false;
let memorySnapshot: DiagnosticsSnapshot = {};
let cachedSnapshot: DiagnosticsSnapshot | null = null;
let writeQueue: Promise<void> = Promise.resolve();
const localCounters = new Map<string, Map<string, number>>();

async function importSafeFs(): Promise<SafeFsModule | null> {
  if (filePersistenceDisabled) return null;
  if (!fsModulePromise) {
    fsModulePromise = import("../files/safe-fs")
      .then((mod) => mod)
      .catch((error) => {
        console.warn(
          "diagnostics: file persistence unavailable; falling back to memory",
          error,
        );
        return null;
      });
  }
  return fsModulePromise;
}

function cloneSnapshot(snapshot: DiagnosticsSnapshot): DiagnosticsSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as DiagnosticsSnapshot;
}

function cloneSection(section: DiagnosticsSection): DiagnosticsSection {
  return JSON.parse(JSON.stringify(section)) as DiagnosticsSection;
}

function normalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalise(item));
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      const entries = Object.entries(value as Record<string, unknown>).sort(
        ([a], [b]) => a.localeCompare(b),
      );
      const ordered: Record<string, unknown> = {};
      for (const [key, entryValue] of entries) {
        ordered[key] = normalise(entryValue);
      }
      return ordered;
    }
  }
  return value;
}

function snapshotsEqual(a: DiagnosticsSnapshot, b: DiagnosticsSnapshot): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

async function readSnapshotFromDisk(fs: SafeFsModule): Promise<DiagnosticsSnapshot> {
  try {
    const exists = await fs.exists(DIAGNOSTICS_FILE, "appData");
    if (!exists) {
      return {};
    }
    const raw = await fs.readText(DIAGNOSTICS_FILE, "appData");
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as DiagnosticsSnapshot;
  } catch (error) {
    console.warn(
      "diagnostics: failed to read snapshot from disk; disabling file persistence",
      error,
    );
    filePersistenceDisabled = true;
    return cloneSnapshot(memorySnapshot);
  }
}

async function loadSnapshot(): Promise<DiagnosticsSnapshot> {
  if (cachedSnapshot) {
    return cloneSnapshot(cachedSnapshot);
  }
  const fs = await importSafeFs();
  if (!fs) {
    cachedSnapshot = cloneSnapshot(memorySnapshot);
    return cloneSnapshot(memorySnapshot);
  }
  const snapshot = await readSnapshotFromDisk(fs);
  cachedSnapshot = cloneSnapshot(snapshot);
  memorySnapshot = cloneSnapshot(snapshot);
  return cloneSnapshot(snapshot);
}

async function persistSnapshot(snapshot: DiagnosticsSnapshot): Promise<void> {
  const fs = await importSafeFs();
  const next = cloneSnapshot(snapshot);
  cachedSnapshot = cloneSnapshot(next);
  memorySnapshot = cloneSnapshot(next);
  if (!fs) return;
  try {
    const text = JSON.stringify(next, null, 2);
    await fs.writeText(DIAGNOSTICS_FILE, "appData", `${text}\n`);
  } catch (error) {
    console.warn(
      "diagnostics: failed to persist snapshot to disk; disabling file persistence",
      error,
    );
    filePersistenceDisabled = true;
  }
}

export async function getDiagnosticsSection(
  section: string,
): Promise<DiagnosticsSection | undefined> {
  const snapshot = await loadSnapshot();
  const current = snapshot[section];
  return current ? cloneSection(current as DiagnosticsSection) : undefined;
}

async function enqueueUpdate(
  section: string,
  payload: DiagnosticsSection,
): Promise<void> {
  const current = await loadSnapshot();
  const previousSection = current[section]
    ? cloneSection(current[section] as DiagnosticsSection)
    : {};
  const nextSection = {
    ...(previousSection as DiagnosticsSection),
    ...cloneSection(payload),
  };
  const nextSnapshot: DiagnosticsSnapshot = {
    ...current,
    [section]: nextSection,
  };
  if (snapshotsEqual(current, nextSnapshot)) {
    return;
  }
  await persistSnapshot(nextSnapshot);
}

export function updateDiagnosticsSection(
  section: string,
  payload: DiagnosticsSection,
): void {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => enqueueUpdate(section, payload));
  writeQueue.catch((error) => {
    console.error("diagnostics: failed to update section", error);
  });
}

export function incrementDiagnosticsCounter(
  section: string,
  key: string,
  amount = 1,
): void {
  const existingSection = localCounters.get(section) ?? new Map<string, number>();
  const currentValue = existingSection.get(key) ?? 0;
  const nextValue = currentValue + amount;
  existingSection.set(key, nextValue);
  localCounters.set(section, existingSection);
  updateDiagnosticsSection(section, { [key]: nextValue });
}

export const __testing = {
  async waitForIdle(): Promise<void> {
    await writeQueue.catch(() => undefined);
  },
  getSnapshot(): DiagnosticsSnapshot {
    return cloneSnapshot(memorySnapshot);
  },
  reset(): void {
    memorySnapshot = {};
    cachedSnapshot = null;
    fsModulePromise = null;
    filePersistenceDisabled = false;
    writeQueue = Promise.resolve();
    localCounters.clear();
  },
  disableFilePersistence(): void {
    filePersistenceDisabled = true;
  },
};
