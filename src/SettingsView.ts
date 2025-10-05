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
import {
  createStorageVaultView,
  vaultMigrationUiEnabled,
} from "@features/settings/components/StorageVaultView";
import { createEmptyState } from "./ui/EmptyState";
import { STR } from "./ui/strings";
import createButton from "@ui/Button";
import { createAttributionSectionAsync } from "@features/settings/components/AttributionSection";
import { createAmbientBackgroundSection } from "@features/settings/components/AmbientBackgroundSection";
import { createHouseholdSwitcherSection } from "@features/settings/components/HouseholdSwitcherSection";
import { getHouseholdIdForCalls } from "./db/household";
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
import createInput from "@ui/Input";

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
    createStorageVaultView?: typeof createStorageVaultView;
    createAmbientBackgroundSection?: typeof createAmbientBackgroundSection;
    createAttributionSectionAsync?: typeof createAttributionSectionAsync;
    createHouseholdSwitcherSection?: typeof createHouseholdSwitcherSection;
  };
  useSettingsHook?: typeof useSettings;
}

interface SettingsNavItem {
  headingId: string;
  label: string;
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
  const createStorageVault = components.createStorageVaultView ?? createStorageVaultView;
  const createAmbient =
    components.createAmbientBackgroundSection ?? createAmbientBackgroundSection;
  const createAttribution =
    components.createAttributionSectionAsync ?? createAttributionSectionAsync;
  const createHouseholdSwitcher =
    components.createHouseholdSwitcherSection ?? createHouseholdSwitcherSection;

  const useSettingsFn = options.useSettingsHook ?? useSettings;

  const panel = SettingsPanel();
  const section = panel.element; // allow other modules to locate settings root

  const layout = document.createElement("div");
  layout.className = "settings__layout";

  const content = document.createElement("div");
  content.className = "settings__content";
  layout.appendChild(content);

  section.appendChild(layout);

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
          promise = getHouseholdIdForCalls().then((value) => {
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

      const checkbox = createInput({
        type: "checkbox",
        ariaLabel: `Toggle ${category.name}`,
      });
      checkbox.checked = category.isVisible;

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

  const navSections: SettingsNavItem[] = [];

  const registerNavSection = (
    headingId: string,
    label: string,
    element: HTMLElement,
  ): HTMLElement => {
    element.dataset.settingsSection = headingId;
    content.appendChild(element);
    navSections.push({ headingId, label });
    return element;
  };

  const householdSwitcher = createHouseholdSwitcher();
  registerViewCleanup(container, householdSwitcher.destroy);
  registerNavSection("settings-household", "Households", householdSwitcher.element);

  const timezoneMaintenance = createTimezoneSection();
  registerNavSection(
    "settings-timezone-maintenance",
    "Time & timezone",
    timezoneMaintenance.element,
  );

  registerNavSection("settings-backups", "Backups", createBackup().element);

  registerNavSection("settings-export", "Export", createExport().element);

  registerNavSection("settings-import", "Import", createImport().element);

  registerNavSection("settings-repair", "Repair", createRepair().element);

  registerNavSection(
    "settings-hard-repair",
    "Advanced repair",
    createHardRepair().element,
  );

  registerNavSection(
    "settings-manage-categories",
    "Categories",
    manageCategoriesSection(),
  );

  registerNavSection(
    "settings-general",
    "General",
    createEmptySection("settings-general", "General"),
  );

  if (vaultMigrationUiEnabled) {
    const storageVault = createStorageVault();
    registerViewCleanup(container, storageVault.destroy);
    registerNavSection("settings-storage", "Storage & permissions", storageVault.element);
  }

  registerNavSection(
    "settings-notifications",
    "Notifications",
    createEmptySection("settings-notifications", "Notifications"),
  );

  registerNavSection(
    "settings-ambient",
    "Appearance",
    createAmbient(),
  );

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

  registerNavSection("settings-about", "Diagnostics", about);

  section.insertBefore(backButton, layout);
  const navigation = setupSettingsNavigation(navSections);
  layout.insertBefore(navigation.element, content);

  registerViewCleanup(container, navigation.destroy);

  container.innerHTML = "";
  container.appendChild(section);

  const applyNavigationState = () => navigation.applyInitialState();
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(applyNavigationState);
  } else {
    applyNavigationState();
  }

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

interface SettingsNavigationHandle {
  element: HTMLElement;
  applyInitialState: () => void;
  destroy: () => void;
}

const SETTINGS_SECTION_STORAGE_KEY = "arklowdun.settings.activeSection";

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function setupSettingsNavigation(items: SettingsNavItem[]): SettingsNavigationHandle {
  const nav = document.createElement("nav");
  nav.className = "settings__nav";
  nav.setAttribute("aria-label", "Settings sections");
  nav.dataset.testid = "settings-nav";

  const list = document.createElement("ul");
  list.className = "settings__nav-list";
  nav.appendChild(list);

  const anchors = new Map<string, HTMLAnchorElement>();

  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "settings__nav-item";

    const anchor = document.createElement("a");
    anchor.className = "settings__nav-link";
    anchor.href = `#${item.headingId}`;
    anchor.textContent = item.label;
    anchor.dataset.testid = `settings-nav-${item.headingId}`;

    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      activate(item.headingId, {
        behavior: "smooth",
        focus: true,
        updateHash: true,
        store: true,
      });
    });

    li.appendChild(anchor);
    list.appendChild(li);
    anchors.set(item.headingId, anchor);
  });

  let currentId: string | null = null;
  let scrollLockUntil = 0;

  const markCurrent = (id: string, { store = true }: { store?: boolean } = {}) => {
    if (!anchors.has(id) || currentId === id) return;
    currentId = id;
    for (const [key, anchor] of anchors) {
      if (key === id) {
        anchor.setAttribute("aria-current", "true");
      } else {
        anchor.removeAttribute("aria-current");
      }
    }
    if (store) {
      try {
        window.localStorage?.setItem(SETTINGS_SECTION_STORAGE_KEY, id);
      } catch {
        // ignore storage failures
      }
    }
  };

  const findSectionElements = (
    headingId: string,
  ): { section: HTMLElement; heading: HTMLElement } | null => {
    const heading = document.getElementById(headingId);
    if (!heading) return null;
    const section = heading.closest<HTMLElement>(".settings__section") ?? heading;
    return { section, heading };
  };

  const focusSection = (section: HTMLElement, heading: HTMLElement) => {
    const focusable = section.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusable) {
      focusable.focus({ preventScroll: true });
      return;
    }

    const previousTabIndex = heading.getAttribute("tabindex");
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
    if (previousTabIndex === null) {
      const cleanup = () => heading.removeAttribute("tabindex");
      heading.addEventListener("blur", cleanup, { once: true });
    }
  };

  const prefersReducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

  type ActivateOptions = {
    behavior?: ScrollBehavior;
    focus?: boolean;
    updateHash?: boolean;
    store?: boolean;
  };

  const activate = (id: string, options: ActivateOptions = {}): boolean => {
    const match = findSectionElements(id);
    if (!match) return false;

    const behavior = options.behavior ?? "auto";
    const shouldFocus = options.focus ?? true;
    const shouldUpdateHash = options.updateHash ?? false;
    const shouldStore = options.store ?? true;

    const finalBehavior: ScrollBehavior =
      prefersReducedMotion && behavior === "smooth" ? "auto" : behavior;

    match.section.scrollIntoView({ block: "start", behavior: finalBehavior });

    if (shouldFocus) {
      focusSection(match.section, match.heading);
    }

    markCurrent(id, { store: shouldStore });

    if (shouldUpdateHash) {
      const baseHash = extractRouteHash(window.location.hash) ?? "#/settings";
      history.replaceState(null, "", `${baseHash}#${id}`);
    }

    const now =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    scrollLockUntil = now + 400;
    return true;
  };

  const readStoredSection = (): string | null => {
    try {
      return window.localStorage?.getItem(SETTINGS_SECTION_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  };

  const handleHashChange = () => {
    const next = extractSectionId(window.location.hash);
    if (next && anchors.has(next)) {
      activate(next, { behavior: "smooth", focus: true, updateHash: false });
    }
  };

  window.addEventListener("hashchange", handleHashChange);

  const computeOffset = () => {
    const root = document.documentElement;
    const raw = getComputedStyle(root).getPropertyValue("--app-toolbar-height");
    const toolbar = Number.parseFloat(raw) || 64;
    return toolbar + 32;
  };

  const handleScroll = () => {
    const now =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    if (now < scrollLockUntil) return;

    const headings = items
      .map((item) => document.getElementById(item.headingId))
      .filter((el): el is HTMLElement => el instanceof HTMLElement);

    if (!headings.length) return;

    const offset = computeOffset();
    let candidate: HTMLElement | null = headings[0];

    for (const heading of headings) {
      const rect = heading.getBoundingClientRect();
      if (rect.top - offset <= 0) {
        candidate = heading;
      } else {
        break;
      }
    }

    if (candidate) {
      markCurrent(candidate.id, { store: true });
    }
  };

  const onScroll = () => handleScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const destroy = () => {
    window.removeEventListener("hashchange", handleHashChange);
    window.removeEventListener("scroll", onScroll);
  };

  const applyInitialState = () => {
    const headings = items
      .map((item) => document.getElementById(item.headingId))
      .filter((el): el is HTMLElement => el instanceof HTMLElement);

    if (!headings.length) return;

    const fromHash = extractSectionId(window.location.hash);
    if (fromHash && anchors.has(fromHash)) {
      activate(fromHash, { behavior: "auto", focus: true, updateHash: false });
      return;
    }

    const stored = readStoredSection();
    if (stored && anchors.has(stored)) {
      activate(stored, {
        behavior: "auto",
        focus: false,
        updateHash: false,
        store: false,
      });
      markCurrent(stored, { store: true });
      return;
    }

    markCurrent(headings[0].id, { store: false });
  };

  return { element: nav, applyInitialState, destroy };
}

function extractSectionId(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const trimmed = hash.trim();
  if (!trimmed) return null;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const anchorIndex = withHash.indexOf("#", 2);
  if (anchorIndex === -1) return null;
  const candidate = withHash.slice(anchorIndex + 1).trim();
  return candidate || null;
}

function extractRouteHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const trimmed = hash.trim();
  if (!trimmed) return null;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const anchorIndex = withHash.indexOf("#", 2);
  return anchorIndex === -1 ? withHash : withHash.slice(0, anchorIndex);
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
