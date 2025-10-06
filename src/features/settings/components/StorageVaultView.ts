import { listen } from "@tauri-apps/api/event";

import { call } from "@lib/ipc/call";

import createButton from "@ui/Button";
import toast from "@ui/Toast";

import {
  fetchMigrationStatus,
  runMigration,
  resumeMigration,
  type MigrationMode,
  type MigrationProgress,
} from "../api/vaultMigration";

export const vaultMigrationUiEnabled =
  (import.meta.env.VITE_VAULT_MIGRATION_UI ?? "true") !== "false";

interface StorageVaultViewInstance {
  element: HTMLElement;
  destroy: () => void;
}

const EVENT_PROGRESS = "vault:migration_progress";
const EVENT_COMPLETE = "vault:migration_complete";

const MODE_LABEL: Record<MigrationMode, string> = {
  dry_run: "Dry-run",
  apply: "Apply",
};

const MODE_STATUS: Record<MigrationMode, string> = {
  dry_run: "Dry-run running",
  apply: "Applying migration",
};

function formatCounts(counts: MigrationProgress["counts"]): string {
  return `Processed ${counts.processed} · Copied ${counts.copied} · Conflicts ${counts.conflicts} · Skipped ${counts.skipped} · Unsupported ${counts.unsupported}`;
}

export function createStorageVaultView(): StorageVaultViewInstance {
  const section = document.createElement("section");
  section.className = "card settings__section settings__section--storage";
  section.setAttribute("aria-labelledby", "settings-storage");

  const heading = document.createElement("h3");
  heading.id = "settings-storage";
  heading.textContent = "Storage vault";

  const helper = document.createElement("p");
  helper.className = "settings__helper";
  helper.textContent =
    "Run the attachment vault migration to relocate legacy files into household/category folders.";

  const statusBadge = document.createElement("span");
  statusBadge.className = "storage__vault-status";

  const statusWrapper = document.createElement("div");
  statusWrapper.className = "storage__vault-header";
  statusWrapper.append(heading, statusBadge);

  const summary = document.createElement("p");
  summary.className = "storage__vault-summary";

  const progressBar = document.createElement("progress");
  progressBar.className = "storage__vault-progress";
  progressBar.max = 1;
  progressBar.value = 0;
  progressBar.hidden = true;

  const progressNote = document.createElement("p");
  progressNote.className = "storage__vault-progress-note";
  progressNote.hidden = true;

  const manifestLink = createButton({
    label: "Open manifest",
    variant: "ghost",
    size: "sm",
    className: "storage__vault-manifest",
    disabled: true,
  });
  manifestLink.hidden = true;

  manifestLink.addEventListener("click", (event) => {
    event.preventDefault();
    if (!state.latest?.manifest_path) return;
    void call("open_path", { path: state.latest.manifest_path }).catch((error: unknown) => {
      const message = (error as { message?: string })?.message ?? "Unable to open manifest.";
      toast.show({ kind: "error", message });
    });
  });

  const dryRunButton = createButton({
    label: "Dry run",
    variant: "ghost",
    className: "storage__vault-dryrun",
  });

  const applyButton = createButton({
    label: "Apply migration",
    variant: "primary",
    className: "storage__vault-apply",
  });

  const resumeButton = createButton({
    label: "Resume migration",
    variant: "primary",
    className: "storage__vault-resume",
  });
  resumeButton.hidden = true;

  const controls = document.createElement("div");
  controls.className = "storage__vault-controls";
  controls.append(dryRunButton, applyButton, resumeButton, manifestLink);

  const state: {
    running: boolean;
    mode: MigrationMode | null;
    latest: MigrationProgress | null;
    unlisten: Array<() => void | Promise<void>>;
  } = {
    running: false,
    mode: null,
    latest: null,
    unlisten: [],
  };

  function updateUi(): void {
    const status = state.latest;
    const running = state.running;
    const hasCheckpoint = Boolean(status?.checkpoint_path);

    dryRunButton.update({ disabled: running });
    applyButton.update({ disabled: running });
    resumeButton.update({ disabled: running || !hasCheckpoint });
    resumeButton.hidden = !hasCheckpoint;

    const activeMode: MigrationMode | null = state.mode ?? status?.mode ?? null;
    if (running && activeMode) {
      statusBadge.textContent = `${MODE_LABEL[activeMode]} in progress…`;
      statusBadge.dataset.status = "pending";
    } else if (status?.completed) {
      statusBadge.textContent = "Vault: configured";
      statusBadge.dataset.status = "success";
    } else if (hasCheckpoint) {
      statusBadge.textContent = "Migration paused";
      statusBadge.dataset.status = "warning";
    } else {
      statusBadge.textContent = "Vault: pending migration";
      statusBadge.dataset.status = "warning";
    }

    if (status) {
      summary.textContent = formatCounts(status.counts);
      if (hasCheckpoint && !running) {
        summary.textContent += " · Resume available";
      }
    } else {
      summary.textContent = "No migration has been executed yet.";
    }

    if (running && status) {
      progressBar.hidden = false;
      progressBar.value = Math.min(1, Math.max(0, status.counts.processed % 1000 / 1000));
      progressNote.hidden = false;
      const table = status.table ? `Current table: ${status.table}` : "";
      const mode = state.mode ?? status.mode;
      const message = mode ? MODE_STATUS[mode] : "Migration running";
      progressNote.textContent = `${message}. ${table}`.trim();
    } else if (!running && hasCheckpoint) {
      progressBar.hidden = true;
      progressNote.hidden = false;
      progressNote.textContent = "Migration paused. Resume available from last checkpoint.";
    } else {
      progressBar.hidden = true;
      progressNote.hidden = true;
      progressNote.textContent = "";
    }

    if (status?.manifest_path) {
      manifestLink.update({ disabled: false });
      manifestLink.hidden = false;
    } else {
      manifestLink.update({ disabled: true });
      manifestLink.hidden = true;
    }
  }

  async function refreshStatus(): Promise<void> {
    try {
      state.latest = await fetchMigrationStatus();
    } catch (error) {
      const message = (error as { message?: string })?.message ?? "Unable to load vault status.";
      toast.show({ kind: "error", message });
    }
    updateUi();
  }

  async function run(mode: MigrationMode): Promise<void> {
    if (state.running) return;
    state.running = true;
    state.mode = mode;
    updateUi();
    try {
      await runMigration(mode);
      toast.show({
        kind: "success",
        message: mode === "dry_run" ? "Dry-run complete." : "Migration finished.",
      });
    } catch (error) {
      const message = (error as { message?: string })?.message ?? "Migration failed.";
      toast.show({ kind: "error", message });
    } finally {
      state.running = false;
      state.mode = null;
      await refreshStatus();
    }
  }

  async function resume(): Promise<void> {
    if (state.running) return;
    state.running = true;
    state.mode = state.latest?.mode ?? null;
    updateUi();
    try {
      await resumeMigration();
      toast.show({
        kind: "success",
        message: "Migration resumed.",
      });
    } catch (error) {
      const message = (error as { message?: string })?.message ?? "Unable to resume migration.";
      toast.show({ kind: "error", message });
    } finally {
      state.running = false;
      state.mode = null;
      await refreshStatus();
    }
  }

  dryRunButton.addEventListener("click", (event) => {
    event.preventDefault();
    void run("dry_run");
  });

  applyButton.addEventListener("click", (event) => {
    event.preventDefault();
    void run("apply");
  });

  resumeButton.addEventListener("click", (event) => {
    event.preventDefault();
    void resume();
  });

  void refreshStatus();

  void listen<MigrationProgress>(EVENT_PROGRESS, (event) => {
    const payload = event.payload;
    if (!payload) return;
    state.latest = payload;
    if (state.running && payload.completed) {
      state.running = false;
      state.mode = null;
    }
    updateUi();
  }).then((unlisten) => {
    state.unlisten.push(unlisten);
  });

  void listen<MigrationProgress>(EVENT_COMPLETE, (event) => {
    const payload = event.payload;
    if (!payload) return;
    state.latest = payload;
    state.running = false;
    state.mode = null;
    updateUi();
  }).then((unlisten) => {
    state.unlisten.push(unlisten);
  });

  section.append(statusWrapper, helper, controls, progressBar, progressNote, summary);

  return {
    element: section,
    destroy: () => {
      for (const unlisten of state.unlisten) {
        void unlisten();
      }
      state.unlisten = [];
    },
  };
}

export default createStorageVaultView;
