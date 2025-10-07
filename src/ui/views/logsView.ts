import { logsStore } from "@features/logs/logs.store";

function renderSummary(count: number, fetchedAtUtc?: string): string {
  const noun = count === 1 ? "line" : "lines";
  if (!fetchedAtUtc) {
    return `Showing ${count} log ${noun}.`;
  }
  return `Showing ${count} log ${noun} (fetched ${fetchedAtUtc}).`;
}

export function mountLogsView(container: HTMLElement): () => void {
  container.innerHTML = `
    <section class="logs-view" aria-labelledby="logs-title">
      <header class="logs-header">
        <h1 id="logs-title" class="logs-title">Logs</h1>
        <div class="logs-actions" aria-live="polite" aria-atomic="true"></div>
      </header>
      <div class="logs-content">
        <div class="logs-loading" role="status" data-testid="logs-loading">
          Loading latest diagnostics…
        </div>
        <div class="logs-error" role="alert" data-testid="logs-error" hidden>
          <p class="logs-error__message"></p>
        </div>
        <div class="logs-empty" data-testid="logs-empty" hidden>
          No logs available.
        </div>
        <div class="logs-ready" data-testid="logs-ready" hidden>
          <p class="logs-ready__summary"></p>
        </div>
      </div>
    </section>
  `;

  const loadingEl = container.querySelector<HTMLElement>(
    "[data-testid='logs-loading']",
  );
  const errorEl = container.querySelector<HTMLElement>(
    "[data-testid='logs-error']",
  );
  const errorMessageEl = errorEl?.querySelector<HTMLElement>(
    ".logs-error__message",
  );
  const emptyEl = container.querySelector<HTMLElement>(
    "[data-testid='logs-empty']",
  );
  const readyEl = container.querySelector<HTMLElement>(
    "[data-testid='logs-ready']",
  );
  const readySummaryEl = readyEl?.querySelector<HTMLElement>(
    ".logs-ready__summary",
  );

  if (!loadingEl || !errorEl || !emptyEl || !readyEl || !readySummaryEl) {
    throw new Error("Logs view failed to initialize required elements");
  }

  const unsubscribe = logsStore.subscribe((state) => {
    const status = state.status === "idle" ? "loading" : state.status;

    const isLoading = status === "loading";
    loadingEl.hidden = !isLoading;

    const isError = status === "error";
    errorEl.hidden = !isError;
    if (isError) {
      errorMessageEl.textContent = state.error ?? "Unable to load logs.";
    }

    const hasEntries = status === "ready" && state.entries.length > 0;
    readyEl.hidden = !hasEntries;
    if (hasEntries) {
      readySummaryEl.textContent = renderSummary(
        state.entries.length,
        state.fetchedAtUtc,
      );
    }

    const showEmpty = status === "ready" && state.entries.length === 0;
    emptyEl.hidden = !showEmpty;
  });

  void logsStore.fetchTail();

  const cleanup = () => {
    unsubscribe();
    logsStore.clear();
  };

  return cleanup;
}
