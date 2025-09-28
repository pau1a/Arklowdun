import { defaultHouseholdId } from "@db/household";
import createButton from "@ui/Button";
import {
  cancelBackfill,
  fetchBackfillStatus,
  startBackfill,
  type BackfillStatusReport,
  type BackfillSummary,
} from "../api/timeMaintenance";
import {
  listenBackfillEvents,
  type BackfillEvent,
  type BackfillProgressEvent,
  type BackfillSummaryEvent,
} from "../api/timeMaintenanceEvents";

const MIN_CHUNK_SIZE = 100;
const MAX_CHUNK_SIZE = 5000;
const DEFAULT_CHUNK_SIZE = 500;
const PROGRESS_THROTTLE_MS = 150;

export interface TimezoneMaintenanceSection {
  element: HTMLElement;
  destroy: () => void;
}

type RunState = "idle" | "running" | "completed" | "cancelled" | "error";

interface ComponentState {
  runState: RunState;
  progress?: BackfillProgressEvent;
  summary?: BackfillSummary;
  errorMessage?: string;
  pending: number;
  resumeAvailable: boolean;
  runningExternalHousehold?: string;
  cancelPending: boolean;
}

const numberFormatter = new Intl.NumberFormat("en-US");

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function buildTimezoneSelect(): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "timezone-maintenance__select";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Use stored household timezone";
  select.append(defaultOption);

  const intlWithSupport = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  if (typeof intlWithSupport.supportedValuesOf === "function") {
    const zones = intlWithSupport.supportedValuesOf("timeZone");
    for (const zone of zones) {
      const option = document.createElement("option");
      option.value = zone;
      option.textContent = zone;
      select.append(option);
    }
  }

  return select;
}

export function createTimezoneMaintenanceSection(): TimezoneMaintenanceSection {
  const section = document.createElement("section");
  section.className = "card settings__section settings__section--timezone";
  section.setAttribute("aria-labelledby", "settings-timezone-maintenance");

  const heading = document.createElement("h3");
  heading.id = "settings-timezone-maintenance";
  heading.textContent = "Time & Timezone Maintenance";

  const helper = document.createElement("p");
  helper.className = "settings__helper";
  helper.textContent =
    "Backfill fills in missing UTC timestamps so events display correctly across timezones and DST.";

  const controls = document.createElement("div");
  controls.className = "timezone-maintenance__controls";

  const chunkWrapper = document.createElement("label");
  chunkWrapper.className = "timezone-maintenance__field";
  chunkWrapper.textContent = "Chunk size";
  const chunkInput = document.createElement("input");
  chunkInput.type = "number";
  chunkInput.min = String(MIN_CHUNK_SIZE);
  chunkInput.max = String(MAX_CHUNK_SIZE);
  chunkInput.step = "100";
  chunkInput.value = String(DEFAULT_CHUNK_SIZE);
  chunkInput.className = "timezone-maintenance__input";
  chunkWrapper.append(chunkInput);

  const dryRunWrapper = document.createElement("label");
  dryRunWrapper.className = "timezone-maintenance__checkbox";
  const dryRunInput = document.createElement("input");
  dryRunInput.type = "checkbox";
  dryRunInput.className = "timezone-maintenance__checkbox-input";
  dryRunWrapper.append(dryRunInput, document.createTextNode(" Dry-run (no changes)"));

  const tzWrapper = document.createElement("label");
  tzWrapper.className = "timezone-maintenance__field";
  tzWrapper.textContent = "Default timezone";
  const timezoneSelect = buildTimezoneSelect();
  tzWrapper.append(timezoneSelect);
  if (timezoneSelect.options.length <= 1) {
    const timezoneHint = document.createElement("p");
    timezoneHint.className = "timezone-maintenance__hint";
    timezoneHint.textContent =
      "Timezone list unavailable in this browser. The stored household timezone will be used unless you override it via the CLI.";
    tzWrapper.append(timezoneHint);
  }

  controls.append(chunkWrapper, dryRunWrapper, tzWrapper);

  const actions = document.createElement("div");
  actions.className = "timezone-maintenance__actions";

  const startButton = createButton({
    label: "Start Backfill",
    variant: "primary",
    className: "timezone-maintenance__start",
  });

  const cancelButton = createButton({
    label: "Cancel",
    variant: "ghost",
    className: "timezone-maintenance__cancel",
  });
  cancelButton.hidden = true;

  actions.append(startButton, cancelButton);

  const statusMessage = document.createElement("p");
  statusMessage.className = "timezone-maintenance__status";
  statusMessage.setAttribute("role", "status");
  statusMessage.setAttribute("aria-live", "polite");

  const summaryContainer = document.createElement("div");
  summaryContainer.className = "timezone-maintenance__summary";
  summaryContainer.hidden = true;
  const summaryList = document.createElement("dl");
  summaryList.className = "timezone-maintenance__summary-list";
  summaryContainer.append(summaryList);

  section.append(heading, helper, controls, actions, statusMessage, summaryContainer);

  type Unlisten = () => void | Promise<void>;

  let unlisten: Unlisten | undefined;
  let householdId: string | undefined;
  let lastRender = 0;
  const state: ComponentState = {
    runState: "idle",
    pending: 0,
    resumeAvailable: false,
    runningExternalHousehold: undefined,
    cancelPending: false,
  };

  function setPending(pending: number): void {
    state.pending = pending;
  }

  function setResumeAvailable(checkpoint?: BackfillStatusReport["checkpoint"]): void {
    state.resumeAvailable = Boolean(checkpoint && checkpoint.remaining > 0);
  }

  function updateSummary(summary?: BackfillSummary): void {
    if (!summary) {
      summaryContainer.hidden = true;
      summaryList.textContent = "";
      return;
    }
    summaryList.textContent = "";

    const items: Array<[string, string]> = [
      ["Status", summary.status === "completed" ? "Completed" : summary.status === "cancelled" ? "Cancelled" : "Failed"],
      ["Scanned", formatNumber(summary.total_scanned)],
      ["Updated", formatNumber(summary.total_updated)],
      ["Skipped", formatNumber(summary.total_skipped)],
      ["Elapsed", `${(summary.elapsed_ms / 1000).toFixed(2)}s`],
    ];
    for (const [label, value] of items) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      summaryList.append(dt, dd);
    }
    summaryContainer.hidden = false;
  }

  function updateButtons(): void {
    const isRunning = state.runState === "running";
    const hasExternalRun = Boolean(state.runningExternalHousehold);
    startButton.update({
      disabled:
        isRunning ||
        hasExternalRun ||
        (state.pending === 0 && !state.resumeAvailable && !state.progress),
      label: state.resumeAvailable && state.runState !== "running" ? "Resume Backfill" : "Start Backfill",
    });
    cancelButton.hidden = !isRunning;
    cancelButton.disabled = state.cancelPending;
    chunkInput.disabled = isRunning;
    timezoneSelect.disabled = isRunning;
    dryRunInput.disabled = isRunning;
  }

  function buildStatusMessage(): string {
    if (state.runningExternalHousehold) {
      return `Timezone backfill is already running for household ${state.runningExternalHousehold}. Please wait for it to finish.`;
    }
    switch (state.runState) {
      case "running": {
        if (state.progress) {
          const { scanned, updated, skipped } = state.progress;
          return `Processing… scanned ${formatNumber(scanned)}, updated ${formatNumber(updated)}, skipped ${formatNumber(skipped)}. This can be paused safely.`;
        }
        return state.cancelPending
          ? "Stopping after the current step…"
          : "Preparing backfill run…";
      }
      case "completed": {
        if (state.summary) {
          return `Backfill finished. Updated ${formatNumber(state.summary.total_updated)} events. ${formatNumber(state.summary.total_skipped)} skipped. View details.`;
        }
        return "Backfill finished.";
      }
      case "cancelled":
        return "Backfill paused after finishing the current step. You can resume later.";
      case "error":
        return state.errorMessage ?? "Backfill couldn’t continue. No partial changes beyond completed steps.";
      case "idle":
      default: {
        if (state.pending === 0 && !state.resumeAvailable) {
          return "No backfill needed.";
        }
        return `Pending events ready for backfill: ${formatNumber(state.pending)}.`;
      }
    }
  }

  function updateStatus(): void {
    statusMessage.textContent = buildStatusMessage();
    updateButtons();
  }

  function applyProgress(progress: BackfillProgressEvent): void {
    const now = performance.now();
    state.progress = progress;
    state.runState = "running";
    if (now - lastRender > PROGRESS_THROTTLE_MS) {
      updateStatus();
      lastRender = now;
    }
  }

  async function refreshStatus(): Promise<void> {
    if (!householdId) return;
    try {
      const status = await fetchBackfillStatus(householdId);
      setPending(status.pending);
      setResumeAvailable(status.checkpoint ?? undefined);
      state.runningExternalHousehold =
        status.running && status.running !== householdId ? status.running : undefined;
      if (status.running && status.running === householdId) {
        state.runState = "running";
      } else if (state.runState === "running" && !status.running) {
        state.runState = "idle";
        state.progress = undefined;
      }
      updateStatus();
    } catch (err) {
      state.errorMessage = (err as Error).message;
      state.runState = "error";
      updateStatus();
    }
  }

  async function handleSummary(event: BackfillSummaryEvent): Promise<void> {
    state.cancelPending = false;
    if (event.status === "failed") {
      state.runState = "error";
      state.errorMessage = event.error?.message ?? "Backfill couldn’t continue.";
      state.summary = undefined;
    } else {
      state.runState = event.status === "cancelled" ? "cancelled" : "completed";
      if (event.household_id) {
        state.summary = {
          household_id: event.household_id,
          total_scanned: event.scanned ?? 0,
          total_updated: event.updated ?? 0,
          total_skipped: event.skipped ?? 0,
          elapsed_ms: event.elapsed_ms ?? 0,
          status: event.status,
        };
        updateSummary(state.summary);
      }
      state.progress = undefined;
    }
    await refreshStatus();
    updateStatus();
    if (state.runState === "completed") {
      startButton.focus();
    }
  }

  function handleEvent(event: BackfillEvent): void {
    if (event.type === "progress") {
      if (!householdId || event.household_id !== householdId) return;
      applyProgress(event);
    } else if (event.type === "summary") {
      if (event.household_id && householdId && event.household_id !== householdId) {
        // ignore summaries from other households
        return;
      }
      void handleSummary(event);
    }
  }

  startButton.addEventListener("click", async () => {
    if (!householdId) return;
    if (state.runningExternalHousehold) return;
    const chunkSizeValue = Math.round(Number(chunkInput.value));
    if (
      !Number.isFinite(chunkSizeValue) ||
      chunkSizeValue < MIN_CHUNK_SIZE ||
      chunkSizeValue > MAX_CHUNK_SIZE
    ) {
      state.runState = "error";
      state.errorMessage = `Chunk size must be between ${MIN_CHUNK_SIZE} and ${MAX_CHUNK_SIZE}.`;
      updateStatus();
      return;
    }
    chunkInput.value = String(chunkSizeValue);
    state.runState = "running";
    state.errorMessage = undefined;
    state.summary = undefined;
    state.progress = undefined;
    state.cancelPending = false;
    updateSummary(undefined);
    updateStatus();
    try {
      await startBackfill({
        householdId,
        dryRun: dryRunInput.checked,
        chunkSize: chunkSizeValue,
        defaultTimezone: timezoneSelect.value || undefined,
        resume: state.resumeAvailable,
      });
    } catch (err) {
      const error = err as { message?: string; code?: string };
      state.runState = "error";
      state.errorMessage = error.message ?? "Backfill couldn’t continue.";
      updateStatus();
    }
  });

  cancelButton.addEventListener("click", async () => {
    state.cancelPending = true;
    updateStatus();
    try {
      await cancelBackfill();
    } catch (err) {
      state.cancelPending = false;
      state.errorMessage = (err as Error).message;
      state.runState = "error";
      updateStatus();
    }
  });

  void (async () => {
    householdId = await defaultHouseholdId();
    await refreshStatus();
    unlisten = await listenBackfillEvents(handleEvent);
  })();

  return {
    element: section,
    destroy: () => {
      if (typeof unlisten === "function") {
        void unlisten();
      }
    },
  };
}
