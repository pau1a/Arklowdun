import { writeText } from "@lib/ipc/clipboard";
import {
  fetchAboutMetadata,
  fetchDiagnosticsSummary,
  openDiagnosticsDoc,
  SettingsPanel,
  useSettings,
} from "@features/settings";
import { createTimezoneMaintenanceSection } from "@features/settings/components/TimezoneMaintenanceSection";
import { createBackupView } from "@features/settings/components/BackupView";
import { createRepairView } from "@features/settings/components/RepairView";
import { createEmptyState } from "./ui/EmptyState";
import { STR } from "./ui/strings";
import createButton from "@ui/Button";

export function SettingsView(container: HTMLElement) {
  const panel = SettingsPanel();
  const section = panel.element; // allow other modules to locate settings root

  const backButton = createButton({
    label: "Back to dashboard",
    variant: "ghost",
    className: "settings__back",
    type: "button",
    onClick: (event) => {
      event.preventDefault();
      document.querySelector<HTMLAnchorElement>("#nav-dashboard")?.click();
    },
  });

  const title = document.createElement("h2");
  title.className = "settings__title";
  title.textContent = "Settings";

  const createEmptySection = (id: string, headingText: string): HTMLElement => {
    const panel = document.createElement("section");
    panel.className = "card settings__section";
    panel.setAttribute("aria-labelledby", id);

    const heading = document.createElement("h3");
    heading.id = id;
    heading.textContent = headingText;

    const empty = document.createElement("div");
    empty.className = "settings__empty";

    panel.append(heading, empty);
    return panel;
  };

  const timezoneMaintenance = createTimezoneMaintenanceSection();
  const backups = createBackupView();
  const repair = createRepairView();
  const general = createEmptySection("settings-general", "General");
  const storage = createEmptySection("settings-storage", "Storage and permissions");
  const notifications = createEmptySection("settings-notifications", "Notifications");
  const appearance = createEmptySection("settings-appearance", "Appearance");

  const about = document.createElement("section");
  about.className = "card settings__section";
  about.setAttribute("aria-labelledby", "settings-about");

  const aboutHeading = document.createElement("h3");
  aboutHeading.id = "settings-about";
  aboutHeading.textContent = "About and diagnostics";

  const aboutBody = document.createElement("div");
  aboutBody.className = "settings__body settings__body--about";

  const metaList = document.createElement("dl");
  metaList.className = "settings__meta";

  const versionItem = document.createElement("div");
  versionItem.className = "settings__meta-item";
  const versionTerm = document.createElement("dt");
  versionTerm.textContent = "Version";
  const versionValue = document.createElement("dd");
  versionValue.dataset.settingsVersion = "";
  versionValue.textContent = "Loading…";
  versionItem.append(versionTerm, versionValue);

  const commitItem = document.createElement("div");
  commitItem.className = "settings__meta-item";
  const commitTerm = document.createElement("dt");
  commitTerm.textContent = "Commit";
  const commitValue = document.createElement("dd");
  const commitSpan = document.createElement("span");
  commitSpan.dataset.settingsCommit = "";
  commitSpan.title = "Loading…";
  commitSpan.textContent = "Loading…";
  commitValue.appendChild(commitSpan);
  commitItem.append(commitTerm, commitValue);

  metaList.append(versionItem, commitItem);

  const note = document.createElement("p");
  note.className = "settings__note";
  note.textContent =
    "Copying diagnostics only captures the quick summary: platform, app version, commit hash, the active RUST_LOG value, and the last 200 lines from the rotating log file.";

  const actions = document.createElement("div");
  actions.className = "settings__actions";

  const copyButton = createButton({
    label: "Copy diagnostics summary",
    variant: "primary",
    className: "settings__button",
    type: "button",
  });
  copyButton.dataset.copyDiagnostics = "";

  const helpButton = createButton({
    label: "Help → Diagnostics guide",
    variant: "ghost",
    className: "settings__link",
    type: "button",
  });
  helpButton.dataset.openDiagnosticsDoc = "";

  actions.append(copyButton, helpButton);

  const status = document.createElement("div");
  status.className = "settings__status";
  status.dataset.settingsStatus = "";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const preview = document.createElement("pre");
  preview.className = "settings__preview";
  preview.dataset.diagnosticsPreview = "";
  preview.hidden = true;
  preview.setAttribute("aria-label", "Latest copied diagnostics summary");

  aboutBody.append(metaList, note, actions, status, preview);
  about.append(aboutHeading, aboutBody);

  section.append(
    backButton,
    title,
    timezoneMaintenance.element,
    backups.element,
    repair.element,
    general,
    storage,
    notifications,
    appearance,
    about,
  );

  container.innerHTML = "";
  container.appendChild(section);

  section
    .querySelectorAll<HTMLElement>(".settings__empty")
    .forEach((el) => el.appendChild(createEmptyState({ title: STR.empty.settingsTitle })));

  void useSettings();
  setupAboutAndDiagnostics(section);
}

function describeError(error: unknown): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Unknown error");
  }
  return JSON.stringify(error);
}

function formatSummary(summary: Awaited<ReturnType<typeof fetchDiagnosticsSummary>>): string {
  const rustSource = summary.rustLogSource && summary.rustLogSource !== "RUST_LOG"
    ? `${summary.rustLogSource} → RUST_LOG`
    : "RUST_LOG";
  const rustValue = summary.rustLog ?? "(not set)";
  const lines: string[] = [
    `Platform: ${summary.platform} (${summary.arch})`,
    `App version: ${summary.appVersion}`,
    `Commit: ${summary.commitHash}`,
    `${rustSource}: ${rustValue}`,
    `Log file: ${summary.logPath}${summary.logAvailable ? "" : " (not found)"}`,
  ];

  if (summary.logTail.length) {
    const truncatedNote = summary.logTruncated ? ", truncated to last 200 lines" : "";
    const tailDescriptor = `Log tail (${summary.logLinesReturned} line${summary.logLinesReturned === 1 ? "" : "s"}${truncatedNote})`;
    lines.push(tailDescriptor, "");
    lines.push(...summary.logTail);
  } else {
    lines.push("Log tail: <no log lines available>");
  }

  return lines.join("\n");
}

async function copyToClipboard(text: string) {
  try {
    await writeText(text);
    return;
  } catch (_) {
    // fall back to the Web Clipboard API and, if needed, a hidden textarea for environments
    // (like unit tests) where the plugin is not available.
  }

  try {
    await navigator?.clipboard?.writeText?.(text);
    return;
  } catch (_) {
    // fall through to the hidden textarea approach.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const successful = document.execCommand("copy");
  textarea.remove();
  if (!successful) {
    throw new Error("Clipboard copy was blocked. Copy the summary from the preview.");
  }
}

async function setupAboutAndDiagnostics(root: HTMLElement) {
  const container = root.querySelector<HTMLElement>(".settings__body--about");
  if (!container) return;

  const versionEl = container.querySelector<HTMLElement>("[data-settings-version]");
  const commitEl = container.querySelector<HTMLElement>("[data-settings-commit]");
  const statusEl = container.querySelector<HTMLElement>("[data-settings-status]");
  const previewEl = container.querySelector<HTMLPreElement>("[data-diagnostics-preview]");
  const copyButton = container.querySelector<HTMLButtonElement>("[data-copy-diagnostics]");
  const helpLink = container.querySelector<HTMLElement>("[data-open-diagnostics-doc]");

  try {
    const meta = await fetchAboutMetadata();
    if (versionEl) versionEl.textContent = meta.appVersion;
    if (commitEl) {
      const shortHash = meta.commitHash === "unknown" ? meta.commitHash : meta.commitHash.slice(0, 12);
      commitEl.textContent = shortHash;
      commitEl.setAttribute("title", meta.commitHash);
    }
  } catch (error) {
    if (statusEl) statusEl.textContent = `Failed to load version information: ${describeError(error)}`;
  }

  copyButton?.addEventListener("click", async (event) => {
    event.preventDefault();
    if (!statusEl || !previewEl || !copyButton) return;

    copyButton.disabled = true;
    statusEl.textContent = "Collecting diagnostics summary…";
    previewEl.hidden = true;
    try {
      const summary = await fetchDiagnosticsSummary();
      const text = formatSummary(summary);
      await copyToClipboard(text);
      statusEl.textContent = "Diagnostics summary copied. Review before sharing.";
      previewEl.hidden = false;
      previewEl.textContent = text;
    } catch (error) {
      statusEl.textContent = `Failed to copy diagnostics: ${describeError(error)}`;
    } finally {
      copyButton.disabled = false;
    }
  });

  helpLink?.addEventListener("click", async (event) => {
    event.preventDefault();
    if (!statusEl) return;
    statusEl.textContent = "Opening diagnostics guide…";
    try {
      await openDiagnosticsDoc();
      statusEl.textContent = "Diagnostics guide opened in your default viewer.";
    } catch (error) {
      statusEl.textContent = `Failed to open diagnostics guide: ${describeError(error)}`;
    }
  });
}
