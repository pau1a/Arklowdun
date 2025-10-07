import type { FsEntryLite } from '@store/types';
import createButton, {
  type ButtonSize,
  type ButtonVariant,
} from '@ui/Button';
import createEmptyState, { type EmptyStateIcon } from '@ui/EmptyState';

export interface FilesListItem {
  entry: FsEntryLite;
  relativePath: string;
  typeLabel: string;
  sizeLabel?: string;
  modifiedLabel?: string;
  reminder?: number | null;
  reminderTz?: string | null;
}

export interface FilesListRowAction {
  label: string;
  onSelect: (item: FilesListItem, event: MouseEvent) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  ariaLabel?: string;
  className?: string;
}

export interface FilesListProps {
  onActivate: (item: FilesListItem, event: Event) => void;
  getRowActions?: (item: FilesListItem) => FilesListRowAction[];
  emptyState?: {
    icon?: EmptyStateIcon;
    title: string;
    body?: string;
    actionLabel?: string;
  };
  onEmptyAction?: () => void;
}

export interface FilesListInstance {
  element: HTMLDivElement;
  setItems: (items: FilesListItem[]) => void;
  clear: () => void;
}

export const VIRTUALIZE_THRESHOLD = 300;
const OVERSCAN = 8;
const DEFAULT_ROW_HEIGHT = 52;

function isActionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('[data-ui="button"]'));
}

function renderEmptyState(props: FilesListProps): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'files__empty-state';
  if (props.emptyState) {
    const empty = createEmptyState({
      icon: props.emptyState.icon,
      title: props.emptyState.title,
      body: props.emptyState.body,
      cta:
        props.emptyState.actionLabel && props.onEmptyAction
          ? {
              kind: 'button' as const,
              label: props.emptyState.actionLabel,
              onClick: props.onEmptyAction,
            }
          : undefined,
    });
    wrapper.appendChild(empty);
  }
  return wrapper;
}

function createHeaderRow(): HTMLDivElement {
  const header = document.createElement('div');
  header.className = 'files__row files__row--header';
  header.setAttribute('role', 'row');
  header.setAttribute('aria-rowindex', '1');
  const columns = ['Name', 'Type', 'Size', 'Modified', ''];
  columns.forEach((text, index) => {
    const cell = document.createElement('div');
    cell.className = 'files__cell files__cell--header';
    cell.setAttribute('role', 'columnheader');
    cell.textContent = text;
    cell.setAttribute('aria-colindex', String(index + 1));
    header.appendChild(cell);
  });
  return header;
}

function createRow(
  item: FilesListItem,
  props: FilesListProps,
  index: number,
  focusRow: (index: number) => void,
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'files__row';
  row.dataset.path = item.relativePath;
  row.dataset.name = item.entry.name;
  row.dataset.index = String(index);
  row.setAttribute('role', 'row');
  row.tabIndex = 0;
  row.setAttribute(
    'aria-label',
    `${item.entry.name} ${item.sizeLabel ?? ''} ${item.modifiedLabel ?? ''}`.trim(),
  );

  const nameCell = document.createElement('div');
  nameCell.className = 'files__cell files__cell--name';
  nameCell.setAttribute('role', 'gridcell');
  const icon = document.createElement('span');
  icon.className = 'files__icon';
  icon.textContent = item.entry.isDirectory ? '📁' : '📄';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'files__name';
  nameSpan.textContent = item.entry.name;
  nameSpan.title = item.entry.name;
  nameCell.append(icon, nameSpan);

  const typeCell = document.createElement('div');
  typeCell.className = 'files__cell';
  typeCell.setAttribute('role', 'gridcell');
  typeCell.textContent = item.typeLabel;

  const sizeCell = document.createElement('div');
  sizeCell.className = 'files__cell';
  sizeCell.setAttribute('role', 'gridcell');
  sizeCell.textContent = item.sizeLabel ?? '';

  const modifiedCell = document.createElement('div');
  modifiedCell.className = 'files__cell';
  modifiedCell.setAttribute('role', 'gridcell');
  modifiedCell.textContent = item.modifiedLabel ?? '';

  const actionsCell = document.createElement('div');
  actionsCell.className = 'files__cell files__actions-cell';
  actionsCell.setAttribute('role', 'gridcell');

  if (props.getRowActions) {
    const actions = props.getRowActions(item);
    for (const action of actions) {
      const button = createButton({
        label: action.label,
        variant: action.variant ?? 'ghost',
        size: action.size ?? 'sm',
        className: action.className ?? 'files__action',
        ariaLabel: action.ariaLabel,
        onClick: (event) => {
          event.stopPropagation();
          action.onSelect(item, event);
        },
      });
      actionsCell.appendChild(button);
    }
  }

  row.addEventListener('click', (event) => {
    if (isActionTarget(event.target)) return;
    props.onActivate(item, event);
  });

  row.addEventListener('keydown', (event) => {
    const key = event.key;
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      if (isActionTarget(event.target)) return;
      props.onActivate(item, event);
      return;
    }
    if (key === 'ArrowDown' || key === 'Down') {
      event.preventDefault();
      focusRow(index + 1);
      return;
    }
    if (key === 'ArrowUp' || key === 'Up') {
      event.preventDefault();
      focusRow(index - 1);
      return;
    }
  });

  row.append(nameCell, typeCell, sizeCell, modifiedCell, actionsCell);
  return row;
}

export function createFilesList(props: FilesListProps): FilesListInstance {
  const container = document.createElement('div');
  container.className = 'files__list';
  container.dataset.ui = 'files-list';

  const header = createHeaderRow();
  container.appendChild(header);

  const viewport = document.createElement('div');
  viewport.className = 'files__viewport';
  viewport.setAttribute('role', 'grid');
  viewport.setAttribute('aria-label', 'Files');
  viewport.setAttribute('aria-colcount', '5');
  viewport.setAttribute('aria-rowcount', '1');

  const scrollerRoot = document.createElement('div');
  scrollerRoot.className = 'files__scroller-root';

  const spacer = document.createElement('div');
  spacer.className = 'files__spacer';
  spacer.style.position = 'relative';
  spacer.style.width = '100%';

  const rowsContainer = document.createElement('div');
  rowsContainer.className = 'files__rows';
  rowsContainer.style.position = 'absolute';
  rowsContainer.style.left = '0';
  rowsContainer.style.right = '0';
  rowsContainer.style.top = '0';

  spacer.appendChild(rowsContainer);
  scrollerRoot.appendChild(spacer);
  viewport.appendChild(scrollerRoot);

  const emptyState = renderEmptyState(props);
  emptyState.hidden = true;
  viewport.appendChild(emptyState);

  container.appendChild(viewport);

  let items: FilesListItem[] = [];
  let rowHeight = DEFAULT_ROW_HEIGHT;
  let virtualizationEnabled = false;
  let visibleStart = 0;
  let visibleEnd = 0;
  let lastMeasuredCount = 0;
  let renderToken = 0;
  let pendingFrame: number | null = null;

  const cancelProgressiveRender = () => {
    renderToken += 1;
    if (pendingFrame !== null) {
      window.cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    }
  };

  const focusRow = (index: number) => {
    if (index < 0 || index >= items.length) return;
    if (virtualizationEnabled) {
      const targetTop = index * rowHeight;
      const targetBottom = targetTop + rowHeight;
      const viewTop = viewport.scrollTop;
      const viewBottom = viewTop + viewport.clientHeight;
      if (targetTop < viewTop) {
        viewport.scrollTop = targetTop;
      } else if (targetBottom > viewBottom) {
        viewport.scrollTop = targetBottom - viewport.clientHeight;
      }
      requestAnimationFrame(() => {
        const row = rowsContainer.querySelector<HTMLElement>(
          `[data-index="${index}"]`,
        );
        row?.focus();
      });
      return;
    }
    const row = rowsContainer.querySelector<HTMLElement>(
      `[data-index="${index}"]`,
    );
    row?.focus();
  };

  function renderRange(start: number, end: number) {
    rowsContainer.innerHTML = '';
    for (let i = start; i < end; i += 1) {
      const row = createRow(items[i], props, i, focusRow);
      row.style.top = '0';
      rowsContainer.appendChild(row);
    }
    rowsContainer.style.transform = `translateY(${start * rowHeight}px)`;
    visibleStart = start;
    visibleEnd = end;
  }

  function measureRowHeight(): void {
    if (!items.length) return;
    if (!virtualizationEnabled) return;
    if (lastMeasuredCount === items.length && rowsContainer.firstElementChild) return;
    const probe = createRow(items[0], props, 0, focusRow);
    probe.style.visibility = 'hidden';
    rowsContainer.innerHTML = '';
    rowsContainer.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    if (rect.height) {
      rowHeight = rect.height;
    }
    rowsContainer.innerHTML = '';
    lastMeasuredCount = items.length;
  }

  function updateVirtualization(): void {
    if (!virtualizationEnabled) return;
    measureRowHeight();
    spacer.style.height = `${items.length * rowHeight}px`;
    const viewportHeight = viewport.clientHeight || rowHeight;
    const scrollTop = viewport.scrollTop;
    const start = Math.max(Math.floor(scrollTop / rowHeight) - OVERSCAN, 0);
    const end = Math.min(
      items.length,
      start + Math.ceil(viewportHeight / rowHeight) + OVERSCAN * 2,
    );
    if (start !== visibleStart || end !== visibleEnd) {
      renderRange(start, end);
    } else {
      rowsContainer.style.transform = `translateY(${start * rowHeight}px)`;
    }
  }

  viewport.addEventListener('scroll', () => {
    if (!virtualizationEnabled) return;
    updateVirtualization();
  });

  const resizeObserver =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          if (!virtualizationEnabled) return;
          updateVirtualization();
        })
      : null;
  if (resizeObserver) {
    resizeObserver.observe(viewport);
  }

  const setItems = (nextItems: FilesListItem[]) => {
    cancelProgressiveRender();
    items = [...nextItems];
    viewport.setAttribute('aria-rowcount', String(items.length + 1));
    if (!items.length) {
      emptyState.hidden = false;
      scrollerRoot.hidden = true;
      rowsContainer.innerHTML = '';
      virtualizationEnabled = false;
      spacer.style.height = 'auto';
      viewport.setAttribute('aria-rowcount', '1');
      return;
    }

    emptyState.hidden = true;
    scrollerRoot.hidden = false;

    virtualizationEnabled = items.length > VIRTUALIZE_THRESHOLD;
    if (!virtualizationEnabled) {
      spacer.style.height = 'auto';
      rowsContainer.style.position = 'relative';
      rowsContainer.style.transform = '';
      rowsContainer.innerHTML = '';
      const currentToken = renderToken;
      const renderChunk = (startIndex: number) => {
        if (renderToken !== currentToken) return;
        const endIndex = Math.min(items.length, startIndex + 200);
        for (let index = startIndex; index < endIndex; index += 1) {
          const row = createRow(items[index], props, index, focusRow);
          rowsContainer.appendChild(row);
        }
        if (endIndex < items.length) {
          pendingFrame = window.requestAnimationFrame(() => renderChunk(endIndex));
        } else {
          pendingFrame = null;
        }
      };
      renderChunk(0);
      return;
    }

    rowsContainer.style.position = 'absolute';
    rowsContainer.style.transform = 'translateY(0px)';
    viewport.scrollTop = 0;
    visibleStart = 0;
    visibleEnd = 0;
    updateVirtualization();
  };

  return {
    element: container,
    setItems,
    clear() {
      cancelProgressiveRender();
      items = [];
      rowsContainer.innerHTML = '';
      emptyState.hidden = false;
      scrollerRoot.hidden = true;
      spacer.style.height = 'auto';
      viewport.setAttribute('aria-rowcount', '1');
    },
  };
}

export default createFilesList;
