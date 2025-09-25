import type { HardRepairOutcome } from "@bindings/HardRepairOutcome";
import createButton from "@ui/Button";
import createModal from "@ui/Modal";
import { toast } from "@ui/Toast";

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
  heading.textContent = "Hard repair";

  const helper = document.createElement("p");
  helper.className = "settings__helper repair__helper";
  helper.textContent =
    "Hard Repair rebuilds the database schema from scratch and copies tables one by one. It may skip corrupted rows but always produces a recovery report.";

  const controls = document.createElement("div");
  controls.className = "repair__controls";

  const repairButton = createButton({
    label: "Run hard repair",
    variant: "ghost",
    className: "repair__action",
  });

  const reportButton = createButton({
    label: "Copy recovery report path",
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
  title.textContent = "Run hard repair";

  header.appendChild(title);

  const body = document.createElement("div");
  body.className = "repair-modal__body";

  const summary = document.createElement("p");
  summary.id = "hard-repair-modal-description";
  summary.className = "repair__outcome";
  summary.textContent =
    "Hard Repair may recover most data but some records may be lost. A recovery report will be generated with any omissions.";

  const warning = document.createElement("p");
  warning.className = "repair__note";
  warning.textContent =
    "During Hard Repair the application will be unavailable. The original database is preserved as a backup.";

  const footer = document.createElement("div");
  footer.className = "repair-modal__footer";

  const cancelButton = createButton({
    label: "Cancel",
    variant: "ghost",
  });

  const startButton = createButton({
    label: "Start hard repair",
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
      toast.show({ kind: "success", message: "Recovery report path copied." });
    } catch (error) {
      toast.show({
        kind: "error",
        message: `Failed to copy path: ${describeError(error)}`,
      });
    }
  }

  function describeError(error: unknown): string {
    if (!error) return "Unknown error";
    if (typeof error === "string") return error;
    if (typeof error === "object" && error && "message" in error) {
      return String((error as { message?: unknown }).message ?? "Unknown error");
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  function formatOutcome(outcome: HardRepairOutcome): string {
    const failedTotal = Object.values(outcome.recovery.tables).reduce(
      (sum, entry) => sum + Number(entry.failed ?? 0),
      0,
    );
    if (outcome.omitted) {
      if (failedTotal > 0) {
        return `Hard Repair complete. ${failedTotal} record${failedTotal === 1 ? "" : "s"} could not be restored — view report.`;
      }
      return "Hard Repair complete with warnings — check the recovery report for details.";
    }
    return "Hard Repair complete. All tables were restored successfully.";
  }

  async function executeHardRepair() {
    if (state.running) return;
    state.running = true;
    state.error = null;
    summary.textContent = "Running Hard Repair. This may take several minutes.";
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
      summary.textContent = `Hard Repair failed: ${message}`;
      status.textContent = `Hard Repair failed: ${message}`;
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
