import { open } from '@lib/ipc/dialog';
import {
  readDir,
  writeText,
  remove,
  mkdir,
  toUserMessage,
  type RootKey,
} from './files/safe-fs';
import { canonicalizeAndVerify, rejectSymlinks } from './files/path';
import { convertFileSrc } from '@lib/ipc/core';
import { STR } from '@ui/strings';
import { showError } from '@ui/errors';
import createLoading from '@ui/Loading';
import createErrorBanner from '@ui/ErrorBanner';
import {
  actions,
  selectors,
  subscribe,
  getState,
  type FileSnapshot,
} from './store';
import { emit, on } from './store/events';
import { runViewCleanups, registerViewCleanup } from './utils/viewLifecycle';
import {
  createFilesList,
  createFilesToolbar,
  type FilesListItem,
  type FilesListRowAction,
} from '@features/files';
import createButton from '@ui/Button';

const ROOT: RootKey = 'attachments';

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

export async function FilesView(container: HTMLElement) {
  runViewCleanups(container);

  const section = document.createElement('section');
  section.className = 'files';

  const header = document.createElement('header');
  header.className = 'files__header';
  header.classList.add('stack-md');

  const headerInfo = document.createElement('div');
  headerInfo.className = 'files__header-info';
  const title = document.createElement('h2');
  title.textContent = 'Files';
  const breadcrumbNav = document.createElement('nav');
  breadcrumbNav.className = 'breadcrumb';
  breadcrumbNav.setAttribute('aria-label', 'Current path');
  headerInfo.append(title, breadcrumbNav);

  const preview = document.createElement('div');
  preview.id = 'preview';

  let currentDir: string | null = selectors.files.path(getState());
  let previewToken = 0;

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

  const loadingIndicator = createLoading({
    variant: 'list',
    label: 'Loading files…',
    rows: 6,
  });
  loadingIndicator.classList.add('files__loading');

  header.append(headerInfo, toolbar.element);

  const panel = document.createElement('div');
  panel.className = 'card files__panel';
  const errorRegion = document.createElement('div');
  errorRegion.className = 'files__error-region';
  errorRegion.setAttribute('aria-live', 'polite');
  errorRegion.setAttribute('aria-atomic', 'true');
  errorRegion.hidden = true;
  panel.append(errorRegion, loadingIndicator, filesList.element);

  section.append(header, panel, preview);
  container.innerHTML = '';
  container.appendChild(section);

  const initialSnapshot = selectors.files.snapshot(getState());
  let inlineError: ReturnType<typeof createErrorBanner> | null = null;
  let isLoading = false;

  const clearInlineError = () => {
    if (inlineError) {
      inlineError.remove();
      inlineError = null;
    }
    errorRegion.hidden = true;
  };

  const setLoading = (active: boolean) => {
    if (isLoading === active) return;
    isLoading = active;
    loadingIndicator.hidden = !active;
    if (active) {
      filesList.element.hidden = true;
      filesList.element.setAttribute('aria-hidden', 'true');
    } else {
      filesList.element.hidden = false;
      filesList.element.removeAttribute('aria-hidden');
    }
  };

  const showInlineError = (message: string, detail?: string) => {
    setLoading(false);
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
    setLoading(false);
  } else {
    setLoading(true);
  }

  function setDir(dir: string | null) {
    currentDir = dir;
    toolbar.setDirectoryAvailable(Boolean(dir));
  }

  async function refreshDirectory(dir: string, source: string): Promise<void> {
    setLoading(true);
    clearInlineError();
    try {
      const entries = await readDir(dir, ROOT);
      const ts = Date.now();
      const payload = actions.files.updateSnapshot({
        items: entries,
        ts,
        path: dir,
        source,
      });
      emit('files:updated', payload);
    } catch (error) {
      emit('files:load-error', {
        message: 'Unable to load files',
        detail: toUserMessage(error),
      });
    } finally {
      setLoading(false);
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

  async function handleActivate(item: FilesListItem) {
    if (item.entry.isDirectory) {
      await handleNavigate(item.relativePath);
      return;
    }
    const token = ++previewToken;
    preview.innerHTML = '';
    const ext = item.entry.name.split('.').pop()?.toLowerCase();
    try {
      const { realPath } = await canonicalizeAndVerify(item.relativePath, ROOT);
      await rejectSymlinks(realPath, ROOT);
      if (token !== previewToken) return;
      const url = convertFileSrc(realPath);
      if (
        ext &&
        ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'].includes(ext)
      ) {
        const img = document.createElement('img');
        img.src = url;
        img.style.maxWidth = '100%';
        if (token === previewToken) preview.appendChild(img);
      } else if (ext === 'pdf') {
        const embed = document.createElement('embed');
        embed.src = url;
        embed.type = 'application/pdf';
        embed.style.width = '100%';
        embed.style.height = '600px';
        if (token === previewToken) preview.appendChild(embed);
      } else {
        preview.textContent = 'No preview available';
      }
    } catch (error) {
      showError({ code: 'INFO', message: toUserMessage(error) });
    }
  }

  async function applySnapshot(snapshot: FileSnapshot | null) {
    if (!snapshot) {
      setDir(null);
      filesList.clear();
      breadcrumbNav.innerHTML = '';
      preview.innerHTML = '';
      return;
    }
    setLoading(false);
    clearInlineError();
    setDir(snapshot.path);
    renderBreadcrumb(snapshot.path, breadcrumbNav, handleNavigate);
    const items: FilesListItem[] = snapshot.items.map((entry) => ({
      entry,
      relativePath:
        snapshot.path === '.' ? entry.name : `${snapshot.path}/${entry.name}`,
      typeLabel: entry.isDirectory ? 'Folder' : 'File',
      sizeLabel: '',
      modifiedLabel: '',
    }));
    filesList.setItems(items);
  }

  setDir(currentDir);

  const unsubscribe = subscribe(selectors.files.snapshot, (snapshot) => {
    void applySnapshot(snapshot);
  });
  registerViewCleanup(container, unsubscribe);

  const stopLoadError = on('files:load-error', ({ message, detail }) => {
    showInlineError(message, detail);
  });
  registerViewCleanup(container, stopLoadError);

  const stopHousehold = on('household:changed', async () => {
    const dir = selectors.files.path(getState()) ?? currentDir;
    if (dir) await refreshDirectory(dir, 'household-change');
  });
  registerViewCleanup(container, stopHousehold);
}
