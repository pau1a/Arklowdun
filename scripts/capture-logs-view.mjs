import { chromium } from 'playwright';

const SAMPLE = {
  lines: [
    { ts: '2025-10-07T18:24:00Z', level: 'error', event: 'gamma', message: 'Gamma failure detected' },
    { ts: '2025-10-07T18:23:00Z', level: 'warn', event: 'beta', message: 'Beta nearing limit' },
    { ts: '2025-10-07T18:22:00Z', level: 'info', event: 'alpha', message: 'Alpha ready' },
    { ts: '2025-10-07T18:21:00Z', level: 'debug', event: 'delta', message: 'Verbose diagnostic entry' },
    { ts: '2025-10-07T18:20:00Z', level: 'trace', event: 'epsilon', message: 'Trace helper details' }
  ],
  dropped_count: 2,
  log_write_status: 'io_error',
};

const VIEWPORT = { width: 1440, height: 900 };

const HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Logs Preview</title>
    <style>
      :root { font-family: 'Inter', system-ui, sans-serif; }
      body { margin: 0; background: #f5f6f8; }
      main { min-height: 100vh; display: flex; }
      #app { flex: 1; }
    </style>
  </head>
  <body>
    <main>
      <div id="app"></div>
    </main>
    <script type="module">
      import { mountLogsView } from '/src/ui/views/logsView.ts';
      import { logsStore, __setTailFetcherForTests } from '/src/features/logs/logs.store.ts';
      __setTailFetcherForTests(async () => (${JSON.stringify(SAMPLE)}));
      const host = document.getElementById('app');
      mountLogsView(host);
      await logsStore.fetchTail();
    </script>
  </body>
</html>`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.setContent(HTML, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'docs/logging/images/logs-view.png', fullPage: true });
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
