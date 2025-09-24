import { copyText } from "../api/clipboard";
import { toast } from "@ui/Toast";
import createButton from "@ui/Button";
import type { AppError } from "@bindings/AppError";
import {
  createBackup,
  fetchBackupOverview,
  revealBackup,
  revealBackupFolder,
} from "../api/backups";
import type { BackupEntry, BackupOverview } from "../index";

export interface BackupViewInstance {
  element: HTMLElement;
  refresh: () => Promise<void>;
  destroy: () => void;
}

interface ViewState {
  overview: BackupOverview | null;
  loading: boolean;
  creating: boolean;
  errorMessage: string | null;
}

const DEFAULT_HELPER_TEXT =
  "Create a verified snapshot of the database. The five most recent backups are kept automatically.";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "0 MB";
  if (bytes <= 0) return "0 MB";
  const units = ["bytes", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  if (unitIndex === 0) return `${Math.round(value)} bytes`;
  if (value < 10) return `${value.toFixed(1)} ${units[unitIndex]}`;
  return `${Math.round(value)} ${units[unitIndex]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function describeError(error: unknown): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const record = error as Partial<AppError>;
    if (record.code === "DB_BACKUP/LOW_DISK" && record.message) {
      return record.message;
    }
    if (record.code === "IO/EACCES" || record.code === "IO/ACCESS") {
      return "Permission denied writing to backups folder.";
    }
    if (record.message) return record.message;
  }
  return JSON.stringify(error);
}

async function copyPath(path: string): Promise<void> {
  try {
    await copyText(path);
    toast.show({ kind: "info", message: "Backup path copied to clipboard." });
  } catch (error) {
    toast.show({
      kind: "error",
      message: describeError(error) || "Failed to copy path",
    });
  }
}

function renderEmpty(list: HTMLElement): void {
  list.textContent = "";
  const empty = document.createElement("li");
  empty.className = "backups__empty";
  empty.textContent = "No backups yet.";
  list.appendChild(empty);
}

function renderEntries(list: HTMLElement, entries: BackupEntry[]): void {
  list.textContent = "";
  if (entries.length === 0) {
    renderEmpty(list);
    return;
  }
  for (const entry of entries) {
    const item = document.createElement("li");
    item.className = "backups__item";

    const details = document.createElement("div");
    details.className = "backups__details";

    const title = document.createElement("span");
    title.className = "backups__title";
    title.textContent = formatDate(entry.manifest.created_at);

    const size = document.createElement("span");
    size.className = "backups__size";
    size.textContent = formatBytes(entry.manifest.db_size_bytes);

    details.append(title, size);

    const actions = document.createElement("div");
    actions.className = "backups__item-actions";

    const revealButton = createButton({
      label: "Reveal",
      variant: "ghost",
      size: "sm",
      className: "backups__reveal",
    });
    revealButton.addEventListener("click", (event) => {
      event.preventDefault();
      void revealBackup(entry.sqlite_path).catch((error) => {
        toast.show({ kind: "error", message: describeError(error) });
      });
    });

    actions.append(revealButton);
    item.append(details, actions);
    list.appendChild(item);
  }
}

export function createBackupView(): BackupViewInstance {
  const section = document.createElement("section");
  section.className = "card settings__section settings__section--backups";
  section.setAttribute("aria-labelledby", "settings-backups");

  const heading = document.createElement("h3");
  heading.id = "settings-backups";
  heading.textContent = "Backups";

  const openFolderBtn = createButton({
    label: "Open backups folder",
    variant: "ghost",
    size: "sm",
    className: "backups__open-folder",
  });
  openFolderBtn.addEventListener("click", (event) => {
    event.preventDefault();
    void revealBackupFolder().catch((error) => {
      toast.show({ kind: "error", message: describeError(error) });
    });
  });

  const header = document.createElement("div");
  header.className = "backups__header";
  header.append(heading, openFolderBtn);

  const helper = document.createElement("p");
  helper.className = "settings__helper backups__helper";
  helper.textContent = DEFAULT_HELPER_TEXT;

  const controls = document.createElement("div");
  controls.className = "backups__controls";

  const createBtn = createButton({
    label: "Create Backup",
    variant: "primary",
    className: "backups__create",
  });

  controls.append(createBtn);

  const space = document.createElement("p");
  space.className = "backups__space";

  const status = document.createElement("p");
  status.className = "backups__status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const list = document.createElement("ul");
  list.className = "backups__list";
  renderEmpty(list);

  section.append(header, helper, controls, space, status, list);

  const state: ViewState = {
    overview: null,
    loading: false,
    creating: false,
    errorMessage: null,
  };

  function syncHelper(): void {
    const retention = state.overview?.retention_max_count;
    if (typeof retention === "number" && retention > 0) {
      const suffix =
        retention === 1
          ? "The last snapshot is kept automatically."
          : `The last ${retention} snapshots are kept automatically.`;
      helper.textContent = `Create a verified snapshot of the database. ${suffix}`;
    } else {
      helper.textContent = DEFAULT_HELPER_TEXT;
    }
  }

  function syncStatus(): void {
    if (state.errorMessage) {
      status.textContent = state.errorMessage;
      status.classList.add("backups__status--error");
    } else if (state.creating) {
      status.textContent = "Creating backup…";
      status.classList.remove("backups__status--error");
    } else {
      status.textContent = "";
      status.classList.remove("backups__status--error");
    }
  }

  function syncButton(): void {
    const overview = state.overview;
    const available = overview?.available_bytes ?? 0;
    const required = overview?.required_free_bytes ?? Number.POSITIVE_INFINITY;
    const enoughSpace = overview ? available >= required : false;
    const label = state.creating ? "Creating…" : "Create Backup";
    const disabled =
      state.loading ||
      state.creating ||
      !overview ||
      !enoughSpace;
    createBtn.update({ label, disabled });
  }

  function syncSpace(): void {
    const overview = state.overview;
    if (!overview) {
      space.textContent = "";
      space.classList.remove("backups__space--warning");
      return;
    }
    const availableText = formatBytes(overview.available_bytes);
    const requiredText = formatBytes(overview.required_free_bytes);
    const retention = overview.retention_max_count;
    const notEnough = overview.available_bytes < overview.required_free_bytes;
    const warning = notEnough ? " · Not enough free space for a backup." : "";
    space.textContent = `Available: ${availableText} · Estimated required: ${requiredText} · Retention: last ${retention} snapshots${warning}`;
    space.classList.toggle("backups__space--warning", notEnough);
  }

  async function refresh(): Promise<void> {
    state.loading = true;
    state.errorMessage = null;
    syncStatus();
    syncButton();
    try {
      const overview = await fetchBackupOverview();
      state.overview = overview;
      renderEntries(list, overview.backups);
    } catch (error) {
      state.errorMessage = describeError(error);
      state.overview = null;
      renderEmpty(list);
    } finally {
      state.loading = false;
      syncHelper();
      syncSpace();
      syncButton();
      syncStatus();
    }
  }

  async function handleCreate(): Promise<void> {
    if (state.creating || state.loading) return;
    state.creating = true;
    state.errorMessage = null;
    syncStatus();
    syncButton();
    try {
      const entry = await createBackup();
      const sizeLabel = formatBytes(entry.manifest.db_size_bytes);
      toast.show({
        kind: "success",
        message: `Backup created (${sizeLabel})`,
        actions: [
          {
            label: "Reveal",
            onSelect: () => revealBackup(entry.sqlite_path).catch((error) => {
              toast.show({ kind: "error", message: describeError(error) });
            }),
          },
          {
            label: "Copy path",
            onSelect: () => copyPath(entry.sqlite_path),
          },
        ],
      });
      await refresh();
    } catch (error) {
      state.errorMessage = describeError(error);
      syncStatus();
      toast.show({ kind: "error", message: state.errorMessage });
    } finally {
      state.creating = false;
      syncButton();
      syncStatus();
    }
  }

  createBtn.addEventListener("click", (event) => {
    event.preventDefault();
    void handleCreate();
  });

  void refresh();

  return {
    element: section,
    refresh,
    destroy: () => {
      section.replaceChildren();
    },
  };
}

export default createBackupView;
