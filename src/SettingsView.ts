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
import { createExportView } from "@features/settings/components/ExportView";
import { createImportView } from "@features/settings/components/ImportView";
import { createHardRepairView } from "@features/settings/components/HardRepairView";
import { createEmptyState } from "./ui/EmptyState";
import { STR } from "./ui/strings";
import createButton from "@ui/Button";
import { createAttributionSectionAsync } from "@features/settings/components/AttributionSection";
import { createAmbientBackgroundSection } from "@features/settings/components/AmbientBackgroundSection";
import { defaultHouseholdId } from "./db/household";
import { categoriesRepo } from "./repos";
import {
  getCategories as getCategoryState,
  setCategories as storeCategories,
  subscribe as subscribeToCategories,
  toggleCategory,
  type StoreCategory,
} from "./store/categories";
import { showError } from "./ui/errors";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";
import type { Category } from "./models";

export interface SettingsViewOptions {
  householdId?: string;
  loadCategories?: (householdId: string) => Promise<Category[]>;
  diagnostics?: {
    fetchAboutMetadata?: typeof fetchAboutMetadata;
    fetchDiagnosticsSummary?: typeof fetchDiagnosticsSummary;
    openDiagnosticsDoc?: typeof openDiagnosticsDoc;
  };
  components?: {
    createTimezoneMaintenanceSection?: typeof createTimezoneMaintenanceSection;
    createBackupView?: typeof createBackupView;
    createRepairView?: typeof createRepairView;
    createExportView?: typeof createExportView;
    createImportView?: typeof createImportView;
    createHardRepairView?: typeof createHardRepairView;
    createAmbientBackgroundSection?: typeof createAmbientBackgroundSection;
    createAttributionSectionAsync?: typeof createAttributionSectionAsync;
  };
  useSettingsHook?: typeof useSettings;
}

export function SettingsView(
  container: HTMLElement,
  options: SettingsViewOptions = {},
) {
  runViewCleanups(container);

  const diagnostics = options.diagnostics ?? {};
  const fetchAbout = diagnostics.fetchAboutMetadata ?? fetchAboutMetadata;
  const fetchSummary = diagnostics.fetchDiagnosticsSummary ?? fetchDiagnosticsSummary;
  const openDiagnostics = diagnostics.openDiagnosticsDoc ?? openDiagnosticsDoc;

  const components = options.components ?? {};
  const createTimezoneSection =
    components.createTimezoneMaintenanceSection ?? createTimezoneMaintenanceSection;
  const createBackup = components.createBackupView ?? createBackupView;
  const createRepair = components.createRepairView ?? createRepairView;
  const createExport = components.createExportView ?? createExportView;
  const createImport = components.createImportView ?? createImportView;
  const createHardRepair = components.createHardRepairView ?? createHardRepairView;
  const createAmbient =
    components.createAmbientBackgroundSection ?? createAmbientBackgroundSection;
  const createAttribution =
    components.createAttributionSectionAsync ?? createAttributionSectionAsync;

  const useSettingsFn = options.useSettingsHook ?? useSettings;

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

  const manageCategoriesSection = (): HTMLElement => {
    const panel = document.createElement("section");
    panel.className = "card settings__section";
    panel.setAttribute("aria-labelledby", "settings-manage-categories");

    const heading = document.createElement("h3");
    heading.id = "settings-manage-categories";
    heading.textContent = "Manage categories";

    const body = document.createElement("div");
    body.className = "settings__body";

    const list = document.createElement("div");
    list.className = "settings__categories";

    const visibleGroup = document.createElement("div");
    visibleGroup.className = "settings__categories-group settings__categories-group--visible";
    const visibleHeading = document.createElement("h4");
    visibleHeading.className = "settings__categories-heading";
    visibleHeading.textContent = "Visible categories";
    const visibleList = document.createElement("div");
    visibleList.className = "settings__categories-list";
    visibleGroup.append(visibleHeading, visibleList);

    const hiddenGroup = document.createElement("div");
    hiddenGroup.className = "settings__categories-group settings__categories-group--hidden";
    const hiddenHeading = document.createElement("h4");
    hiddenHeading.className = "settings__categories-heading";
    hiddenHeading.textContent = "Hidden categories";
    const hiddenList = document.createElement("div");
    hiddenList.className = "settings__categories-list";
    hiddenGroup.append(hiddenHeading, hiddenList);

    const emptyMessage = document.createElement("p");
    emptyMessage.className = "settings__empty";
    emptyMessage.textContent = "No categories available.";
    emptyMessage.hidden = true;

    list.append(visibleGroup, hiddenGroup, emptyMessage);
    body.appendChild(list);

    panel.append(heading, body);

    const ensureHouseholdId = (() => {
      let cached = options.householdId;
      let promise: Promise<string> | null = cached ? Promise.resolve(cached) : null;
      return () => {
        if (cached) return Promise.resolve(cached);
        if (!promise) {
          promise = defaultHouseholdId().then((value) => {
            cached = value;
            return value;
          });
        }
        return promise;
      };
    })();

    const renderToggle = (category: StoreCategory): HTMLLabelElement => {
      const item = document.createElement("label");
      item.className = "settings__category-toggle";
      if (!category.isVisible) {
        item.classList.add("settings__category-toggle--hidden");
      }

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = category.isVisible;
      checkbox.setAttribute("aria-label", `Toggle ${category.name}`);

      checkbox.addEventListener("change", () => {
        const nextChecked = checkbox.checked;
        checkbox.disabled = true;
        void (async () => {
          try {
            const householdId = await ensureHouseholdId();
            await toggleCategory(householdId, category.id);
          } catch (err) {
            checkbox.checked = !nextChecked;
            showError(err);
          } finally {
            checkbox.disabled = false;
          }
        })();
      });

      const swatch = document.createElement("span");
      swatch.className = "settings__category-swatch";
      swatch.style.backgroundColor = category.color;
      swatch.setAttribute("aria-hidden", "true");

      const name = document.createElement("span");
      name.className = "settings__category-name";
      name.textContent = category.name;

      item.append(checkbox, swatch, name);
      return item;
    };

    const render = (categories: StoreCategory[]) => {
      visibleList.innerHTML = "";
      hiddenList.innerHTML = "";

      if (categories.length === 0) {
        visibleGroup.hidden = true;
        hiddenGroup.hidden = true;
        emptyMessage.hidden = false;
        return;
      }

      emptyMessage.hidden = true;
      visibleGroup.hidden = false;

      const sorted = [...categories].sort((a, b) => {
        if (a.position === b.position) return a.name.localeCompare(b.name);
        return a.position - b.position;
      });

      const visible = sorted.filter((category) => category.isVisible);
      const hidden = sorted.filter((category) => !category.isVisible);

      if (visible.length === 0 && hidden.length > 0) {
        const message = document.createElement("p");
        message.className = "settings__categories-message";
        message.textContent = "All categories hidden — re-enable below.";
        visibleList.appendChild(message);
      } else {
        visible.forEach((category) => {
          visibleList.appendChild(renderToggle(category));
        });
      }

      if (hidden.length > 0) {
        hiddenGroup.hidden = false;
        hidden.forEach((category) => {
          hiddenList.appendChild(renderToggle(category));
        });
      } else {
        hiddenGroup.hidden = true;
      }
    };

    const loadCategories =
      options.loadCategories ??
      ((householdId: string) =>
        categoriesRepo.list({
          householdId,
          orderBy: "position, created_at, id",
          includeHidden: true,
        }));

    const unsubscribe = subscribeToCategories(render);
    registerViewCleanup(container, unsubscribe);

    void (async () => {
      try {
        const householdId = await ensureHouseholdId();
        if (getCategoryState().length === 0) {
          const categories = await loadCategories(householdId);
          storeCategories(categories);
        } else {
          render(getCategoryState());
        }
      } catch (err) {
        list.innerHTML = "";
        const failure = document.createElement("p");
        failure.className = "settings__error";
        failure.textContent = "Unable to load categories.";
        list.appendChild(failure);
        showError(err);
      }
    })();

    return panel;
  };

  const timezoneMaintenance = createTimezoneSection();
  const backups = createBackup();
  const exportView = createExport();
  const importView = createImport();
  const repair = createRepair();
  const hardRepair = createHardRepair();
  const manageCategories = manageCategoriesSection();
  const general = createEmptySection("settings-general", "General");
  const storage = createEmptySection("settings-storage", "Storage and permissions");
  const notifications = createEmptySection("settings-notifications", "Notifications");
  const appearance = createAmbient();

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

  const bodyChildren: HTMLElement[] = [metaList, note];
  bodyChildren.push(actions, status, preview);

  aboutBody.append(...bodyChildren);
  // Load attribution asynchronously to avoid deep relative imports and keep UI responsive
  void createAttribution().then((attribution) => {
    if (attribution) {
      // Insert before actions if still present
      const anchor = aboutBody.querySelector<HTMLElement>(".settings__actions");
      if (anchor?.parentElement === aboutBody) {
        aboutBody.insertBefore(attribution, anchor);
      } else {
        aboutBody.appendChild(attribution);
      }
    }
  });
  about.append(aboutHeading, aboutBody);

  section.append(
    backButton,
    timezoneMaintenance.element,
    backups.element,
    exportView.element,
    importView.element,
    repair.element,
    hardRepair.element,
    manageCategories,
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

  void useSettingsFn();
  setupAboutAndDiagnostics(section, {
    fetchAbout,
    fetchSummary,
    openDiagnostics,
  });
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

type DiagnosticsDependencies = {
  fetchAbout: typeof fetchAboutMetadata;
  fetchSummary: typeof fetchDiagnosticsSummary;
  openDiagnostics: typeof openDiagnosticsDoc;
};

async function setupAboutAndDiagnostics(
  root: HTMLElement,
  deps: DiagnosticsDependencies,
) {
  const container = root.querySelector<HTMLElement>(".settings__body--about");
  if (!container) return;

  const versionEl = container.querySelector<HTMLElement>("[data-settings-version]");
  const commitEl = container.querySelector<HTMLElement>("[data-settings-commit]");
  const statusEl = container.querySelector<HTMLElement>("[data-settings-status]");
  const previewEl = container.querySelector<HTMLPreElement>("[data-diagnostics-preview]");
  const copyButton = container.querySelector<HTMLButtonElement>("[data-copy-diagnostics]");
  const helpLink = container.querySelector<HTMLElement>("[data-open-diagnostics-doc]");

  try {
    const meta = await deps.fetchAbout();
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
      const summary = await deps.fetchSummary();
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
      await deps.openDiagnostics();
      statusEl.textContent = "Diagnostics guide opened in your default viewer.";
    } catch (error) {
      statusEl.textContent = `Failed to open diagnostics guide: ${describeError(error)}`;
    }
  });
}
