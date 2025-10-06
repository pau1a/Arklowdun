import { listen } from "@tauri-apps/api/event";

import {
  cancelAttachmentsRepair,
  moveFile,
  runAttachmentsRepair,
} from "@api/fileOps";
import type {
  AttachmentsRepairAction,
  AttachmentsRepairMode,
  ConflictStrategy,
} from "@api/fileOps";
import type { AttachmentCategory } from "@bindings/AttachmentCategory";
import {
  cancelIndexRebuild,
  getIndexStatus,
  rebuildIndex,
  type FilesIndexProgressPayload,
  type FilesIndexStatePayload,
  type IndexStatus as FilesIndexStatus,
} from "@lib/files/indexer";

import createButton from "@ui/Button";
import createInput from "@ui/Input";
import toast from "@ui/Toast";

import {
  fetchMigrationStatus,
  runMigration,
  resumeMigration,
  type MigrationMode,
  type MigrationProgress,
} from "../api/vaultMigration";
import { openPath } from "../api/opener";

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

const ATTACHMENT_CATEGORIES: AttachmentCategory[] = [
  "bills",
  "policies",
  "property_documents",
  "inventory_items",
  "pet_medical",
  "vehicles",
  "vehicle_maintenance",
  "notes",
  "misc",
];

function formatCounts(counts: MigrationProgress["counts"]): string {
  return `Processed ${counts.processed} · Copied ${counts.copied} · Conflicts ${counts.conflicts} · Skipped ${counts.skipped} · Unsupported ${counts.unsupported}`;
}

export function createStorageVaultView(): StorageVaultViewInstance {
  const makeCategorySelect = (placeholder: string): HTMLSelectElement => {
    const select = document.createElement("select");
    select.className = "storage__maintenance-select";
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholder;
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    select.appendChild(placeholderOption);
    for (const category of ATTACHMENT_CATEGORIES) {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category.replace(/_/g, " ");
      select.appendChild(option);
    }
    return select;
  };

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
    void openPath(state.latest.manifest_path).catch((error: unknown) => {
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

  const indexSection = document.createElement("div");
  indexSection.className = "storage__index";

  const indexHeader = document.createElement("div");
  indexHeader.className = "storage__index-header";

  const indexHeading = document.createElement("h4");
  indexHeading.className = "storage__index-title";
  indexHeading.textContent = "Files index";

  const indexStatusBadge = document.createElement("span");
  indexStatusBadge.className = "storage__index-status";

  indexHeader.append(indexHeading, indexStatusBadge);

  const indexSummary = document.createElement("p");
  indexSummary.className = "storage__index-summary";

  const indexProgressBar = document.createElement("progress");
  indexProgressBar.className = "storage__index-progress";
  indexProgressBar.max = 1;
  indexProgressBar.value = 0;
  indexProgressBar.hidden = true;

  const indexProgressNote = document.createElement("p");
  indexProgressNote.className = "storage__index-progress-note";
  indexProgressNote.hidden = true;

  const indexRebuildButton = createButton({
    label: "Rebuild index",
    variant: "primary",
    size: "sm",
    className: "storage__index-rebuild",
  });

  const indexCancelButton = createButton({
    label: "Cancel",
    variant: "ghost",
    size: "sm",
    className: "storage__index-cancel",
    disabled: true,
  });
  indexCancelButton.hidden = true;

  const indexControls = document.createElement("div");
  indexControls.className = "storage__index-controls";
  indexControls.append(indexRebuildButton, indexCancelButton);

  indexSection.append(
    indexHeader,
    indexSummary,
    indexProgressBar,
    indexProgressNote,
    indexControls,
  );

  const maintenanceSection = document.createElement("div");
  maintenanceSection.className = "storage__maintenance";

  const maintenanceHeading = document.createElement("h4");
  maintenanceHeading.className = "storage__maintenance-title";
  maintenanceHeading.textContent = "Maintenance tools";

  const householdField = document.createElement("div");
  householdField.className = "storage__maintenance-field";
  const householdLabel = document.createElement("label");
  householdLabel.className = "storage__maintenance-label";
  householdLabel.textContent = "Household ID";
  const householdInput = createInput({
    id: "storage-maintenance-household",
    placeholder: "Household ID",
    className: "storage__maintenance-input",
  });
  householdLabel.setAttribute("for", "storage-maintenance-household");
  householdField.append(householdLabel, householdInput);

  const moveGroup = document.createElement("div");
  moveGroup.className = "storage__maintenance-group";
  const moveTitle = document.createElement("h5");
  moveTitle.className = "storage__maintenance-heading";
  moveTitle.textContent = "Move or rename";
  const moveFields = document.createElement("div");
  moveFields.className = "storage__maintenance-row";
  const fromCategorySelect = makeCategorySelect("From category");
  const fromRelInput = createInput({
    placeholder: "From relative path",
    className: "storage__maintenance-input",
  });
  const toCategorySelect = makeCategorySelect("To category");
  const toRelInput = createInput({
    placeholder: "To relative path",
    className: "storage__maintenance-input",
  });
  const conflictSelect = document.createElement("select");
  conflictSelect.className = "storage__maintenance-select";
  const renameOption = document.createElement("option");
  renameOption.value = "rename";
  renameOption.textContent = "Rename on conflict";
  const failOption = document.createElement("option");
  failOption.value = "fail";
  failOption.textContent = "Fail on conflict";
  conflictSelect.append(renameOption, failOption);
  conflictSelect.value = "rename";
  const moveActionButton = createButton({
    label: "Move file",
    variant: "primary",
    size: "sm",
    className: "storage__maintenance-action",
  });
  moveFields.append(
    fromCategorySelect,
    fromRelInput,
    toCategorySelect,
    toRelInput,
    conflictSelect,
    moveActionButton,
  );
  const moveStatus = document.createElement("p");
  moveStatus.className = "storage__maintenance-status";
  moveStatus.hidden = true;
  moveGroup.append(moveTitle, moveFields, moveStatus);

  const repairGroup = document.createElement("div");
  repairGroup.className = "storage__maintenance-group";
  const repairTitle = document.createElement("h5");
  repairTitle.className = "storage__maintenance-heading";
  repairTitle.textContent = "Scan & repair";
  const repairControls = document.createElement("div");
  repairControls.className = "storage__maintenance-row";
  const repairScanButton = createButton({
    label: "Scan for missing attachments",
    variant: "ghost",
    size: "sm",
    className: "storage__maintenance-action",
  });
  const repairApplyButton = createButton({
    label: "Apply recorded actions",
    variant: "ghost",
    size: "sm",
    className: "storage__maintenance-action",
  });
  const repairLoadManifestButton = createButton({
    label: "Load manifest",
    variant: "ghost",
    size: "sm",
    className: "storage__maintenance-action",
  });
  const repairCancelButton = createButton({
    label: "Cancel",
    variant: "ghost",
    size: "sm",
    className: "storage__maintenance-action",
    disabled: true,
  });
  const repairProgress = document.createElement("progress");
  repairProgress.className = "storage__maintenance-progress";
  repairProgress.max = 1;
  repairProgress.value = 0;
  repairProgress.hidden = true;
  const repairStatus = document.createElement("p");
  repairStatus.className = "storage__maintenance-status";
  repairStatus.hidden = true;
  const repairManifestInput = document.createElement("input");
  repairManifestInput.type = "file";
  repairManifestInput.accept = ".json";
  repairManifestInput.hidden = true;
  const repairManifestNote = document.createElement("p");
  repairManifestNote.className = "storage__maintenance-note";
  repairManifestNote.hidden = true;
  repairControls.append(
    repairScanButton,
    repairApplyButton,
    repairLoadManifestButton,
    repairCancelButton,
  );
  repairApplyButton.update({ disabled: true });
  repairGroup.append(
    repairTitle,
    repairControls,
    repairProgress,
    repairStatus,
    repairManifestNote,
    repairManifestInput,
  );

  maintenanceSection.append(
    maintenanceHeading,
    householdField,
    moveGroup,
    repairGroup,
  );

  const state: {
    running: boolean;
    mode: MigrationMode | null;
    latest: MigrationProgress | null;
    unlisten: Array<() => void | Promise<void>>;
    index: {
      householdId: string | null;
      status: FilesIndexStatus | null;
      progress: { scanned: number; updated: number; skipped: number };
    };
    maintenance: {
      move: {
        running: boolean;
      };
      repair: {
        running: boolean;
        scanned: number;
        missing: number;
        actions: AttachmentsRepairAction[];
        manifestName: string | null;
      };
    };
  } = {
    running: false,
    mode: null,
    latest: null,
    unlisten: [],
    index: {
      householdId: null,
      status: null,
      progress: { scanned: 0, updated: 0, skipped: 0 },
    },
    maintenance: {
      move: {
        running: false,
      },
      repair: {
        running: false,
        scanned: 0,
        missing: 0,
        actions: [],
        manifestName: null,
      },
    },
  };

  const updateRepairActionsSummary = (): void => {
    const { actions, manifestName } = state.maintenance.repair;
    if (actions.length > 0) {
      const source = manifestName ? ` from ${manifestName}` : "";
      repairManifestNote.hidden = false;
      repairManifestNote.textContent = `Loaded ${actions.length} actions${source}.`;
    } else {
      repairManifestNote.hidden = true;
      repairManifestNote.textContent = "";
    }
    if (!state.maintenance.repair.running) {
      repairApplyButton.update({ disabled: actions.length === 0 });
    }
  };

  const requireHouseholdId = (): string | null => {
    const value = householdInput.value.trim();
    if (!value) {
      toast.show({ kind: "error", message: "Household ID is required." });
      householdInput.focus();
      return null;
    }
    return value;
  };

  const ensureCategory = (value: string, label: string): AttachmentCategory | null => {
    if (!value) {
      toast.show({
        kind: "error",
        message: `${label} is required.`,
      });
      return null;
    }
    return value as AttachmentCategory;
  };

  const updateMoveStatus = (message: string, isError = false): void => {
    moveStatus.hidden = false;
    moveStatus.textContent = message;
    moveStatus.dataset.status = isError ? "error" : "info";
  };

  const updateRepairStatus = (message: string, isError = false): void => {
    repairStatus.hidden = false;
    repairStatus.textContent = message;
    repairStatus.dataset.status = isError ? "error" : "info";
  };

  repairLoadManifestButton.addEventListener("click", () => {
    repairManifestInput.value = "";
    repairManifestInput.click();
  });

  repairManifestInput.addEventListener("change", async () => {
    const file = repairManifestInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("Manifest must be an array of repair actions.");
      }
      const actions: AttachmentsRepairAction[] = parsed.map((entry) => {
        if (typeof entry !== "object" || entry === null) {
          throw new Error("Manifest entries must be objects.");
        }
        interface ManifestEntry {
          table_name?: unknown;
          tableName?: unknown;
          row_id?: unknown;
          rowId?: unknown;
          action?: unknown;
          action_type?: unknown;
          type?: unknown;
          new_category?: unknown;
          newCategory?: unknown;
          new_relative_path?: unknown;
          newRelativePath?: unknown;
        }
        const candidate = entry as ManifestEntry;
        const tableNameValue = candidate.table_name ?? candidate.tableName;
        if (typeof tableNameValue !== "string" || tableNameValue.length === 0) {
          throw new Error("Manifest entry missing table name.");
        }
        const rowIdValue = candidate.row_id ?? candidate.rowId;
        const rowId = Number(rowIdValue);
        if (!Number.isInteger(rowId)) {
          throw new Error("Manifest entry row_id must be an integer.");
        }
        const actionValueRaw = candidate.action ?? candidate.action_type ?? candidate.type;
        if (typeof actionValueRaw !== "string") {
          throw new Error("Manifest entry has unsupported action type.");
        }
        const actionValue = actionValueRaw as AttachmentsRepairAction["action"];
        if (!["detach", "mark", "relink"].includes(actionValue)) {
          throw new Error("Manifest entry has unsupported action type.");
        }
        const categoryRaw = candidate.new_category ?? candidate.newCategory;
        const relativeRaw = candidate.new_relative_path ?? candidate.newRelativePath;
        const action: AttachmentsRepairAction = {
          tableName: tableNameValue,
          rowId,
          action: actionValue,
        };
        if (typeof categoryRaw === "string" && categoryRaw.length > 0) {
          action.newCategory = categoryRaw as AttachmentCategory;
        }
        if (typeof relativeRaw === "string" && relativeRaw.trim().length > 0) {
          action.newRelativePath = relativeRaw;
        }
        return action;
      });
      state.maintenance.repair.actions = actions;
      state.maintenance.repair.manifestName = file.name;
      updateRepairActionsSummary();
      toast.show({
        kind: "success",
        message: `Loaded ${actions.length} repair action${actions.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      state.maintenance.repair.actions = [];
      state.maintenance.repair.manifestName = null;
      updateRepairActionsSummary();
      const message =
        (error as { message?: string })?.message ?? "Unable to load repair manifest.";
      toast.show({ kind: "error", message });
    }
  });

  repairCancelButton.addEventListener("click", async () => {
    if (!state.maintenance.repair.running) return;
    const householdId = householdInput.value.trim();
    if (!householdId) {
      toast.show({ kind: "error", message: "Household ID is required." });
      return;
    }
    repairCancelButton.update({ disabled: true });
    try {
      await cancelAttachmentsRepair(householdId);
      updateRepairStatus("Cancellation requested. Finishing current batch…");
    } catch (error) {
      const message = (error as { message?: string })?.message ?? "Unable to cancel repair.";
      toast.show({ kind: "error", message });
      repairCancelButton.update({ disabled: false });
    }
  });

  async function performMove(): Promise<void> {
    if (state.maintenance.move.running) return;
    const householdId = requireHouseholdId();
    if (!householdId) return;

    const fromCategory = ensureCategory(
      fromCategorySelect.value,
      "Source category",
    );
    const toCategory = ensureCategory(
      toCategorySelect.value,
      "Destination category",
    );
    const fromRelative = fromRelInput.value.trim();
    const toRelative = toRelInput.value.trim();

    if (!fromCategory || !toCategory) return;
    if (!fromRelative || !toRelative) {
      toast.show({
        kind: "error",
        message: "Relative paths are required.",
      });
      return;
    }

    state.maintenance.move.running = true;
    moveActionButton.update({ disabled: true });
    updateMoveStatus("Moving file…");
    try {
      const result = await moveFile({
        householdId,
        fromCategory,
        fromRelativePath: fromRelative,
        toCategory,
        toRelativePath: toRelative,
        conflict: conflictSelect.value as ConflictStrategy,
      });
      const renameNote = result.renamed ? " (renamed)" : "";
      updateMoveStatus(
        `Updated ${result.moved} references${renameNote}.`,
        false,
      );
      toast.show({ kind: "success", message: "File move completed." });
    } catch (error) {
      const message = (error as { message?: string })?.message ?? "File move failed.";
      updateMoveStatus(message, true);
      toast.show({ kind: "error", message });
    } finally {
      state.maintenance.move.running = false;
      moveActionButton.update({ disabled: false });
    }
  }

  async function runRepair(
    mode: AttachmentsRepairMode,
    actions?: AttachmentsRepairAction[],
  ): Promise<void> {
    if (state.maintenance.repair.running) return;
    const householdId = requireHouseholdId();
    if (!householdId) return;

    let payloadActions: AttachmentsRepairAction[] | undefined;
    if (mode === "apply") {
      const active = actions ?? state.maintenance.repair.actions;
      if (!active.length) {
        toast.show({
          kind: "error",
          message: "Load a repair manifest before applying actions.",
        });
        return;
      }
      payloadActions = active;
    }

    state.maintenance.repair.running = true;
    repairScanButton.update({ disabled: true });
    repairApplyButton.update({ disabled: true });
    repairLoadManifestButton.update({ disabled: true });
    repairCancelButton.update({ disabled: false });
    repairProgress.hidden = false;
    repairProgress.removeAttribute("value");
    updateRepairStatus(
      mode === "scan"
        ? "Scanning attachments…"
        : "Applying recorded actions…",
    );
    try {
      const result = await runAttachmentsRepair({
        householdId,
        mode,
        actions: payloadActions,
      });
      state.maintenance.repair.scanned = result.scanned;
      state.maintenance.repair.missing = result.missing;
      const parts = [`Scanned ${result.scanned}`, `Missing ${result.missing}`];
      if (result.repaired) {
        parts.push(`Repaired ${result.repaired}`);
      }
      updateRepairStatus(parts.join(" · "));
      toast.show({ kind: "success", message: `Repair ${mode} completed.` });
      if (mode === "apply") {
        state.maintenance.repair.actions = [];
        state.maintenance.repair.manifestName = null;
      } else if (result.missing > 0) {
        repairApplyButton.update({
          disabled: state.maintenance.repair.actions.length === 0,
        });
      }
    } catch (error) {
      const message = (error as { message?: string })?.message ?? "Repair run failed.";
      updateRepairStatus(message, true);
      toast.show({ kind: "error", message });
    } finally {
      state.maintenance.repair.running = false;
      repairScanButton.update({ disabled: false });
      repairLoadManifestButton.update({ disabled: false });
      repairCancelButton.update({ disabled: true });
      updateRepairActionsSummary();
      repairProgress.hidden = true;
    }
  }

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

  function updateIndexUi(): void {
    const status = state.index.status;
    const progress = state.index.progress;
    const running =
      status?.state === "Building" || status?.state === "Cancelling";

    if (!status) {
      indexStatusBadge.textContent = "Index status unavailable";
      indexStatusBadge.dataset.status = "warning";
      indexSummary.textContent = "Index status could not be loaded.";
      indexProgressBar.hidden = true;
      indexProgressNote.hidden = true;
      indexProgressNote.textContent = "";
      indexRebuildButton.disabled = false;
      indexCancelButton.hidden = true;
      indexCancelButton.disabled = true;
      return;
    }

    const now = Date.now();
    const builtMs = status.lastBuiltAt ? Date.parse(status.lastBuiltAt) : NaN;
    const isFresh =
      Number.isFinite(builtMs) && now - (builtMs as number) <= 15 * 60 * 1000;
    const upToDate = status.state === "Idle" && status.rowCount > 0 && isFresh;

    let badgeText: string;
    let badgeStatus: string;

    if (running) {
      badgeText =
        status.state === "Cancelling"
          ? "Cancelling rebuild…"
          : "Indexing files…";
      badgeStatus = "pending";
    } else if (status.state === "Error") {
      badgeText = "Index error";
      badgeStatus = "danger";
    } else if (upToDate) {
      badgeText = "Index up-to-date";
      badgeStatus = "success";
    } else if (status.rowCount === 0) {
      badgeText = "Index empty";
      badgeStatus = "warning";
    } else if (Number.isFinite(builtMs)) {
      const builtLabel = new Date(builtMs as number).toLocaleString();
      badgeText = `Last built ${builtLabel}`;
      badgeStatus = "warning";
    } else {
      badgeText = "Index status pending";
      badgeStatus = "warning";
    }

    indexStatusBadge.textContent = badgeText;
    indexStatusBadge.dataset.status = badgeStatus;

    const summaryParts = [`Rows tracked: ${status.rowCount}`];
    if (Number.isFinite(builtMs)) {
      summaryParts.push(
        `Last built ${new Date(builtMs as number).toLocaleString()}`,
      );
    }
    indexSummary.textContent = summaryParts.join(" · ");

    if (running) {
      indexProgressBar.hidden = false;
      indexProgressBar.removeAttribute("value");
      indexProgressNote.hidden = false;
      indexProgressNote.textContent = `Scanned ${progress.scanned} · Updated ${progress.updated} · Skipped ${progress.skipped}`;
    } else {
      indexProgressBar.hidden = true;
      indexProgressNote.hidden = true;
      indexProgressNote.textContent = "";
    }

    indexRebuildButton.disabled = running;
    indexCancelButton.hidden = !running;
    indexCancelButton.disabled = !running;
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

  async function refreshIndexStatus(): Promise<void> {
    try {
      const result = await getIndexStatus();
      state.index.householdId = result.householdId;
      state.index.status = result.status;
      state.index.progress = { scanned: 0, updated: 0, skipped: 0 };
    } catch (error) {
      const message = (error as { message?: string })?.message ?? "Unable to load index status.";
      toast.show({ kind: "error", message });
    }
    updateIndexUi();
  }

  async function startIndexRebuild(): Promise<void> {
    indexRebuildButton.disabled = true;
    indexCancelButton.hidden = false;
    indexCancelButton.disabled = false;
    state.index.progress = { scanned: 0, updated: 0, skipped: 0 };
    state.index.status = {
      lastBuiltAt: state.index.status?.lastBuiltAt ?? null,
      rowCount: state.index.status?.rowCount ?? 0,
      state: "Building",
    };
    updateIndexUi();
    try {
      const summary = await rebuildIndex("incremental", state.index.householdId ?? undefined);
      toast.show({
        kind: "success",
        message: `Indexed ${summary.updated} files (${summary.total} tracked)`,
      });
    } catch (error) {
      const message = (error as { message?: string })?.message ?? "Index rebuild failed.";
      toast.show({ kind: "error", message });
      state.index.status = {
        lastBuiltAt: state.index.status?.lastBuiltAt ?? null,
        rowCount: state.index.status?.rowCount ?? 0,
        state: "Error",
      };
      updateIndexUi();
    }
    await refreshIndexStatus();
  }

  async function cancelIndexRun(): Promise<void> {
    state.index.status = state.index.status ?? {
      lastBuiltAt: null,
      rowCount: 0,
      state: "Cancelling",
    };
    state.index.status.state = "Cancelling";
    updateIndexUi();
    indexCancelButton.disabled = true;
    try {
      await cancelIndexRebuild(state.index.householdId ?? undefined);
      toast.show({ kind: "info", message: "Cancellation requested." });
    } catch (error) {
      const message = (error as { message?: string })?.message ?? "Unable to cancel index rebuild.";
      toast.show({ kind: "error", message });
      indexCancelButton.disabled = false;
    }
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

  moveActionButton.addEventListener("click", (event) => {
    event.preventDefault();
    void performMove();
  });

  repairScanButton.addEventListener("click", (event) => {
    event.preventDefault();
    void runRepair("scan");
  });

  repairApplyButton.addEventListener("click", (event) => {
    event.preventDefault();
    void runRepair("apply", state.maintenance.repair.actions);
  });

  indexRebuildButton.addEventListener("click", (event) => {
    event.preventDefault();
    void startIndexRebuild();
  });

  indexCancelButton.addEventListener("click", (event) => {
    event.preventDefault();
    void cancelIndexRun();
  });

  void refreshStatus();
  void refreshIndexStatus();

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

  void listen<{ stage?: string; file?: string; done?: number; total?: number }>(
    "file_move_progress",
    (event) => {
      const payload = event.payload;
      if (!payload) return;
      const file = payload.file ?? "";
      if (payload.stage === "completed") {
        updateMoveStatus(`Completed: ${file}`);
      } else {
        const done = Number(payload.done ?? 0);
        const total = Number(payload.total ?? 0);
        const progress = total > 0 ? `${done}/${total}` : `${done}`;
        updateMoveStatus(`Moving ${file} (${progress})`);
      }
    },
  ).then((unlisten) => {
    state.unlisten.push(unlisten);
  });

  void listen<{ table?: string; scanned?: number; missing?: number }>(
    "attachments_repair_progress",
    (event) => {
      const payload = event.payload;
      if (!payload) return;
      const table = payload.table ?? "";
      const scanned = Number(payload.scanned ?? 0);
      const missing = Number(payload.missing ?? 0);
      updateRepairStatus(
        `Scanning ${table || "attachments"}: ${scanned} scanned · ${missing} missing`,
      );
    },
  ).then((unlisten) => {
    state.unlisten.push(unlisten);
  });

  void listen<FilesIndexProgressPayload>("files_index_progress", (event) => {
    const payload = event.payload;
    if (!payload) return;
    if (
      state.index.householdId &&
      payload.household_id !== state.index.householdId
    ) {
      return;
    }
    state.index.householdId = payload.household_id ?? state.index.householdId;
    state.index.progress = {
      scanned: Number(payload.scanned ?? 0),
      updated: Number(payload.updated ?? 0),
      skipped: Number(payload.skipped ?? 0),
    };
    state.index.status = state.index.status ?? {
      lastBuiltAt: null,
      rowCount: 0,
      state: "Building",
    };
    if (state.index.status.state !== "Cancelling") {
      state.index.status.state = "Building";
    }
    updateIndexUi();
  }).then((unlisten) => {
    state.unlisten.push(unlisten);
  });

  void listen<FilesIndexStatePayload>("files_index_state", (event) => {
    const payload = event.payload;
    if (!payload) return;
    if (
      state.index.householdId &&
      payload.household_id !== state.index.householdId
    ) {
      return;
    }
    state.index.householdId = payload.household_id ?? state.index.householdId;
    state.index.status = state.index.status ?? {
      lastBuiltAt: null,
      rowCount: 0,
      state: payload.state,
    };
    state.index.status.state = payload.state;
    if (payload.state === "Idle" || payload.state === "Error") {
      void refreshIndexStatus();
    } else {
      updateIndexUi();
    }
  }).then((unlisten) => {
    state.unlisten.push(unlisten);
  });

  updateRepairActionsSummary();

  section.append(
    statusWrapper,
    helper,
    controls,
    progressBar,
    progressNote,
    summary,
    indexSection,
    maintenanceSection,
  );

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
