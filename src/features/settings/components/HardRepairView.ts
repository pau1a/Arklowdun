import type { HardRepairOutcome } from "@bindings/HardRepairOutcome";
import createButton from "@ui/Button";
import createModal from "@ui/Modal";
import { toast } from "@ui/Toast";
import { recoveryText } from "@strings/recovery";

import { runHardRepair } from "../api/hardRepair";
import { copyText } from "../api/clipboard";

interface HardRepairState {
  running: boolean;
  outcome: HardRepairOutcome | null;
  error: string | null;
}

export interface HardRepairViewInstance {
  element: HTMLElement;
  destroy: () => void;
}

export function createHardRepairView(): HardRepairViewInstance {
  const section = document.createElement("section");
  section.className = "card settings__section settings__section--hard-repair";
  section.setAttribute("aria-labelledby", "settings-hard-repair");

  const heading = document.createElement("h3");
  heading.id = "settings-hard-repair";
  heading.textContent = recoveryText("db.hard_repair.section.title");

  const helper = document.createElement("p");
  helper.className = "settings__helper repair__helper";
  helper.textContent = recoveryText("db.hard_repair.section.helper");

  const controls = document.createElement("div");
  controls.className = "repair__controls";

  const repairButton = createButton({
    label: recoveryText("db.hard_repair.button.run"),
    variant: "ghost",
    className: "repair__action",
  });

  const reportButton = createButton({
    label: recoveryText("db.hard_repair.button.report"),
    variant: "ghost",
    className: "repair__link",
  });
  reportButton.hidden = true;

  const status = document.createElement("p");
  status.className = "repair__status";

  controls.append(repairButton, reportButton);
  section.append(heading, helper, controls, status);

  const modal = createModal({
    open: false,
    titleId: "hard-repair-modal-title",
    descriptionId: "hard-repair-modal-description",
    closeOnOverlayClick: false,
    onOpenChange: (open) => {
      if (state.running) {
        modal.setOpen(true);
        return;
      }
      if (open) {
        status.textContent = "";
      }
    },
  });

  modal.root.classList.add("repair-modal__overlay");
  modal.dialog.classList.add("repair-modal");
  modal.dialog.dataset.ui = "repair-modal";

  const header = document.createElement("header");
  header.className = "repair-modal__header";

  const title = document.createElement("h2");
  title.id = "hard-repair-modal-title";
  title.className = "repair-modal__title";
  title.textContent = recoveryText("db.hard_repair.modal.title");

  header.appendChild(title);

  const body = document.createElement("div");
  body.className = "repair-modal__body";

  const summary = document.createElement("p");
  summary.id = "hard-repair-modal-description";
  summary.className = "repair__outcome";
  summary.textContent = recoveryText("db.hard_repair.modal.warning");

  const warning = document.createElement("p");
  warning.className = "repair__note";
  warning.textContent = recoveryText("db.hard_repair.modal.note");

  const footer = document.createElement("div");
  footer.className = "repair-modal__footer";

  const cancelButton = createButton({
    label: recoveryText("db.hard_repair.button.cancel"),
    variant: "ghost",
  });

  const startButton = createButton({
    label: recoveryText("db.hard_repair.button.start"),
    variant: "primary",
  });

  footer.append(cancelButton, startButton);

  body.append(summary, warning);
  modal.dialog.append(header, body, footer);

  const state: HardRepairState = {
    running: false,
    outcome: null,
    error: null,
  };

  function syncButtons() {
    startButton.disabled = state.running;
    cancelButton.disabled = state.running;
    repairButton.disabled = state.running;
  }

  async function copyReportPath() {
    const outcome = state.outcome;
    if (!outcome) return;
    try {
      await copyText(outcome.reportPath);
      toast.show({
        kind: "success",
        message: recoveryText("db.hard_repair.toast.copy_success"),
      });
    } catch (error) {
      toast.show({
        kind: "error",
        message: recoveryText("db.hard_repair.toast.copy_failure", {
          message: describeError(error),
        }),
      });
    }
  }

  function describeError(error: unknown): string {
    if (!error) return recoveryText("db.common.unknown_error");
    if (typeof error === "string") return error;
    if (typeof error === "object" && error && "message" in error) {
      return (
        String((error as { message?: unknown }).message ?? "") ||
        recoveryText("db.common.unknown_error")
      );
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  function formatOutcome(outcome: HardRepairOutcome): string {
    const failedTotal = Object.values(outcome.recovery.tables).reduce(
      (sum, entry) => sum + Number(entry?.failed ?? 0),
      0,
    );
    if (outcome.omitted) {
      if (failedTotal > 0) {
        return recoveryText("db.hard_repair.status.partial", {
          count: String(failedTotal),
          suffix: failedTotal === 1 ? "" : "s",
        });
      }
      return recoveryText("db.hard_repair.status.complete_warnings");
    }
    return recoveryText("db.hard_repair.status.complete");
  }

  async function executeHardRepair() {
    if (state.running) return;
    state.running = true;
    state.error = null;
    summary.textContent = recoveryText("db.hard_repair.status.running");
    syncButtons();

    try {
      const outcome = await runHardRepair();
      state.outcome = outcome;
      const message = formatOutcome(outcome);
      summary.textContent = message;
      status.textContent = message;
      reportButton.hidden = state.outcome === null;
    } catch (error) {
      const message = describeError(error);
      state.error = message;
      state.outcome = null;
      const failure = recoveryText("db.hard_repair.status.failure", {
        message,
      });
      summary.textContent = failure;
      status.textContent = failure;
      reportButton.hidden = true;
      toast.show({ kind: "error", message });
    } finally {
      state.running = false;
      syncButtons();
    }
  }

  function openModal() {
    modal.setOpen(true);
  }

  function closeModal() {
    if (state.running) return;
    modal.setOpen(false);
  }

  const handleStart = () => {
    void executeHardRepair();
  };
  const handleReport = () => {
    void copyReportPath();
  };

  repairButton.addEventListener("click", openModal);
  cancelButton.addEventListener("click", closeModal);
  startButton.addEventListener("click", handleStart);
  reportButton.addEventListener("click", handleReport);

  return {
    element: section,
    destroy() {
      repairButton.removeEventListener("click", openModal);
      cancelButton.removeEventListener("click", closeModal);
      startButton.removeEventListener("click", handleStart);
      reportButton.removeEventListener("click", handleReport);
      modal.setOpen(false);
      modal.root.remove();
    },
  };
}

export default createHardRepairView;
