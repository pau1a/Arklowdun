import { logsStore } from "@features/logs/logs.store";
import type { LogEntry, LogLevel } from "@features/logs/logs.types";
import { formatTimestamp, getZoneLabel } from "@features/logs/time";
import { toast } from "@ui/Toast";

const severityOrder: LogLevel[] = ["trace", "debug", "info", "warn", "error"];
const severityRank: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

type LiveTailState = "idle" | "active" | "paused";

const LIVE_TAIL_PAUSED_MESSAGE = "Live Tail paused – temporary connection issue.";

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
  showLocal: boolean,
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
      const timestampLocal = formatTimestamp(entry.tsUtc, showLocal);
      const timestampAlt = formatTimestamp(entry.tsUtc, !showLocal);
      const haystack = `${timestampLocal} ${timestampAlt} ${entry.level} ${entry.event} ${
        entry.message ?? ""
      }`
        .trim()
        .toLowerCase();
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
  showLocal: boolean,
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
    entries.forEach((entry, i) => {
      const row = document.createElement("tr");
      row.className = "logs-row";
      row.tabIndex = 0;
      row.dataset.level = entry.level;
      row.dataset.index = String(i);

      const timestampCell = document.createElement("td");
      timestampCell.className = "logs-table__cell logs-table__cell--timestamp";
      timestampCell.textContent = formatTimestamp(entry.tsUtc, showLocal);
      timestampCell.title = formatTimestamp(entry.tsUtc, !showLocal);
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
    });
  }

  tbody.replaceChildren(fragment);
}

function renderDetailRow(afterRow: HTMLTableRowElement, entry: LogEntry) {
  const open = afterRow.parentElement?.querySelector<HTMLTableRowElement>(
    ".logs-row--detail.open",
  );
  open?.remove();

  const detail = document.createElement("tr");
  detail.className = "logs-row--detail open";
  const cell = document.createElement("td");
  cell.colSpan = 4;
  cell.innerHTML = `
    <div class="logs-detail">
      <pre class="logs-detail__json">${escapeHtml(
        JSON.stringify((entry as any)._raw ?? entry, null, 2),
      )}</pre>
      <button type="button" class="btn btn--secondary btn--xs logs-detail__copy">Copy JSON</button>
    </div>`;
  detail.appendChild(cell);

  afterRow.insertAdjacentElement("afterend", detail);

  const copyBtn = cell.querySelector<HTMLButtonElement>(
    ".logs-detail__copy",
  )!;
  copyBtn.addEventListener("click", async () => {
    const txt = JSON.stringify((entry as any)._raw ?? entry, null, 2);
    await navigator.clipboard.writeText(txt);
    toast.show({ kind: "success", message: "Copied JSON" });
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]!),
  );
}

export function mountLogsView(container: HTMLElement): () => void {
  container.innerHTML = `
    <section class="logs-view" aria-labelledby="logs-title">
      <header class="logs-header">
        <div class="logs-header__title">
          <h1 id="logs-title" class="logs-title">Logs</h1>
          <button
            type="button"
            class="logs-time-toggle"
            data-testid="logs-time-toggle"
            title="Switch between UTC and Local (Europe/London)"
            aria-pressed="true"
          ></button>
        </div>
        <div class="logs-header__actions">
          <div class="logs-live-control">
            <label
              class="logs-live-toggle"
              title="Automatically refresh the most recent logs every 3 seconds."
            >
              <input
                type="checkbox"
                class="logs-live-toggle__checkbox"
                data-testid="logs-live-toggle"
              />
              <span class="logs-live-toggle__switch" aria-hidden="true">
                <span class="logs-live-toggle__thumb"></span>
              </span>
              <span class="logs-live-toggle__label">
                <span
                  class="logs-live-toggle__status"
                  data-testid="logs-live-indicator"
                  data-state="idle"
                  aria-hidden="true"
                >•</span>
                Live Tail
              </span>
            </label>
          </div>
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
  const liveTailIndicator = container.querySelector<HTMLElement>(
    "[data-testid='logs-live-indicator']",
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
  const timeToggleButton = container.querySelector<HTMLButtonElement>(
    "[data-testid='logs-time-toggle']",
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
    !liveTailIndicator ||
    !refreshButton ||
    !loadingEl ||
    !errorEl ||
    !emptyEl ||
    !tableWrapper ||
    !tableBody ||
    !summaryEl ||
    !timeToggleButton ||
    !bannersContainer ||
    !backlogBanner ||
    !ioBanner
  ) {
    throw new Error("Logs view failed to initialize required elements");
  }

  let showLocal = true;
  let selectedSeverity: LogLevel = "info";
  let selectedCategories = new Set<string>();
  let searchTerm = "";
  let filteredEntries: LogEntry[] = [];
  let allEntries: LogEntry[] = [];
  let totalCount = 0;
  let lastFetchedAt: string | undefined;
  let currentStatus: "loading" | "ready" | "error" = "loading";
  let liveTailTimer: number | null = null;
  let liveTailState: LiveTailState = "idle";
  let liveTailErrorNotified = false;
  let lastErrorToast: string | null = null;

  function setLiveTailState(state: LiveTailState): void {
    liveTailState = state;
    liveTailIndicator.dataset.state = state;
  }

  function clearLiveTailTimer(): void {
    if (liveTailTimer !== null) {
      window.clearInterval(liveTailTimer);
      liveTailTimer = null;
    }
  }

  function updateTimeToggle(): void {
    const zoneLabel = getZoneLabel(true);
    const primaryLabel = showLocal ? `Local (${zoneLabel})` : "UTC";
    const secondaryLabel = showLocal ? "UTC" : `Local (${zoneLabel})`;
    timeToggleButton.textContent = `Time: ${primaryLabel} \u21C4 ${secondaryLabel}`;
    timeToggleButton.setAttribute("aria-pressed", showLocal ? "true" : "false");
  }

  updateTimeToggle();

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
    updateTimeToggle();
    filteredEntries = applyFilters(
      allEntries,
      selectedSeverity,
      selectedCategories,
      searchTerm,
      showLocal,
    );
    renderRows(tableBody, filteredEntries, showLocal);
    updateSummary();
  }

  function startLiveTail(): void {
    clearLiveTailTimer();
    liveTailTimer = window.setInterval(() => {
      void logsStore.fetchTail();
    }, 3000);
    setLiveTailState("active");
    liveTailErrorNotified = false;
  }

  function stopLiveTail(): void {
    clearLiveTailTimer();
    setLiveTailState("idle");
    liveTailErrorNotified = false;
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

  function onRowToggle(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const tr = target.closest<HTMLTableRowElement>("tr.logs-row");
    if (!tr) return;
    const idx = Number(tr.dataset.index ?? -1);
    if (Number.isNaN(idx) || idx < 0 || idx >= filteredEntries.length) {
      return;
    }

    const next = tr.nextElementSibling as HTMLTableRowElement | null;
    if (next?.classList.contains("logs-row--detail")) {
      next.remove();
    } else {
      renderDetailRow(tr, filteredEntries[idx]);
    }
  }

  function onRowKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === " ") {
      const tr = (event.target as HTMLElement | null)?.closest<HTMLTableRowElement>(
        "tr.logs-row",
      );
      if (tr) {
        event.preventDefault();
        onRowToggle(event);
      }
    }
  }

  tableBody.addEventListener("click", onRowToggle);
  tableBody.addEventListener("keydown", onRowKeydown);

  timeToggleButton.addEventListener("click", () => {
    showLocal = !showLocal;
    refreshRows();
  });

  const unsubscribe = logsStore.subscribe((state) => {
    const status = state.status === "idle" ? "loading" : state.status;
    let nextStatus: typeof currentStatus = status;
    const snapshot = state.entries.slice();

    if (status !== "error" || snapshot.length > 0) {
      allEntries = snapshot;
      totalCount = allEntries.length;
    }

    if (state.fetchedAtUtc && status !== "error") {
      lastFetchedAt = state.fetchedAtUtc;
    }

    if (status === "ready") {
      const categories = Array.from(new Set(allEntries.map((entry) => entry.event)));
      syncCategoryOptions(categories);
      refreshRows();
      updateBanners(state.droppedCount, state.logWriteStatus);
      if (liveTailToggle.checked) {
        setLiveTailState("active");
      }
      liveTailErrorNotified = false;
      lastErrorToast = null;
    } else if (status === "loading") {
      if (totalCount > 0) {
        refreshRows();
      }
      if (liveTailToggle.checked && liveTailState === "paused") {
        setLiveTailState("active");
      }
    } else if (status === "error") {
      const message = state.error ?? "Unable to load logs.";
      const liveTailEnabled = liveTailToggle.checked;
      const hasPreviousEntries = totalCount > 0;
      errorEl.textContent = message;

      if (liveTailEnabled) {
        if (!liveTailErrorNotified) {
          toast.show({ kind: "info", message: LIVE_TAIL_PAUSED_MESSAGE });
          liveTailErrorNotified = true;
          lastErrorToast = LIVE_TAIL_PAUSED_MESSAGE;
        }
        setLiveTailState("paused");
        if (hasPreviousEntries) {
          nextStatus = "ready";
        }
      } else if (message !== lastErrorToast) {
        toast.show({ kind: "error", message });
        lastErrorToast = message;
      }

      if (!liveTailEnabled || !hasPreviousEntries) {
        filteredEntries = [];
        tableBody.replaceChildren();
        updateBanners(0, "ok");
      }
    }

    if (!liveTailToggle.checked && liveTailState !== "idle") {
      setLiveTailState("idle");
    }

    currentStatus = nextStatus;
    updateStates();
  });

  void logsStore.fetchTail();

  const cleanup = () => {
    tableBody.removeEventListener("click", onRowToggle);
    tableBody.removeEventListener("keydown", onRowKeydown);
    unsubscribe();
    stopLiveTail();
    logsStore.clear();
  };

  return cleanup;
}
