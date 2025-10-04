import type { Page } from '@playwright/test';

type AppReadyStatus = { status: 'ready' } | { status: 'error'; message: string };

async function awaitReadyState(page: Page): Promise<AppReadyStatus> {
  const statusHandle = await page.waitForFunction<AppReadyStatus | null>(() => {
    const w = window as typeof window & {
      __APP_READY__?: boolean;
      __APP_READY_ERROR__?: string | null;
    };
    if (w.__APP_READY_ERROR__) {
      return { status: 'error', message: w.__APP_READY_ERROR__ };
    }
    if (w.__APP_READY__) {
      return { status: 'ready' };
    }
    return null;
  }, { timeout: 15000 });

  return statusHandle.jsonValue<AppReadyStatus>();
}

export async function waitForAppReady(page: Page): Promise<void> {
  const status = await awaitReadyState(page);
  if (status?.status === 'error') {
    throw new Error(`App failed to boot: ${status.message}`);
  }

  await page.waitForSelector('main[role="main"]', { timeout: 5000 });
}

export async function gotoAppRoute(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await waitForAppReady(page);
}
