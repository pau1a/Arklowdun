export function mountLogsView(container: HTMLElement): () => void {
  container.innerHTML = `
    <section class="logs-view" aria-labelledby="logs-title">
      <header class="logs-header">
        <h1 id="logs-title" class="logs-title">Logs</h1>
        <div class="logs-actions" aria-live="polite" aria-atomic="true">
          <!-- placeholders for PR-3/4/5: severity, categories, time toggle, live-tail, export -->
        </div>
      </header>
      <div class="logs-content">
        <div class="empty" data-testid="logs-empty-stub">
          Logging console wired. Data & controls arrive in PR-2/3/4/5/7.
        </div>
      </div>
    </section>
  `;

  const cleanup = () => {
    // Placeholder cleanup; no resources to dispose yet.
  };

  return cleanup;
}
