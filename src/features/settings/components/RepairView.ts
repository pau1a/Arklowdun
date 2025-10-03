import type { DbRepairSummary } from "@bindings/DbRepairSummary";
import type { DbRepairStep } from "@bindings/DbRepairStep";
import type { DbRepairStepState } from "@bindings/DbRepairStepState";
import createButton from "@ui/Button";
import createModal from "@ui/Modal";
import { actions, selectors, subscribe } from "@store/index";
import { toast } from "@ui/Toast";
import { recoveryText } from "@strings/recovery";

import { runRepair, listenRepairEvents } from "../api/repair";
import { revealBackup } from "../api/backups";

const STEP_LABELS: Record<DbRepairStep, string> = {
  backup: recoveryText("db.repair.steps.backup"),
  checkpoint: recoveryText("db.repair.steps.checkpoint"),
  rebuild: recoveryText("db.repair.steps.rebuild"),
  validate: recoveryText("db.repair.steps.validate"),
  swap: recoveryText("db.repair.steps.swap"),
};

const STATUS_ICONS: Record<DbRepairStepState, string> = {
  pending: "fa-regular fa-circle",
  running: "fa-solid fa-spinner fa-spin",
  success: "fa-solid fa-circle-check",
  warning: "fa-solid fa-triangle-exclamation",
  skipped: "fa-regular fa-circle-dot",
  failed: "fa-solid fa-circle-xmark",
};

const STEP_ORDER: DbRepairStep[] = [
  "backup",
  "checkpoint",
  "rebuild",
  "validate",
  "swap",
];

const numberFormatter = new Intl.NumberFormat();

function formatLowDiskMessage(required?: string, available?: string): string {
  const requiredBytes = Number(required);
  const availableBytes = Number(available);
  if (Number.isFinite(requiredBytes) && Number.isFinite(availableBytes)) {
    const requiredMb = Math.ceil(requiredBytes / 1_000_000);
    const availableMb = Math.floor(availableBytes / 1_000_000);
    return recoveryText("db.repair.error.disk_precise", {
      required: numberFormatter.format(requiredMb),
      available: numberFormatter.format(availableMb),
    });
  }
  return recoveryText("db.repair.error.disk");
}

interface StepElements {
  item: HTMLLIElement;
  icon: HTMLElement;
  note: HTMLSpanElement;
}

interface RepairState {
  running: boolean;
  health: ReturnType<typeof selectors.db.health> | null;
  summary: DbRepairSummary | null;
  unlisten: (() => void) | null;
  errorMessage: string | null;
  backupPath: string | null;
}

export interface RepairViewInstance {
  element: HTMLElement;
  destroy: () => void;
}

function describeError(error: unknown): string {
  if (!error) return recoveryText("db.common.unknown_error");
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const record = error as {
      message?: unknown;
      code?: unknown;
      context?: Record<string, string> | undefined;
    };
    if (record?.code === "DB_REPAIR/LOW_DISK") {
      const ctx = record.context ?? {};
      return formatLowDiskMessage(ctx.required_bytes, ctx.available_bytes);
    }
    if (typeof record.message === "string") return record.message;
    if (typeof record.code === "string") return record.code;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function createRepairView(): RepairViewInstance {
  const section = document.createElement("section");
  section.className = "card settings__section settings__section--repair";
  section.setAttribute("aria-labelledby", "settings-repair");

  const heading = document.createElement("h3");
  heading.id = "settings-repair";
  heading.textContent = recoveryText("db.repair.section.title");

  const helper = document.createElement("p");
  helper.className = "settings__helper repair__helper";
  helper.textContent = recoveryText("db.repair.section.helper");

  const controls = document.createElement("div");
  controls.className = "repair__controls";

  const repairButton = createButton({
    label: recoveryText("db.repair.button.run"),
    variant: "primary",
    className: "repair__action",
  });

  controls.appendChild(repairButton);

  const status = document.createElement("p");
  status.className = "repair__status";

  section.append(heading, helper, controls, status);

  const titleId = "repair-modal-title";
  const summaryId = "repair-modal-summary";
  let currentOpen = false;

  const state: RepairState = {
    running: false,
    health: null,
    summary: null,
    unlisten: null,
    errorMessage: null,
    backupPath: null,
  };

  const stepElements = new Map<DbRepairStep, StepElements>();

  const modal = createModal({
    open: false,
    closeOnOverlayClick: false,
    titleId,
    descriptionId: summaryId,
    onOpenChange: (open) => {
      if (state.running && !open) {
        if (!currentOpen) {
          return;
        }
        modal.setOpen(true);
        return;
      }
      currentOpen = open;
    },
  });

  modal.root.classList.add("repair-modal__overlay");
  modal.dialog.classList.add("repair-modal");
  modal.dialog.dataset.ui = "repair-modal";

  const modalHeader = document.createElement("header");
  modalHeader.className = "repair-modal__header";

  const modalTitle = document.createElement("h2");
  modalTitle.id = titleId;
  modalTitle.className = "repair-modal__title";
  modalTitle.textContent = recoveryText("db.repair.modal.title");

  modalHeader.appendChild(modalTitle);

  const modalBody = document.createElement("div");
  modalBody.className = "repair-modal__body";

  const modalSummary = document.createElement("p");
  modalSummary.id = summaryId;
  modalSummary.className = "repair__outcome";
  modalSummary.textContent = recoveryText("db.repair.modal.intro");

  const modalDetails = document.createElement("div");
  modalDetails.className = "repair__details";

  const stepList = document.createElement("ol");
  stepList.className = "repair__steps";

  for (const step of STEP_ORDER) {
    const item = document.createElement("li");
    item.className = "repair__step";
    item.dataset.step = step;
    item.dataset.status = "pending";

    const iconWrap = document.createElement("span");
    iconWrap.className = "repair__step-icon";
    const icon = document.createElement("i");
    icon.className = STATUS_ICONS.pending;
    icon.setAttribute("aria-hidden", "true");
    iconWrap.appendChild(icon);

    const body = document.createElement("div");
    body.className = "repair__step-body";

    const label = document.createElement("span");
    label.className = "repair__step-label";
      // eslint-disable-next-line security/detect-object-injection -- step keys are validated enum values
      label.textContent = STEP_LABELS[step];

    const note = document.createElement("span");
    note.className = "repair__step-note";
    note.hidden = true;

    body.append(label, note);
    item.append(iconWrap, body);
    stepList.appendChild(item);

    stepElements.set(step, { item, icon, note });
  }

  modalDetails.appendChild(stepList);

  const modalFooter = document.createElement("footer");
  modalFooter.className = "repair-modal__footer";

  const revealButton = createButton({
    label: recoveryText("db.repair.modal.reveal"),
    variant: "ghost",
    className: "repair__reveal",
    disabled: true,
  });
  revealButton.hidden = true;

  const closeButton = createButton({
    label: recoveryText("db.repair.modal.close"),
    variant: "ghost",
    className: "repair__close",
    onClick: (event) => {
      event.preventDefault();
      if (state.running) return;
      modal.setOpen(false);
      currentOpen = false;
    },
  });
  closeButton.update({ disabled: true });

  modalFooter.append(revealButton, closeButton);

  modalBody.append(modalSummary, modalDetails);
  modal.dialog.append(modalHeader, modalBody, modalFooter);

  function disposeListener(): void {
    if (state.unlisten) {
      const unlisten = state.unlisten;
      state.unlisten = null;
      try {
        unlisten();
      } catch (error) {
        console.error("Failed to unlisten repair events", error);
      }
    }
  }

  function resetSteps(): void {
    for (const elements of stepElements.values()) {
      elements.item.dataset.status = "pending";
      elements.icon.className = STATUS_ICONS.pending;
      elements.note.textContent = "";
      elements.note.hidden = true;
    }
  }

  function updateStep(
    step: DbRepairStep,
    statusValue: DbRepairStepState,
    message: string | null,
  ): void {
    const elements = stepElements.get(step);
    if (!elements) return;
    elements.item.dataset.status = statusValue;
      // eslint-disable-next-line security/detect-object-injection -- statusValue derives from known enum variants
      const iconClass = STATUS_ICONS[statusValue] ?? STATUS_ICONS.pending;
    elements.icon.className = iconClass;
    if (message && message.trim().length) {
      elements.note.textContent = message;
      elements.note.hidden = false;
    } else {
      elements.note.textContent = "";
      elements.note.hidden = true;
    }
  }

  function formatSummaryError(summary: DbRepairSummary): string {
    const error = summary.error;
    if (!error) return recoveryText("db.repair.error.generic");
    if (error.code === "DB_REPAIR/LOW_DISK") {
      const context = error.context ?? {};
      return formatLowDiskMessage(context.required_bytes, context.available_bytes);
    }
    if (error.message) return error.message;
    return recoveryText("db.repair.error.generic");
  }

  function applySummary(summary: DbRepairSummary): void {
    for (const step of summary.steps) {
      updateStep(step.step, step.status, step.message ?? null);
    }
    state.backupPath = summary.backup_sqlite_path ?? null;
    if (summary.health_report) {
      actions.db.health.receive(summary.health_report);
    }

    if (summary.success) {
      modalSummary.className = "repair__outcome repair__outcome--success";
      modalSummary.textContent = recoveryText("db.repair.success");
      if (summary.duration_ms) {
        const seconds = (summary.duration_ms / 1000).toFixed(1);
        modalSummary.textContent += recoveryText("db.repair.modal.elapsed", {
          seconds,
        });
      }
      revealButton.hidden = !state.backupPath;
      revealButton.update({ disabled: !state.backupPath });
    } else {
      modalSummary.className = "repair__outcome repair__outcome--error";
      const reason = formatSummaryError(summary);
      modalSummary.textContent = `${reason} ${recoveryText("db.repair.modal.read_only")}`;
      revealButton.hidden = !state.backupPath;
      revealButton.update({ disabled: !state.backupPath });
    }
    closeButton.update({ disabled: false });
  }

  function syncStatus(): void {
    if (state.running) {
      status.textContent = recoveryText("db.repair.status.running");
      return;
    }
    if (state.errorMessage) {
      status.textContent = state.errorMessage;
      return;
    }
    const health = state.health;
    const unhealthy = health?.report?.status === "error";
    status.textContent = !unhealthy
      ? recoveryText("db.repair.status.ready")
      : "";
  }

  function syncRepairButton(): void {
    const health = state.health;
    const unhealthy = health?.report?.status === "error";
    const disabled = state.running || !unhealthy;
    const label = state.running
      ? recoveryText("db.repair.button.running")
      : recoveryText("db.repair.button.run");
    repairButton.update({ label, disabled });
  }

  async function executeRepair(): Promise<void> {
    if (state.running) return;
    const health = state.health;
    if (!health || health.report?.status !== "error") return;

    state.running = true;
    state.summary = null;
    state.errorMessage = null;
    state.backupPath = null;
    syncRepairButton();
    syncStatus();
    resetSteps();
    revealButton.hidden = true;
    revealButton.update({ disabled: true });
    closeButton.update({ disabled: true });
    modalSummary.className = "repair__outcome";
    modalSummary.textContent = recoveryText("db.repair.modal.preparing");

    modal.setOpen(true);
    currentOpen = true;

    try {
      state.unlisten = await listenRepairEvents((event) => {
        if (event.type === "step") {
          updateStep(event.step, event.status, event.message ?? null);
        }
      });
    } catch (error) {
      state.running = false;
      state.errorMessage = describeError(error);
      syncStatus();
      closeButton.update({ disabled: false });
      toast.show({ kind: "error", message: state.errorMessage });
      return;
    }

    try {
      const summary = await runRepair();
      state.summary = summary;
      applySummary(summary);
    } catch (error) {
      state.errorMessage = describeError(error);
      modalSummary.className = "repair__outcome repair__outcome--error";
      modalSummary.textContent = `${state.errorMessage ?? recoveryText("db.repair.error.generic")}. ${recoveryText("db.repair.modal.read_only")}`;
      closeButton.update({ disabled: false });
      toast.show({ kind: "error", message: state.errorMessage });
    } finally {
      state.running = false;
      syncRepairButton();
      syncStatus();
      disposeListener();
    }
  }

  repairButton.addEventListener("click", (event) => {
    event.preventDefault();
    void executeRepair();
  });

  revealButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (!state.backupPath) {
      toast.show({
        kind: "error",
        message: recoveryText("db.repair.modal.backup_unavailable"),
      });
      return;
    }
    void revealBackup(state.backupPath).catch((error) => {
      toast.show({ kind: "error", message: describeError(error) });
    });
  });

  const unsubscribe = subscribe(selectors.db.health, (health) => {
    state.health = health;
    syncRepairButton();
    syncStatus();
  });

  syncRepairButton();
  syncStatus();

  return {
    element: section,
    destroy: () => {
      unsubscribe();
      disposeListener();
      modal.setOpen(false);
      currentOpen = false;
      section.replaceChildren();
    },
  };
}

export default createRepairView;
