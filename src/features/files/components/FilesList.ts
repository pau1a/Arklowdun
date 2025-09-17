import type { FsEntryLite } from '@store/types';
import createButton, {
  type ButtonSize,
  type ButtonVariant,
} from '@ui/Button';
import createEmptyState from '@ui/EmptyState';

export interface FilesListItem {
  entry: FsEntryLite;
  relativePath: string;
  typeLabel: string;
  sizeLabel?: string;
  modifiedLabel?: string;
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
    title: string;
    description?: string;
    actionLabel?: string;
  };
  onEmptyAction?: () => void;
}

export interface FilesListInstance {
  element: HTMLTableElement;
  setItems: (items: FilesListItem[]) => void;
  clear: () => void;
}

function isActionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('[data-ui="button"]'));
}

function renderEmptyState(props: FilesListProps): HTMLTableRowElement {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 5;
  if (props.emptyState) {
    const empty = createEmptyState({
      ...props.emptyState,
      onAction: props.onEmptyAction,
    });
    cell.appendChild(empty);
  }
  row.appendChild(cell);
  return row;
}

export function createFilesList(props: FilesListProps): FilesListInstance {
  const table = document.createElement('table');
  table.className = 'files__table';
  table.dataset.ui = 'files-list';

  const thead = table.createTHead();
  const headerRow = thead.insertRow();
  const headers = ['Name', 'Type', 'Size', 'Modified', ''];
  for (const text of headers) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = text;
    headerRow.appendChild(th);
  }

  const tbody = table.createTBody();

  const setItems = (items: FilesListItem[]) => {
    tbody.innerHTML = '';
    if (!items.length) {
      tbody.appendChild(renderEmptyState(props));
      return;
    }

    for (const item of items) {
      const row = document.createElement('tr');
      row.tabIndex = 0;
      row.dataset.path = item.relativePath;
      row.dataset.name = item.entry.name;
      row.setAttribute('aria-label', `${item.entry.name}, ${item.typeLabel}`);

      const nameCell = document.createElement('td');
      const icon = document.createElement('span');
      icon.className = 'files__icon';
      icon.textContent = item.entry.isDirectory ? '📁' : '📄';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'files__name';
      nameSpan.textContent = item.entry.name;
      nameSpan.title = item.entry.name;
      nameCell.append(icon, nameSpan);

      const typeCell = document.createElement('td');
      typeCell.textContent = item.typeLabel;

      const sizeCell = document.createElement('td');
      sizeCell.textContent = item.sizeLabel ?? '';

      const modCell = document.createElement('td');
      modCell.textContent = item.modifiedLabel ?? '';

      const actionsCell = document.createElement('td');
      actionsCell.className = 'files__actions-cell';

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
        }
      });

      row.append(nameCell, typeCell, sizeCell, modCell, actionsCell);
      tbody.appendChild(row);
    }
  };

  return {
    element: table,
    setItems,
    clear() {
      tbody.innerHTML = '';
    },
  };
}

export default createFilesList;
