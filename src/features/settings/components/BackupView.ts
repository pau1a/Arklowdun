import { copyText } from "../api/clipboard";
import { toast } from "@ui/Toast";
import createButton from "@ui/Button";
import type { AppError } from "@bindings/AppError";
import { recoveryText } from "@strings/recovery";
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

const DEFAULT_HELPER_TEXT = recoveryText("db.backup.section.helper");
const numberFormatter = new Intl.NumberFormat();
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return recoveryText("db.backup.format.value_unit", {
      value: numberFormatter.format(0),
      unit: recoveryText("db.backup.units.mb"),
    });
  }
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < 4) {
    value /= 1000;
    unitIndex += 1;
  }
  const unitLabel = (() => {
    switch (unitIndex) {
      case 0:
        return recoveryText("db.backup.units.bytes");
      case 1:
        return recoveryText("db.backup.units.kb");
      case 2:
        return recoveryText("db.backup.units.mb");
      case 3:
        return recoveryText("db.backup.units.gb");
      default:
        return recoveryText("db.backup.units.tb");
    }
  })();
  const formattedValue =
    unitIndex === 0
      ? numberFormatter.format(Math.round(value))
      : value < 10
        ? value.toFixed(1)
        : numberFormatter.format(Math.round(value));
  return recoveryText("db.backup.format.value_unit", {
    value: formattedValue,
    unit: unitLabel,
  });
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function describeError(error: unknown): string {
  if (!error) return recoveryText("db.common.unknown_error");
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const record = error as Partial<AppError>;
    if (record.code === "DB_BACKUP/LOW_DISK") {
      if (record.message) return record.message;
      const context = record.context as Record<string, unknown> | undefined;
      const required = context?.required_bytes ?? context?.required;
      const size =
        typeof required === "number"
          ? formatBytes(Number(required))
          : String(required ?? "");
      if (size && size.trim().length > 0) {
        return recoveryText("db.backup.error.disk", { size });
      }
      return recoveryText("db.backup.error.disk", { size: "?" });
    }
    if (record.code === "IO/EACCES" || record.code === "IO/ACCESS") {
      return recoveryText("db.backup.error.permission");
    }
    if (record.message) return record.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function copyPath(path: string): Promise<void> {
  try {
    await copyText(path);
    toast.show({
      kind: "info",
      message: recoveryText("db.backup.copy.success"),
    });
  } catch (error) {
    toast.show({
      kind: "error",
      message: describeError(error) || recoveryText("db.backup.copy.failure"),
    });
  }
}

function renderEmpty(list: HTMLElement): void {
  list.textContent = "";
  const empty = document.createElement("li");
  empty.className = "backups__empty";
  empty.textContent = recoveryText("db.backup.list.empty");
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
    title.textContent = formatDate(entry.manifest.createdAt);

    const size = document.createElement("span");
    size.className = "backups__size";
    size.textContent = formatBytes(entry.manifest.dbSizeBytes);

    details.append(title, size);

    const actions = document.createElement("div");
    actions.className = "backups__item-actions";

    const revealButton = createButton({
      label: recoveryText("db.common.reveal"),
      variant: "ghost",
      size: "sm",
      className: "backups__reveal",
    });
    revealButton.addEventListener("click", (event) => {
      event.preventDefault();
      void revealBackup(entry.sqlitePath).catch((error) => {
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
  heading.textContent = recoveryText("db.backup.section.title");

  const openFolderBtn = createButton({
    label: recoveryText("db.backup.button.open_folder"),
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
    label: recoveryText("db.backup.button.create"),
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
    const retention = state.overview?.retentionMaxCount;
    if (typeof retention === "number" && retention > 0) {
      const suffix =
        retention === 1
          ? recoveryText("db.backup.section.helper_single")
          : recoveryText("db.backup.section.helper_retained", {
              count: String(retention),
            });
      helper.textContent = `${DEFAULT_HELPER_TEXT} ${suffix}`.trim();
    } else {
      helper.textContent = DEFAULT_HELPER_TEXT;
    }
  }

  function syncStatus(): void {
    if (state.errorMessage) {
      status.textContent = state.errorMessage;
      status.classList.add("backups__status--error");
    } else if (state.creating) {
      status.textContent = recoveryText("db.backup.status.creating");
      status.classList.remove("backups__status--error");
    } else {
      status.textContent = "";
      status.classList.remove("backups__status--error");
    }
  }

  function syncButton(): void {
    const overview = state.overview;
    const available = overview?.availableBytes ?? 0;
    const required =
      overview?.requiredFreeBytes ?? Number.POSITIVE_INFINITY;
    const enoughSpace = overview ? available >= required : false;
    const label = state.creating
      ? recoveryText("db.backup.button.creating")
      : recoveryText("db.backup.button.create");
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
    const availableText = formatBytes(overview.availableBytes);
    const requiredText = formatBytes(overview.requiredFreeBytes);
    const retention = overview.retentionMaxCount;
    const notEnough = overview.availableBytes < overview.requiredFreeBytes;
    const warning = notEnough
      ? recoveryText("db.backup.list.warning_suffix")
      : "";
    space.textContent = recoveryText("db.backup.list.available", {
      available: availableText,
      required: requiredText,
      count: String(retention ?? 0),
      warning,
    });
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
      const sizeLabel = formatBytes(entry.manifest.dbSizeBytes);
      toast.show({
        kind: "success",
        message: recoveryText("db.backup.toast.success", { size: sizeLabel }),
        actions: [
          {
            label: recoveryText("db.backup.toast_actions.reveal"),
            onSelect: () =>
              revealBackup(entry.sqlitePath).catch((error) => {
                toast.show({ kind: "error", message: describeError(error) });
              }),
          },
          {
            label: recoveryText("db.backup.toast_actions.copy_path"),
            onSelect: () => copyPath(entry.sqlitePath),
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
