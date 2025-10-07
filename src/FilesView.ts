import { open } from '@lib/ipc/dialog';
import {
  readDir,
  writeText,
  remove,
  mkdir,
  toUserMessage,
  type RootKey,
  readText,
} from './files/safe-fs';
import { canonicalizeAndVerify, rejectSymlinks } from './files/path';
import { convertFileSrc } from '@lib/ipc/core';
import { STR } from '@ui/strings';
import { showError } from '@ui/errors';
import createErrorBanner from '@ui/ErrorBanner';
import createTimezoneBadge from '@ui/TimezoneBadge';
import {
  actions,
  selectors,
  subscribe,
  getState,
  type FileSnapshot,
  type FilesScanStatus,
} from './store';
import { emit, on } from './store/events';
import { runViewCleanups, registerViewCleanup } from './utils/viewLifecycle';
import {
  createFilesList,
  createFilesToolbar,
  type FilesListItem,
  type FilesListRowAction,
  VIRTUALIZE_THRESHOLD,
} from '@features/files';
import createButton from '@ui/Button';
import { createFilesLoaderSkeleton } from '@features/files/components/FilesLoaderSkeleton';
import {
  logScanAborted,
  logScanCompleted,
  logScanStarted,
  logPreviewBlocked,
} from './logging/files_ui';
import { decidePreview, isPreviewAllowed } from '@features/files/previewGate';

const ROOT: RootKey = 'attachments';
const IS_DEV = import.meta.env?.DEV === true;
const TEXT_PREVIEW_LIMIT = 20_000;

async function openFileExternally(path: string): Promise<boolean> {
  try {
    const mod = await import('@tauri-apps/plugin-opener');
    const open = (mod as { open?: (target: string) => Promise<void> }).open;
    if (typeof open === 'function') {
      await open(path);
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

function formatBytes(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let bytes = Math.max(0, value);
  while (bytes >= 1024 && index < units.length - 1) {
    bytes /= 1024;
    index += 1;
  }
  const precision = index === 0 || bytes >= 10 ? 0 : 1;
  return `${bytes.toFixed(precision)} ${units[index]}`;
}

function formatModified(value?: string | number | null): string {
  if (value === null || value === undefined) return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function renderBreadcrumb(
  path: string,
  container: HTMLElement,
  onNavigate: (nextPath: string) => void,
): void {
  container.innerHTML = '';
  container.setAttribute('aria-label', 'Current path');
  const segments = path.split(/[/\\]/).filter(Boolean);
  if (segments.length === 0) return;

  let accumulated = '';
  segments.forEach((segment, index) => {
    accumulated = index === 0 ? segment : `${accumulated}/${segment}`;
    const span = document.createElement('span');
    span.className = 'breadcrumb__segment';
    if (index === segments.length - 1) {
      span.classList.add('current');
      span.textContent = segment;
      span.setAttribute('aria-current', 'page');
    } else {
      const button = createButton({
        label: segment,
        variant: 'ghost',
        size: 'sm',
        className: 'breadcrumb__button',
        onClick: (event) => {
          event.preventDefault();
          onNavigate(accumulated);
        },
      });
      span.appendChild(button);
    }
    container.appendChild(span);
  });
}

interface ScanNoticeOptions {
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}

interface ScanNoticeInstance {
  element: HTMLDivElement;
  showScanning: () => void;
  showTimeout: () => void;
  hide: () => void;
}

function createScanNotice(options: ScanNoticeOptions): ScanNoticeInstance {
  const element = document.createElement('div');
  element.className = 'files__scan-status';
  element.hidden = true;
  element.setAttribute('role', 'status');

  const message = document.createElement('p');
  message.className = 'files__scan-message';
  message.setAttribute('aria-live', 'polite');
  message.setAttribute('aria-atomic', 'true');

  const actions = document.createElement('div');
  actions.className = 'files__scan-actions';

  const cancelButton = createButton({
    label: 'Cancel',
    variant: 'ghost',
    size: 'sm',
    onClick: (event) => {
      event.preventDefault();
      options.onCancel();
    },
  });

  const retryButton = createButton({
    label: 'Retry',
    variant: 'primary',
    size: 'sm',
    onClick: (event) => {
      event.preventDefault();
      options.onRetry();
    },
  });

  const dismissButton = createButton({
    label: 'Dismiss',
    variant: 'ghost',
    size: 'sm',
    onClick: (event) => {
      event.preventDefault();
      options.onDismiss();
    },
  });

  actions.append(cancelButton, retryButton, dismissButton);
  element.append(message, actions);

  return {
    element,
    showScanning() {
      element.hidden = false;
      message.textContent = 'Scanning files…';
      cancelButton.hidden = false;
      retryButton.hidden = true;
      dismissButton.hidden = true;
    },
    showTimeout() {
      element.hidden = false;
      message.textContent = 'Folder scan took too long. Try Retry or Dismiss to keep browsing.';
      cancelButton.hidden = true;
      retryButton.hidden = false;
      dismissButton.hidden = false;
    },
    hide() {
      element.hidden = true;
    },
  };
}

export async function FilesView(container: HTMLElement) {
  runViewCleanups(container);

  const section = document.createElement('section');
  section.className = 'files';

  const header = document.createElement('header');
  header.className = 'files__header';
  header.classList.add('stack-md');

  const headerInfo = document.createElement('div');
  headerInfo.className = 'files__header-info';
  const breadcrumbNav = document.createElement('nav');
  breadcrumbNav.className = 'breadcrumb';
  breadcrumbNav.setAttribute('aria-label', 'Current path');
  const scanDebug = document.createElement('div');
  scanDebug.className = 'files__scan-debug';
  if (!IS_DEV) {
    scanDebug.hidden = true;
  }
  headerInfo.append(breadcrumbNav, scanDebug);

  const preview = document.createElement('div');
  preview.id = 'preview';

  const reminderDetail = document.createElement('div');
  reminderDetail.className = 'files__reminder-detail';
  reminderDetail.hidden = true;
  reminderDetail.setAttribute('aria-live', 'polite');
  reminderDetail.setAttribute('aria-atomic', 'true');

  const previewContent = document.createElement('div');
  previewContent.className = 'files__preview-content';

  preview.append(reminderDetail, previewContent);

  let currentDir: string | null = selectors.files.path(getState());
  let previewToken = 0;
  let currentScan: {
    controller: AbortController;
    path: string;
    reason?: 'navigation' | 'timeout';
  } | null = null;
  let skeletonTimer: number | null = null;

  const appTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';

  const abortCurrentScan = (
    reason: 'navigation' | 'timeout',
    options: { log?: boolean } = {},
  ) => {
    if (!currentScan) return;
    currentScan.reason = reason;
    if (!currentScan.controller.signal.aborted) {
      currentScan.controller.abort();
    }
    if (options.log === true) {
      void logScanAborted(currentScan.path, reason);
    }
  };

  const renderReminderDetail = (item: FilesListItem | null) => {
    reminderDetail.innerHTML = '';
    if (
      !item ||
      item.entry.isDirectory === true ||
      item.reminder === undefined ||
      item.reminder === null
    ) {
      reminderDetail.hidden = true;
      return;
    }

    reminderDetail.hidden = false;

    const heading = document.createElement('h3');
    heading.textContent = 'Reminder';

    const formatted = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: item.reminderTz ?? appTimezone ?? 'UTC',
    }).format(new Date(item.reminder));

    const description = document.createElement('p');
    description.textContent = `Scheduled for ${formatted}`;

    const meta = document.createElement('div');
    meta.className = 'files__reminder-meta';

    const badge = createTimezoneBadge({
      eventTimezone: item.reminderTz,
      appTimezone,
      tooltipId: `file-reminder-${item.entry.name}-timezone`,
    });
    if (!badge.hidden) {
      meta.appendChild(badge);
    }

    reminderDetail.append(heading, description);
    if (meta.childElementCount > 0) reminderDetail.appendChild(meta);
  };

  const toolbar = createFilesToolbar({
    onSelectDirectory: async () => {
      const dir = await open({ directory: true });
      if (typeof dir !== 'string') return;
      try {
        const { base, realPath } = await canonicalizeAndVerify(dir, ROOT);
        const rel = realPath.slice(base.length) || '.';
        setDir(rel);
        await refreshDirectory(rel, 'dialog-select');
      } catch (error) {
        showError({ code: 'INFO', message: toUserMessage(error) });
      }
    },
    onCreateFile: async (name: string) => {
      if (!currentDir) return;
      const relPath = currentDir === '.' ? name : `${currentDir}/${name}`;
      try {
        await writeText(relPath, ROOT, '');
        await refreshDirectory(currentDir, 'create-file');
      } catch (error) {
        showError({ code: 'INFO', message: toUserMessage(error) });
        throw error;
      }
    },
    onCreateFolder: async (name: string) => {
      if (!currentDir) return;
      const relPath = currentDir === '.' ? name : `${currentDir}/${name}`;
      try {
        await mkdir(relPath, ROOT, { recursive: true });
        await refreshDirectory(currentDir, 'create-folder');
      } catch (error) {
        showError({ code: 'INFO', message: toUserMessage(error) });
        throw error;
      }
    },
  });

  const handleNavigate = async (nextPath: string) => {
    setDir(nextPath);
    await refreshDirectory(nextPath, 'breadcrumb');
  };

  const filesList = createFilesList({
    onActivate: (item) => {
      void handleActivate(item);
    },
    getRowActions: (): FilesListRowAction[] => [
      {
        label: 'Delete',
        className: 'files__action',
        onSelect: (current) => {
          void handleDelete(current);
        },
      },
    ],
    emptyState: {
      icon: '📁',
      title: STR.empty.filesTitle,
      body: 'Create a file or connect a folder to see it here.',
      actionLabel: 'New file',
    },
    onEmptyAction: () => toolbar.openCreateFile(),
  });

  const loaderSkeleton = createFilesLoaderSkeleton({ rows: 8 });
  loaderSkeleton.classList.add('files__loading');
  loaderSkeleton.hidden = true;

  const scanNotice = createScanNotice({
    onCancel: () => {
      abortCurrentScan('navigation');
    },
    onRetry: () => {
      if (currentDir) {
        void refreshDirectory(currentDir, 'retry');
      }
    },
    onDismiss: () => {
      actions.files.resetScan();
      loaderSkeleton.hidden = true;
      filesList.element.hidden = false;
      filesList.element.setAttribute('aria-busy', 'false');
      scanNotice.hide();
      setListBusy(false);
    },
  });

  header.append(headerInfo, toolbar.element);

  const panel = document.createElement('div');
  panel.className = 'card files__panel';
  const errorRegion = document.createElement('div');
  errorRegion.className = 'files__error-region';
  errorRegion.setAttribute('aria-live', 'polite');
  errorRegion.setAttribute('aria-atomic', 'true');
  errorRegion.hidden = true;
  panel.append(errorRegion, loaderSkeleton, scanNotice.element, filesList.element);

  section.append(header, panel, preview);
  container.innerHTML = '';
  container.appendChild(section);

  const initialSnapshot = selectors.files.snapshot(getState());
  let inlineError: ReturnType<typeof createErrorBanner> | null = null;

  const clearInlineError = () => {
    if (inlineError) {
      inlineError.remove();
      inlineError = null;
    }
    errorRegion.hidden = true;
  };

  const setListBusy = (busy: boolean) => {
    if (busy) {
      filesList.element.hidden = true;
      filesList.element.setAttribute('aria-hidden', 'true');
      filesList.element.setAttribute('aria-busy', 'true');
    } else {
      filesList.element.hidden = false;
      filesList.element.removeAttribute('aria-hidden');
      filesList.element.setAttribute('aria-busy', 'false');
    }
  };

  const clearScanDebug = () => {
    if (!IS_DEV) return;
    scanDebug.textContent = '';
    scanDebug.hidden = true;
  };

  const applyScanDebug = (entryCount: number) => {
    if (!IS_DEV) return;
    const status = selectors.files.scanStatus(getState());
    if (status === 'scanning') {
      scanDebug.textContent = 'Scanning…';
      scanDebug.hidden = false;
      return;
    }
    const duration = selectors.files.scanDuration(getState());
    const parts: string[] = [];
    if (duration !== null) {
      parts.push(`scan: ${duration} ms`);
    }
    parts.push(`entries: ${entryCount}`);
    parts.push(`virtualized: ${entryCount > VIRTUALIZE_THRESHOLD ? 'yes' : 'no'}`);
    scanDebug.textContent = parts.join(' • ');
    scanDebug.hidden = false;
  };

  const stopSkeletonDelay = () => {
    if (skeletonTimer !== null) {
      window.clearTimeout(skeletonTimer);
      skeletonTimer = null;
    }
  };

  const updateScanUi = (status: FilesScanStatus) => {
    if (status === 'scanning') {
      setListBusy(true);
      loaderSkeleton.hidden = false;
      scanNotice.hide();
      stopSkeletonDelay();
      if (IS_DEV) {
        scanDebug.textContent = 'Scanning…';
        scanDebug.hidden = false;
      }
      skeletonTimer = window.setTimeout(() => {
        if (selectors.files.scanStatus(getState()) !== 'scanning') return;
        loaderSkeleton.hidden = true;
        scanNotice.showScanning();
      }, 2000);
      return;
    }

    stopSkeletonDelay();

    if (status === 'timeout') {
      setListBusy(false);
      loaderSkeleton.hidden = true;
      scanNotice.showTimeout();
      if (IS_DEV) {
        scanDebug.textContent = 'Scan timed out';
        scanDebug.hidden = false;
      }
      return;
    }

    if (status === 'error') {
      setListBusy(false);
      loaderSkeleton.hidden = true;
      scanNotice.hide();
      if (IS_DEV) {
        scanDebug.textContent = 'Scan failed';
        scanDebug.hidden = false;
      }
      return;
    }

    // idle or done
    setListBusy(false);
    loaderSkeleton.hidden = true;
    scanNotice.hide();
    if (status === 'idle') {
      clearScanDebug();
    }
  };

  const showInlineError = (message: string, detail?: string) => {
    setListBusy(false);
    loaderSkeleton.hidden = true;
    scanNotice.hide();
    clearScanDebug();
    if (!inlineError) {
      inlineError = createErrorBanner({
        message,
        detail,
        onDismiss: () => {
          clearInlineError();
        },
      });
      errorRegion.appendChild(inlineError);
    } else {
      inlineError.update({ message, detail });
    }
    errorRegion.hidden = false;
  };

  if (initialSnapshot) {
    setListBusy(false);
  }

  function setDir(dir: string | null) {
    currentDir = dir;
    toolbar.setDirectoryAvailable(Boolean(dir));
    toolbar.setDirectoryContext(dir);
  }

  async function refreshDirectory(dir: string, source: string): Promise<void> {
    clearInlineError();
    abortCurrentScan('navigation', { log: true });
    const controller = new AbortController();
    currentScan = { controller, path: dir };
    actions.files.beginScan();
    void logScanStarted(dir);

    const abortPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });

    const timeoutId = window.setTimeout(() => {
      if (controller.signal.aborted) return;
      if (currentScan) currentScan.reason = 'timeout';
      actions.files.timeoutScan();
      void logScanAborted(dir, 'timeout');
      abortCurrentScan('timeout');
    }, 10_000);

    try {
      const entries = await Promise.race([readDir(dir, ROOT), abortPromise]);
      if (controller.signal.aborted) return;
      const ts = Date.now();
      const payload = actions.files.updateSnapshot({
        items: entries,
        ts,
        path: dir,
        source,
      });
      emit('files:updated', payload);
      const duration = selectors.files.scanDuration(getState());
      void logScanCompleted({
        path: dir,
        scanTimeMs: duration,
        entryCount: entries.length,
        virtualized: entries.length > VIRTUALIZE_THRESHOLD,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      const detail = toUserMessage(error);
      actions.files.failScan({ message: 'Unable to load files', detail });
      emit('files:load-error', {
        message: 'Unable to load files',
        detail,
      });
    } finally {
      window.clearTimeout(timeoutId);
      if (currentScan?.controller === controller) {
        currentScan = null;
      }
    }
  }

  async function handleDelete(item: FilesListItem) {
    try {
      await remove(item.relativePath, ROOT, {
        recursive: item.entry.isDirectory === true,
      });
      if (currentDir) {
        await refreshDirectory(currentDir, 'delete');
      }
    } catch (error) {
      showError({ code: 'INFO', message: toUserMessage(error) });
    }
  }

  const renderPreviewPlaceholder = (message: string, realPath: string) => {
    previewContent.innerHTML = '';
    const messageEl = document.createElement('p');
    messageEl.className = 'files__preview-message';
    messageEl.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'files__preview-actions';
    const openButton = createButton({
      label: 'Open Externally',
      variant: 'ghost',
      onClick: async (event) => {
        event.preventDefault();
        const ok = await openFileExternally(realPath);
        if (!ok) {
          showError({
            code: 'INFO',
            message: 'Unable to open the file externally.',
          });
        }
      },
    });
    actions.append(openButton);
    previewContent.append(messageEl, actions);
  };

  const attachPreviewErrorBoundary = (
    element: HTMLImageElement | HTMLEmbedElement,
    realPath: string,
  ) => {
    const fail = () => {
      renderPreviewPlaceholder('Preview failed to load. Open externally instead.', realPath);
    };
    element.addEventListener('error', fail, { once: true });
    element.addEventListener('abort', fail, { once: true });
  };

  const renderImagePreview = (realPath: string, tokenValue: number, alt: string) => {
    const url = convertFileSrc(realPath);
    const img = document.createElement('img');
    img.src = url;
    img.alt = alt;
    img.className = 'files__preview-image';
    attachPreviewErrorBoundary(img, realPath);
    if (tokenValue === previewToken) {
      previewContent.appendChild(img);
    }
  };

  const renderPdfPreview = (realPath: string, tokenValue: number) => {
    const url = convertFileSrc(realPath);
    const embed = document.createElement('embed');
    embed.src = url;
    embed.type = 'application/pdf';
    embed.style.width = '100%';
    embed.style.height = '600px';
    attachPreviewErrorBoundary(embed, realPath);
    if (tokenValue === previewToken) {
      previewContent.appendChild(embed);
    }
  };

  const renderTextPreview = async (
    relativePath: string,
    realPath: string,
    tokenValue: number,
  ) => {
    try {
      const content = await readText(relativePath, ROOT);
      if (tokenValue !== previewToken) return;
      const truncated = content.length > TEXT_PREVIEW_LIMIT;
      const previewText = truncated
        ? `${content.slice(0, TEXT_PREVIEW_LIMIT)}…`
        : content;
      const pre = document.createElement('pre');
      pre.className = 'files__preview-text';
      pre.textContent = previewText;
      previewContent.appendChild(pre);
      if (truncated) {
        const info = document.createElement('p');
        info.className = 'files__preview-message';
        info.textContent = 'Preview truncated. Open externally to view the full file.';
        previewContent.appendChild(info);
        const actions = document.createElement('div');
        actions.className = 'files__preview-actions';
        const openButton = createButton({
          label: 'Open Externally',
          variant: 'ghost',
          onClick: async (event) => {
            event.preventDefault();
            const ok = await openFileExternally(realPath);
            if (!ok) {
              showError({
                code: 'INFO',
                message: 'Unable to open the file externally.',
              });
            }
          },
        });
        actions.append(openButton);
        previewContent.appendChild(actions);
      }
    } catch (error) {
      if (tokenValue !== previewToken) return;
      renderPreviewPlaceholder('Preview unavailable — Open Externally', realPath);
    }
  };

  async function handleActivate(item: FilesListItem) {
    if (item.entry.isDirectory) {
      renderReminderDetail(null);
      await handleNavigate(item.relativePath);
      return;
    }
    const token = ++previewToken;
    renderReminderDetail(item);
    previewContent.innerHTML = '';
    const decision = decidePreview({
      mime: item.entry.mime ?? null,
      sizeBytes:
        typeof item.entry.size_bytes === 'number' ? item.entry.size_bytes : null,
    });
    try {
      const { realPath } = await canonicalizeAndVerify(item.relativePath, ROOT);
      await rejectSymlinks(realPath, ROOT);
      if (token !== previewToken) return;
      if (!isPreviewAllowed(decision)) {
        void logPreviewBlocked({ path: item.relativePath, reason: decision.reason });
        renderPreviewPlaceholder(decision.message, realPath);
        return;
      }

      if (decision.kind === 'image') {
        renderImagePreview(realPath, token, item.entry.name);
        return;
      }

      if (decision.kind === 'pdf') {
        renderPdfPreview(realPath, token);
        return;
      }

      await renderTextPreview(item.relativePath, realPath, token);
    } catch (error) {
      showError({ code: 'INFO', message: toUserMessage(error) });
    }
  }

  async function applySnapshot(snapshot: FileSnapshot | null) {
    if (!snapshot) {
      setDir(null);
      filesList.clear();
      breadcrumbNav.innerHTML = '';
      previewContent.innerHTML = '';
      renderReminderDetail(null);
      clearScanDebug();
      return;
    }
    setListBusy(false);
    loaderSkeleton.hidden = true;
    scanNotice.hide();
    clearInlineError();
    setDir(snapshot.path);
    renderBreadcrumb(snapshot.path, breadcrumbNav, handleNavigate);
    renderReminderDetail(null);
    const items: FilesListItem[] = snapshot.items.map((entry) => ({
      entry,
      relativePath:
        snapshot.path === '.' ? entry.name : `${snapshot.path}/${entry.name}`,
      typeLabel: entry.isDirectory ? 'Folder' : 'File',
      sizeLabel: entry.isDirectory ? '' : formatBytes(entry.size_bytes ?? null),
      modifiedLabel: formatModified(entry.modified_at ?? null),
      reminder: entry.reminder ?? null,
      reminderTz: entry.reminder_tz ?? null,
    }));
    filesList.setItems(items);
    applyScanDebug(items.length);
  }

  setDir(currentDir);

  const unsubscribe = subscribe(selectors.files.snapshot, (snapshot) => {
    void applySnapshot(snapshot);
  });
  registerViewCleanup(container, unsubscribe);

  const unsubscribeScan = subscribe(selectors.files.scanStatus, (status) => {
    updateScanUi(status);
  });
  registerViewCleanup(container, unsubscribeScan);

  const stopLoadError = on('files:load-error', ({ message, detail }) => {
    showInlineError(message, detail);
  });
  registerViewCleanup(container, stopLoadError);

  const stopHousehold = on('household:changed', async () => {
    const dir = selectors.files.path(getState()) ?? currentDir;
    if (dir) await refreshDirectory(dir, 'household-change');
  });
  registerViewCleanup(container, stopHousehold);

  registerViewCleanup(container, () => {
    abortCurrentScan('navigation');
    stopSkeletonDelay();
    clearScanDebug();
  });
}
