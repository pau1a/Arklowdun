import createButton from "@ui/Button";
import createErrorBanner from "@ui/ErrorBanner";
import { toast } from "@ui/Toast";
import { recoveryText } from "@strings/recovery";

import type { ImportMode } from "@bindings/ImportMode";
import type { ImportPlan } from "@bindings/ImportPlan";
import type { ValidationReport } from "@bindings/ValidationReport";
import type { ExecutionReport } from "@bindings/ExecutionReport";
import type { ImportPreviewDto } from "@bindings/ImportPreviewDto";
import type { AttachmentsPlan } from "@bindings/AttachmentsPlan";
import type { AttachmentExecutionSummary } from "@bindings/AttachmentExecutionSummary";
import { previewImport, executeImport } from "../api/import";
import { openDirectoryDialog } from "../api/dialog";

export interface ImportViewInstance {
  element: HTMLElement;
}

const numberFormatter = new Intl.NumberFormat();
type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractReportPath(record: UnknownRecord): string | null {
  const direct = record.report_path ?? record.reportPath;
  return typeof direct === "string" && direct.length > 0 ? direct : null;
}

function findReportPath(error: unknown): string | null {
  if (!isRecord(error)) return null;

  const direct = extractReportPath(error);
  if (direct) return direct;

  if ("context" in error && isRecord(error.context)) {
    const fromContext = extractReportPath(error.context);
    if (fromContext) return fromContext;
  }

  if ("cause" in error && error.cause !== undefined) {
    const fromCause = findReportPath(error.cause);
    if (fromCause) return fromCause;
  }

  return null;
}

function extractErrorDetail(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;

  const details: string[] = [];
  if (typeof error.code === "string" && error.code.trim().length > 0) {
    details.push(
      recoveryText("db.import.error.detail_code", { code: error.code }),
    );
  }

  if ("context" in error && isRecord(error.context)) {
    const contextEntries = Object.entries(error.context).filter(([key]) =>
      key !== "stack" && key !== "report_path" && key !== "reportPath",
    );
    if (contextEntries.length > 0) {
      const formatted = contextEntries
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join("\n");
      details.push(
        recoveryText("db.import.error.detail_context", { context: formatted }),
      );
    }
    const stackValue = error.context.stack;
    if (typeof stackValue === "string" && stackValue.trim().length > 0) {
      details.push(
        recoveryText("db.import.error.detail_stack", {
          stack: stackValue.trim(),
        }),
      );
    }
  }

  if ("cause" in error && error.cause !== undefined) {
    const causeMessage = describeError(error.cause);
    const unknown = recoveryText("db.common.unknown_error");
    if (causeMessage.trim().length > 0 && causeMessage !== unknown) {
      details.push(
        recoveryText("db.import.error.detail_cause", { message: causeMessage }),
      );
    }
  }

  if (details.length === 0) return undefined;
  return details.join("\n\n");
}

function parseErrorInfo(error: unknown): {
  message: string;
  detail?: string;
  reportPath: string | null;
} {
  return {
    message: describeError(error),
    detail: extractErrorDetail(error),
    reportPath: findReportPath(error),
  };
}

function resolveByteUnit(index: number): string {
  switch (index) {
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
}

function formatBytes(value: number | bigint): string {
  const numeric = typeof value === "bigint" ? Number(value) : value;
  if (numeric < 1024) {
    return recoveryText("db.backup.format.value_unit", {
      value: numberFormatter.format(numeric),
      unit: resolveByteUnit(0),
    });
  }
  let size = numeric;
  let unitIndex = 1;
  while (size >= 1024 && unitIndex < 4) {
    size /= 1024;
    unitIndex += 1;
  }
  const unitLabel = resolveByteUnit(unitIndex);
  const formatted = size >= 10
    ? numberFormatter.format(Math.round(size))
    : size.toFixed(1);
  return recoveryText("db.backup.format.value_unit", {
    value: formatted,
    unit: unitLabel,
  });
}

function describeError(error: unknown): string {
  if (!error) return recoveryText("db.common.unknown_error");
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const record = error as { message?: unknown; code?: unknown };
    const code = typeof record.code === "string" ? record.code : null;
    if (code === "DB_IMPORT/VERSION") {
      return recoveryText("db.import.error.version");
    }
    if ("message" in record) {
      const text = String(record.message ?? "");
      if (text.trim().length) return text;
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return recoveryText("db.common.unknown_error");
  }
}

function summarizeTablePlan(plan: ImportPlan): {
  adds: number;
  updates: number;
  skips: number;
} {
  const totals = { adds: 0, updates: 0, skips: 0 };
  for (const stats of Object.values(plan.tables)) {
    if (!stats) continue;
    totals.adds += Number(stats.adds ?? 0);
    totals.updates += Number(stats.updates ?? 0);
    totals.skips += Number(stats.skips ?? 0);
  }
  return totals;
}

function summarizeExecution(report: ExecutionReport): {
  adds: number;
  updates: number;
  skips: number;
} {
  const totals = { adds: 0, updates: 0, skips: 0 };
  for (const stats of Object.values(report.tables)) {
    if (!stats) continue;
    totals.adds += Number(stats.adds ?? 0);
    totals.updates += Number(stats.updates ?? 0);
    totals.skips += Number(stats.skips ?? 0);
  }
  return totals;
}

function renderAttachmentsSummary(
  container: HTMLElement,
  plan: AttachmentsPlan,
  execution?: AttachmentExecutionSummary,
) {
  container.innerHTML = "";
  const heading = document.createElement("h4");
  heading.textContent = recoveryText("db.import.summary.attachments");
  heading.className = "import__subheading";

  const summary = document.createElement("p");
  summary.className = "import__summary-line";
  summary.textContent = recoveryText("db.import.summary.attachments_line", {
    adds: numberFormatter.format(plan.adds),
    updates: numberFormatter.format(plan.updates),
    skips: numberFormatter.format(plan.skips),
  });

  const frag = document.createDocumentFragment();
  frag.append(heading, summary);

  if (execution) {
    const executionLine = document.createElement("p");
    executionLine.className = "import__summary-line";
    executionLine.textContent = recoveryText(
      "db.import.summary.attachments_applied",
      {
        adds: numberFormatter.format(execution.adds),
        updates: numberFormatter.format(execution.updates),
        skips: numberFormatter.format(execution.skips),
      },
    );
    frag.append(executionLine);
  }

  if (plan.conflicts.length > 0) {
    const listHeading = document.createElement("p");
    listHeading.className = "import__summary-line";
    listHeading.textContent = recoveryText(
      "db.import.summary.attachments_conflicts",
      {
        count: String(plan.conflicts.length),
      },
    );

    const list = document.createElement("ul");
    list.className = "import__conflicts";
    for (const conflict of plan.conflicts) {
      const item = document.createElement("li");
      const details: string[] = [
        recoveryText("db.import.summary.attachments_conflict_detail", {
          path: conflict.relativePath,
          reason: conflict.reason,
        }),
      ];
      const stampParts: string[] = [];
      if (conflict.bundleUpdatedAt !== null) {
        stampParts.push(
          recoveryText(
            "db.import.summary.attachments_conflict_bundle",
            { timestamp: conflict.bundleUpdatedAt },
          ),
        );
      }
      if (conflict.liveUpdatedAt !== null) {
        stampParts.push(
          recoveryText("db.import.summary.attachments_conflict_live", {
            timestamp: conflict.liveUpdatedAt,
          }),
        );
      }
      if (stampParts.length > 0) {
        details.push(
          recoveryText(
            "db.import.summary.attachments_conflict_timestamps",
            { details: stampParts.join(" vs ") },
          ),
        );
      }
      item.textContent = details.join(" — ");
      list.appendChild(item);
    }
    frag.append(listHeading, list);
  }

  container.appendChild(frag);
}

function renderPlanTables(
  container: HTMLElement,
  plan: ImportPlan,
  execution?: ExecutionReport,
) {
  container.innerHTML = "";
  const heading = document.createElement("h4");
  heading.textContent = recoveryText("db.import.summary.tables");
  heading.className = "import__subheading";

  const table = document.createElement("table");
  table.className = "import__plan-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  [
    recoveryText("db.import.summary.tables_headers.table"),
    recoveryText("db.import.summary.tables_headers.adds"),
    recoveryText("db.import.summary.tables_headers.updates"),
    recoveryText("db.import.summary.tables_headers.skips"),
    recoveryText("db.import.summary.tables_headers.conflicts"),
  ].forEach((label) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  for (const [name, stats] of Object.entries(plan.tables)) {
    if (!stats) continue;
    const row = document.createElement("tr");

    const nameCell = document.createElement("th");
    nameCell.scope = "row";
    nameCell.textContent = name;
    row.appendChild(nameCell);

    const addsCell = document.createElement("td");
    addsCell.textContent = numberFormatter.format(stats.adds);
    row.appendChild(addsCell);

    const updatesCell = document.createElement("td");
    updatesCell.textContent = numberFormatter.format(stats.updates);
    row.appendChild(updatesCell);

    const skipsCell = document.createElement("td");
    skipsCell.textContent = numberFormatter.format(stats.skips);
    row.appendChild(skipsCell);

    const conflictsCell = document.createElement("td");
    conflictsCell.textContent = numberFormatter.format(stats.conflicts.length);
    if (stats.conflicts.length > 0) {
      conflictsCell.classList.add("import__plan-conflict");
    }
    row.appendChild(conflictsCell);

    if (execution) {
      const exec = execution.tables[name];
      if (exec) {
        row.dataset.executionAdds = numberFormatter.format(exec.adds);
        row.dataset.executionUpdates = numberFormatter.format(exec.updates);
        row.dataset.executionSkips = numberFormatter.format(exec.skips);
      }
    }

    tbody.appendChild(row);

    if (stats.conflicts.length > 0) {
      const conflictsRow = document.createElement("tr");
      conflictsRow.className = "import__plan-conflicts-row";
      const cell = document.createElement("td");
      cell.colSpan = 5;
      const list = document.createElement("ul");
      list.className = "import__conflicts";
      for (const conflict of stats.conflicts) {
        const item = document.createElement("li");
        const bundleTs = conflict.bundleUpdatedAt ?? null;
        const liveTs = conflict.liveUpdatedAt ?? null;
        const bundleLabel =
          bundleTs !== null
            ? new Date(bundleTs).toLocaleString()
            : recoveryText("db.import.summary.conflict_unknown");
        const liveLabel =
          liveTs !== null
            ? new Date(liveTs).toLocaleString()
            : recoveryText("db.import.summary.conflict_unknown");
        item.textContent = recoveryText(
          "db.import.summary.tables_conflict_detail",
          { id: conflict.id, bundle: bundleLabel, live: liveLabel },
        );
        list.appendChild(item);
      }
      cell.appendChild(list);
      conflictsRow.appendChild(cell);
      tbody.appendChild(conflictsRow);
    }
  }

  table.append(thead, tbody);

  container.append(heading, table);

  if (execution) {
    const totals = summarizeExecution(execution);
    const summary = document.createElement("p");
    summary.className = "import__summary-line";
    summary.textContent = recoveryText("db.import.summary.tables_applied", {
      adds: numberFormatter.format(totals.adds),
      updates: numberFormatter.format(totals.updates),
      skips: numberFormatter.format(totals.skips),
    });
    container.appendChild(summary);
  } else {
    const totals = summarizeTablePlan(plan);
    const summary = document.createElement("p");
    summary.className = "import__summary-line";
    summary.textContent = recoveryText("db.import.summary.tables_planned", {
      adds: numberFormatter.format(totals.adds),
      updates: numberFormatter.format(totals.updates),
      skips: numberFormatter.format(totals.skips),
    });
    container.appendChild(summary);
  }
}

function renderValidationSummary(container: HTMLElement, report: ValidationReport) {
  container.innerHTML = "";
  const heading = document.createElement("h4");
  heading.textContent = recoveryText("db.import.summary.validation");
  heading.className = "import__subheading";

  const bundleSize = document.createElement("p");
  bundleSize.className = "import__summary-line";
  bundleSize.textContent = recoveryText(
    "db.import.summary.validation_bundle_size",
    { size: formatBytes(report.bundleSizeBytes) },
  );

  const dataFiles = document.createElement("p");
  dataFiles.className = "import__summary-line";
  dataFiles.textContent = recoveryText(
    "db.import.summary.validation_data_files",
    { count: numberFormatter.format(report.dataFilesVerified) },
  );

  const attachments = document.createElement("p");
  attachments.className = "import__summary-line";
  attachments.textContent = recoveryText(
    "db.import.summary.validation_attachments",
    { count: numberFormatter.format(report.attachmentsVerified) },
  );

  container.append(heading, bundleSize, dataFiles, attachments);
}

export function createImportView(): ImportViewInstance {
  const section = document.createElement("section");
  section.className = "card settings__section settings__section--import";
  section.setAttribute("aria-labelledby", "settings-import");

  const heading = document.createElement("h3");
  heading.id = "settings-import";
  heading.textContent = recoveryText("db.import.section.title");

  const helper = document.createElement("p");
  helper.className = "settings__helper import__helper";
  helper.textContent = recoveryText("db.import.section.helper");

  const modeGroup = document.createElement("div");
  modeGroup.className = "import__mode";

  const mergeLabel = document.createElement("label");
  const mergeRadio = document.createElement("input");
  mergeRadio.type = "radio";
  mergeRadio.name = "import-mode";
  mergeRadio.value = "merge";
  mergeRadio.checked = true;
  mergeLabel.append(
    mergeRadio,
    document.createTextNode(` ${recoveryText("db.import.mode.merge")}`),
  );

  const replaceLabel = document.createElement("label");
  const replaceRadio = document.createElement("input");
  replaceRadio.type = "radio";
  replaceRadio.name = "import-mode";
  replaceRadio.value = "replace";
  replaceLabel.append(
    replaceRadio,
    document.createTextNode(` ${recoveryText("db.import.mode.replace")}`),
  );

  modeGroup.append(mergeLabel, replaceLabel);

  const controls = document.createElement("div");
  controls.className = "import__controls";

  const chooseButton = createButton({
    label: recoveryText("db.import.button.choose"),
    variant: "ghost",
  });
  const previewButton = createButton({
    label: recoveryText("db.import.button.preview"),
    variant: "ghost",
  });
  const importButton = createButton({
    label: recoveryText("db.import.button.import"),
    variant: "primary",
  });
  previewButton.disabled = true;
  importButton.disabled = true;

  const errorBanner = createErrorBanner({
    message: recoveryText("db.import.error.banner"),
  });
  errorBanner.classList.add("import__error");
  errorBanner.hidden = true;

  const status = document.createElement("p");
  status.className = "import__status";
  status.textContent = recoveryText("db.import.status.none");

  const validationSummary = document.createElement("div");
  validationSummary.className = "import__summary";
  validationSummary.hidden = true;

  const planContainer = document.createElement("div");
  planContainer.className = "import__plan";
  planContainer.hidden = true;

  const attachmentsSummary = document.createElement("div");
  attachmentsSummary.className = "import__attachments";
  attachmentsSummary.hidden = true;

  const reportContainer = document.createElement("div");
  reportContainer.className = "import__report";
  reportContainer.hidden = true;

  const reportText = document.createElement("p");
  reportText.className = "import__summary-line";

  const revealButton = createButton({
    label: recoveryText("db.import.report.reveal"),
    variant: "ghost",
  });
  revealButton.disabled = true;

  reportContainer.append(reportText, revealButton);

  controls.append(chooseButton, previewButton, importButton);
  section.append(
    heading,
    helper,
    modeGroup,
    controls,
    errorBanner,
    status,
    validationSummary,
    planContainer,
    attachmentsSummary,
    reportContainer,
  );

  let selectedPath: string | null = null;
  let currentMode: ImportMode = "merge";
  let lastPreview: ImportPreviewDto | null = null;
  let lastReportPath: string | null = null;
  let busy = false;

  function setBusy(value: boolean) {
    busy = value;
    chooseButton.disabled = value;
    previewButton.disabled = value || !selectedPath;
    importButton.disabled = value || !lastPreview;
    mergeRadio.disabled = value;
    replaceRadio.disabled = value;
    revealButton.disabled = value || !lastReportPath;
  }
  const clearReport = () => {
    lastReportPath = null;
    reportText.textContent = "";
    reportContainer.hidden = true;
    revealButton.disabled = true;
  };

  const showReport = (path: string, outcome: "success" | "failure") => {
    lastReportPath = path;
    reportText.textContent =
      outcome === "failure"
        ? recoveryText("db.common.report_saved_failure", { path })
        : recoveryText("db.common.report_saved", { path });
    reportContainer.hidden = false;
    revealButton.disabled = false;
  };

  const hideError = () => {
    errorBanner.hidden = true;
    errorBanner.update({ detail: "" });
  };

  const showError = (error: unknown) => {
    const info = parseErrorInfo(error);
    errorBanner.update({
      message: info.message,
      detail: info.detail ?? "",
      onDismiss: hideError,
    });
    errorBanner.hidden = false;
    status.textContent = info.message;
    if (info.reportPath) {
      showReport(info.reportPath, "failure");
    }
    toast.show({ kind: "error", message: info.message });
  };

  errorBanner.update({ onDismiss: hideError });

  mergeRadio.addEventListener("change", () => {
    if (mergeRadio.checked) {
      currentMode = "merge";
    }
  });

  replaceRadio.addEventListener("change", () => {
    if (replaceRadio.checked) {
      currentMode = "replace";
    }
  });

  chooseButton.onclick = async () => {
    if (busy) return;
    try {
      const selected = await openDirectoryDialog();
      if (typeof selected === "string" && selected.length > 0) {
        selectedPath = selected;
        status.textContent = recoveryText("db.import.status.selected", {
          path: selected,
        });
        previewButton.disabled = false;
        validationSummary.hidden = true;
        planContainer.hidden = true;
        attachmentsSummary.hidden = true;
        lastPreview = null;
        importButton.disabled = true;
        hideError();
        clearReport();
      }
    } catch {
      // ignore cancel
    }
  };

  previewButton.onclick = async () => {
    if (!selectedPath || busy) return;
    setBusy(true);
    status.textContent = recoveryText("db.import.status.planning");
    validationSummary.hidden = true;
    planContainer.hidden = true;
    attachmentsSummary.hidden = true;
    hideError();
    clearReport();
    try {
      const preview = await previewImport(selectedPath, currentMode);
      lastPreview = preview;
      renderValidationSummary(validationSummary, preview.validation);
      validationSummary.hidden = false;
      renderPlanTables(planContainer, preview.plan);
      planContainer.hidden = false;
      renderAttachmentsSummary(attachmentsSummary, preview.plan.attachments);
      attachmentsSummary.hidden = false;
      status.textContent = recoveryText("db.import.status.ready");
      importButton.disabled = false;
      toast.show({
        kind: "success",
        message: recoveryText("db.import.toast.dry_run"),
      });
    } catch (error) {
      clearReport();
      showError(error);
      lastPreview = null;
      importButton.disabled = true;
    } finally {
      setBusy(false);
    }
  };

  importButton.onclick = async () => {
    if (!selectedPath || !lastPreview || busy) return;
    setBusy(true);
    status.textContent = recoveryText("db.import.status.executing");
    hideError();
    clearReport();
    try {
      const result = await executeImport(selectedPath, currentMode, lastPreview.planDigest);
      lastPreview = {
        bundlePath: result.bundlePath,
        mode: result.mode,
        validation: result.validation,
        plan: result.plan,
        planDigest: result.planDigest,
      };
      renderValidationSummary(validationSummary, result.validation);
      validationSummary.hidden = false;
      renderPlanTables(planContainer, result.plan, result.execution);
      planContainer.hidden = false;
      renderAttachmentsSummary(
        attachmentsSummary,
        result.plan.attachments,
        result.execution.attachments,
      );
      attachmentsSummary.hidden = false;
      status.textContent = recoveryText("db.import.status.success");
      toast.show({
        kind: "success",
        message: recoveryText("db.import.toast.success"),
      });
      showReport(result.reportPath, "success");
      hideError();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  revealButton.onclick = async () => {
    if (!lastReportPath) return;
    try {
      const { revealPath } = await import("@lib/ipc/opener");
      const ok = await revealPath(lastReportPath);
      if (!ok) {
        await navigator.clipboard?.writeText?.(lastReportPath);
        toast.show({
          kind: "info",
          message: recoveryText("db.import.toast.report_copied"),
        });
      }
    } catch {
      // ignore
    }
  };

  return { element: section };
}

export default createImportView;
