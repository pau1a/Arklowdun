import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { fetchAboutMetadata, fetchDiagnosticsSummary, openDiagnosticsDoc } from "./api/diagnostics";
import { createEmptyState } from "./ui/emptyState";
import { STR } from "./ui/strings";

export function SettingsView(container: HTMLElement) {
  const section = document.createElement("section");
  section.className = "settings"; // allow other modules to locate settings root
  section.innerHTML = `
    <a href="#" class="settings__back">Back to dashboard</a>
    <h2 class="settings__title">Settings</h2>

    <section class="card settings__section" aria-labelledby="settings-general">
      <h3 id="settings-general">General</h3>
      <div class="settings__empty"></div>
    </section>

    <section class="card settings__section" aria-labelledby="settings-storage">
      <h3 id="settings-storage">Storage and permissions</h3>
      <div class="settings__empty"></div>
    </section>

    <section class="card settings__section" aria-labelledby="settings-notifications">
      <h3 id="settings-notifications">Notifications</h3>
      <div class="settings__empty"></div>
    </section>

    <section class="card settings__section" aria-labelledby="settings-appearance">
      <h3 id="settings-appearance">Appearance</h3>
      <div class="settings__empty"></div>
    </section>

    <section class="card settings__section" aria-labelledby="settings-about">
      <h3 id="settings-about">About and diagnostics</h3>
      <div class="settings__body settings__body--about">
        <dl class="settings__meta">
          <div class="settings__meta-item">
            <dt>Version</dt>
            <dd data-settings-version>Loading…</dd>
          </div>
          <div class="settings__meta-item">
            <dt>Commit</dt>
            <dd><span data-settings-commit title="Loading…">Loading…</span></dd>
          </div>
        </dl>
        <p class="settings__note">
          Copying diagnostics only captures the quick summary: platform, app version, commit hash, the active RUST_LOG value, and the last
          200 lines from the rotating log file.
        </p>
        <div class="settings__actions">
          <button type="button" class="settings__button" data-copy-diagnostics>
            Copy diagnostics summary
          </button>
          <button type="button" class="settings__link" data-open-diagnostics-doc>Help → Diagnostics guide</button>
        </div>
        <div class="settings__status" data-settings-status role="status" aria-live="polite"></div>
        <pre class="settings__preview" data-diagnostics-preview hidden aria-label="Latest copied diagnostics summary"></pre>
      </div>
    </section>
  `;

  container.innerHTML = "";
  container.appendChild(section);

  section
    .querySelectorAll<HTMLElement>(".settings__empty")
    .forEach((el) => el.appendChild(createEmptyState({ title: STR.empty.settingsTitle })));

  section
    .querySelector<HTMLAnchorElement>(".settings__back")
    ?.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelector<HTMLAnchorElement>("#nav-dashboard")?.click();
    });

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
