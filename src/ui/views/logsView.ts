import { logsStore } from "@features/logs/logs.store";
import type { LogEntry, LogLevel } from "@features/logs/logs.types";
import { toast } from "@ui/Toast";

const severityOrder: LogLevel[] = ["trace", "debug", "info", "warn", "error"];
const severityRank: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

type TimezoneMode = "local" | "utc";

const LOCAL_TIME_ZONE = "Europe/London";

function renderSummary(
  visibleCount: number,
  totalCount: number,
  fetchedAtUtc?: string,
): string {
  const noun = totalCount === 1 ? "line" : "lines";
  const prefix =
    visibleCount === totalCount
      ? `Showing ${totalCount} log ${noun}`
      : `Showing ${visibleCount} of ${totalCount} log ${noun}`;
  if (!fetchedAtUtc) {
    return `${prefix}.`;
  }
  return `${prefix} (fetched ${fetchedAtUtc}).`;
}

function formatTimestamp(entry: LogEntry, mode: TimezoneMode): string {
  if (mode === "utc") {
    return entry.tsUtc;
  }
  try {
    const date = new Date(entry.tsUtc);
    if (Number.isNaN(date.getTime())) {
      return entry.tsUtc;
    }
    return date.toLocaleString("en-GB", { timeZone: LOCAL_TIME_ZONE });
  } catch {
    return entry.tsUtc;
  }
}

function createCategoryOption(value: string, checked: boolean): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "logs-filter__option";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = value;
  input.checked = checked;
  input.className = "logs-filter__checkbox";
  label.appendChild(input);

  const text = document.createElement("span");
  text.textContent = value;
  label.appendChild(text);

  return label;
}

function applyFilters(
  entries: LogEntry[],
  selectedSeverity: LogLevel,
  selectedCategories: Set<string>,
  searchTerm: string,
): LogEntry[] {
  const normalizedSearch = searchTerm.trim().toLowerCase();
  return entries.filter((entry) => {
    if (severityRank[entry.level] < severityRank[selectedSeverity]) {
      return false;
    }
    if (selectedCategories.size > 0 && !selectedCategories.has(entry.event)) {
      return false;
    }
    if (normalizedSearch) {
      const haystack = `${entry.event} ${entry.message ?? ""}`.toLowerCase();
      if (!haystack.includes(normalizedSearch)) {
        return false;
      }
    }
    return true;
  });
}

function renderRows(
  tbody: HTMLTableSectionElement,
  entries: LogEntry[],
  timezone: TimezoneMode,
): void {
  const fragment = document.createDocumentFragment();
  if (entries.length === 0) {
    const emptyRow = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "logs-table__empty";
    cell.textContent = "No log lines match the current filters.";
    emptyRow.appendChild(cell);
    fragment.appendChild(emptyRow);
  } else {
    for (const entry of entries) {
      const row = document.createElement("tr");
      row.dataset.level = entry.level;

      const timestampCell = document.createElement("td");
      timestampCell.className = "logs-table__cell logs-table__cell--timestamp";
      timestampCell.textContent = formatTimestamp(entry, timezone);
      timestampCell.title = entry.tsUtc;
      row.appendChild(timestampCell);

      const levelCell = document.createElement("td");
      levelCell.className = "logs-table__cell logs-table__cell--level";
      const levelBadge = document.createElement("span");
      levelBadge.className = `logs-level logs-level--${entry.level}`;
      levelBadge.textContent = entry.level.toUpperCase();
      levelCell.appendChild(levelBadge);
      row.appendChild(levelCell);

      const eventCell = document.createElement("td");
      eventCell.className = "logs-table__cell logs-table__cell--event";
      eventCell.textContent = entry.event;
      row.appendChild(eventCell);

      const messageCell = document.createElement("td");
      messageCell.className = "logs-table__cell logs-table__cell--message";
      if (entry.message) {
        messageCell.textContent = entry.message;
      } else {
        messageCell.textContent = "";
      }
      row.appendChild(messageCell);

      fragment.appendChild(row);
    }
  }

  tbody.replaceChildren(fragment);
}

export function mountLogsView(container: HTMLElement): () => void {
  container.innerHTML = `
    <section class="logs-view" aria-labelledby="logs-title">
      <header class="logs-header">
        <div class="logs-header__title">
          <h1 id="logs-title" class="logs-title">Logs</h1>
          <div class="logs-time-toggle" role="group" aria-label="Timestamp display">
            <button type="button" class="logs-time-toggle__button is-active" data-timezone="local">Local</button>
            <button type="button" class="logs-time-toggle__button" data-timezone="utc">UTC</button>
          </div>
        </div>
        <div class="logs-header__actions">
          <span class="logs-summary" aria-live="polite" aria-atomic="true"></span>
          <button type="button" class="btn btn--secondary btn--sm" disabled title="Export will arrive soon">Export JSON</button>
        </div>
      </header>
      <div class="logs-toolbar" role="region" aria-label="Log filters">
        <label class="logs-filter logs-filter--severity">
          <span class="logs-filter__label">Severity</span>
          <select class="logs-filter__select" data-testid="logs-filter-severity">
            ${severityOrder
              .map((level) => `<option value="${level}" ${level === "info" ? "selected" : ""}>${level.toUpperCase()}</option>`)
              .join("")}
          </select>
        </label>
        <details class="logs-filter logs-filter--categories" data-testid="logs-filter-categories">
          <summary class="logs-filter__summary">Categories <span class="logs-filter__count" aria-hidden="true">(All)</span></summary>
          <div class="logs-filter__menu" role="group" aria-label="Filter by category"></div>
        </details>
        <label class="logs-filter logs-filter--search">
          <span class="logs-filter__label">Search</span>
          <input type="search" class="logs-filter__search" placeholder="Search logs…" data-testid="logs-filter-search" />
        </label>
        <label class="logs-filter logs-filter--live">
          <input type="checkbox" class="logs-filter__checkbox" data-testid="logs-live-toggle" />
          <span>Live Tail</span>
        </label>
        <button type="button" class="btn btn--secondary btn--sm logs-refresh" data-testid="logs-refresh">Refresh</button>
      </div>
      <div class="logs-content">
        <div class="logs-banners" hidden>
          <div class="logs-banner" data-banner="backlog" role="status" hidden>⚠ Log backlog detected — some entries may be missing.</div>
          <div class="logs-banner" data-banner="io" role="status" hidden>⚠ Log writing paused — insufficient disk space.</div>
        </div>
        <div class="logs-state logs-state--loading" role="status" data-testid="logs-loading">Loading latest diagnostics…</div>
        <div class="logs-state logs-state--error" role="alert" data-testid="logs-error" hidden></div>
        <div class="logs-state logs-state--empty" data-testid="logs-empty" hidden>No log lines yet — perform an action and refresh.</div>
        <div class="logs-table-wrapper" hidden>
          <table class="logs-table" data-testid="logs-table">
            <thead>
              <tr>
                <th scope="col" class="logs-table__header logs-table__header--timestamp">Timestamp</th>
                <th scope="col" class="logs-table__header logs-table__header--level">Level</th>
                <th scope="col" class="logs-table__header logs-table__header--event">Event</th>
                <th scope="col" class="logs-table__header logs-table__header--message">Message</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  const severitySelect = container.querySelector<HTMLSelectElement>(
    "[data-testid='logs-filter-severity']",
  );
  const categoriesDetails = container.querySelector<HTMLDetailsElement>(
    "[data-testid='logs-filter-categories']",
  );
  const categoriesMenu = categoriesDetails?.querySelector<HTMLDivElement>(
    ".logs-filter__menu",
  );
  const categoriesCount = categoriesDetails?.querySelector<HTMLElement>(
    ".logs-filter__count",
  );
  const searchInput = container.querySelector<HTMLInputElement>(
    "[data-testid='logs-filter-search']",
  );
  const liveTailToggle = container.querySelector<HTMLInputElement>(
    "[data-testid='logs-live-toggle']",
  );
  const refreshButton = container.querySelector<HTMLButtonElement>(
    "[data-testid='logs-refresh']",
  );
  const loadingEl = container.querySelector<HTMLElement>(
    "[data-testid='logs-loading']",
  );
  const errorEl = container.querySelector<HTMLElement>("[data-testid='logs-error']");
  const emptyEl = container.querySelector<HTMLElement>("[data-testid='logs-empty']");
  const tableWrapper = container.querySelector<HTMLElement>(".logs-table-wrapper");
  const tableBody = container.querySelector<HTMLTableSectionElement>(
    ".logs-table tbody",
  );
  const summaryEl = container.querySelector<HTMLElement>(".logs-summary");
  const timeButtons = Array.from(
    container.querySelectorAll<HTMLButtonElement>(".logs-time-toggle__button"),
  );
  const bannersContainer = container.querySelector<HTMLElement>(".logs-banners");
  const backlogBanner = container.querySelector<HTMLElement>("[data-banner='backlog']");
  const ioBanner = container.querySelector<HTMLElement>("[data-banner='io']");

  if (
    !severitySelect ||
    !categoriesDetails ||
    !categoriesMenu ||
    !categoriesCount ||
    !searchInput ||
    !liveTailToggle ||
    !refreshButton ||
    !loadingEl ||
    !errorEl ||
    !emptyEl ||
    !tableWrapper ||
    !tableBody ||
    !summaryEl ||
    !bannersContainer ||
    !backlogBanner ||
    !ioBanner
  ) {
    throw new Error("Logs view failed to initialize required elements");
  }

  let timezone: TimezoneMode = "local";
  let selectedSeverity: LogLevel = "info";
  let selectedCategories = new Set<string>();
  let searchTerm = "";
  let filteredEntries: LogEntry[] = [];
  let allEntries: LogEntry[] = [];
  let totalCount = 0;
  let lastFetchedAt: string | undefined;
  let currentStatus: "loading" | "ready" | "error" = "loading";
  let liveTailTimer: number | null = null;
  let lastErrorToast: string | null = null;

  for (const button of timeButtons) {
    const isActive = button.dataset.timezone === timezone;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  function updateCategoryLabel(): void {
    if (selectedCategories.size === 0) {
      categoriesCount.textContent = "(All)";
    } else if (selectedCategories.size === 1) {
      categoriesCount.textContent = "(1)";
    } else {
      categoriesCount.textContent = `(${selectedCategories.size})`;
    }
  }

  function syncCategoryOptions(categories: string[]): void {
    const sorted = categories.slice().sort((a, b) => a.localeCompare(b));
    const retained = new Set<string>();
    const fragment = document.createDocumentFragment();
    for (const category of sorted) {
      if (selectedCategories.has(category)) {
        retained.add(category);
      }
      fragment.appendChild(createCategoryOption(category, retained.has(category)));
    }
    selectedCategories = retained;
    categoriesMenu.replaceChildren(fragment);
    updateCategoryLabel();
  }

  function updateBanners(droppedCount: number, logWriteStatus: string): void {
    const backlogVisible = droppedCount > 0;
    const ioVisible = logWriteStatus === "io_error";
    backlogBanner.hidden = !backlogVisible;
    ioBanner.hidden = !ioVisible;
    bannersContainer.hidden = !(backlogVisible || ioVisible);
  }

  function updateSummary(): void {
    if (totalCount === 0) {
      summaryEl.textContent = currentStatus === "loading" ? "Loading latest diagnostics…" : "";
      return;
    }
    summaryEl.textContent = renderSummary(
      filteredEntries.length,
      totalCount,
      lastFetchedAt,
    );
  }

  function updateTableVisibility(): void {
    const hasEntries = totalCount > 0;
    tableWrapper.hidden = !hasEntries;
    emptyEl.hidden = !(currentStatus === "ready" && totalCount === 0);
  }

  function updateStates(): void {
    loadingEl.hidden = currentStatus !== "loading";
    errorEl.hidden = currentStatus !== "error";
    updateTableVisibility();
    updateSummary();
  }

  function refreshRows(): void {
    filteredEntries = applyFilters(
      allEntries,
      selectedSeverity,
      selectedCategories,
      searchTerm,
    );
    renderRows(tableBody, filteredEntries, timezone);
    updateSummary();
  }

  function setTimezone(next: TimezoneMode): void {
    if (timezone === next) return;
    timezone = next;
    for (const button of timeButtons) {
      const isActive = button.dataset.timezone === timezone;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
    renderRows(tableBody, filteredEntries, timezone);
  }

  function startLiveTail(): void {
    if (liveTailTimer !== null) return;
    liveTailTimer = window.setInterval(() => {
      void logsStore.fetchTail();
    }, 3000);
  }

  function stopLiveTail(): void {
    if (liveTailTimer !== null) {
      window.clearInterval(liveTailTimer);
      liveTailTimer = null;
    }
    if (liveTailToggle.checked) {
      liveTailToggle.checked = false;
    }
  }

  severitySelect.addEventListener("change", () => {
    selectedSeverity = severitySelect.value as LogLevel;
    refreshRows();
  });

  categoriesMenu.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target || target.type !== "checkbox") return;
    if (target.checked) {
      selectedCategories.add(target.value);
    } else {
      selectedCategories.delete(target.value);
    }
    updateCategoryLabel();
    refreshRows();
  });

  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value;
    refreshRows();
  });

  liveTailToggle.addEventListener("change", () => {
    if (liveTailToggle.checked) {
      startLiveTail();
      void logsStore.fetchTail();
    } else {
      stopLiveTail();
    }
  });

  refreshButton.addEventListener("click", () => {
    void logsStore.fetchTail();
  });

  for (const button of timeButtons) {
    button.addEventListener("click", () => {
      const next = button.dataset.timezone as TimezoneMode | undefined;
      if (!next) return;
      setTimezone(next);
    });
  }

  const unsubscribe = logsStore.subscribe((state) => {
    const status = state.status === "idle" ? "loading" : state.status;
    currentStatus = status;

    if (status === "error") {
      const message = state.error ?? "Unable to load logs.";
      errorEl.textContent = message;
      if (message !== lastErrorToast) {
        toast.show({ kind: "error", message });
        lastErrorToast = message;
      }
      stopLiveTail();
    } else {
      lastErrorToast = null;
    }

    allEntries = state.entries.slice();
    totalCount = allEntries.length;
    lastFetchedAt = state.fetchedAtUtc;

    if (status === "ready") {
      const categories = Array.from(new Set(allEntries.map((entry) => entry.event)));
      syncCategoryOptions(categories);
      refreshRows();
      updateBanners(state.droppedCount, state.logWriteStatus);
    } else if (status === "loading") {
      if (totalCount > 0) {
        refreshRows();
      }
    } else if (status === "error") {
      filteredEntries = [];
      tableBody.replaceChildren();
      updateBanners(0, "ok");
    }

    updateStates();
  });

  void logsStore.fetchTail();

  const cleanup = () => {
    unsubscribe();
    stopLiveTail();
    logsStore.clear();
  };

  return cleanup;
}
