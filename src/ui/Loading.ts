export type LoadingSkeletonVariant = 'block' | 'list' | 'inline';

export interface LoadingSkeletonProps {
  variant?: LoadingSkeletonVariant;
  label?: string;
  rows?: number;
  inlineWidth?: string;
}

export type LoadingSkeletonElement = HTMLDivElement & {
  update: (next: Partial<LoadingSkeletonProps>) => void;
};

const clampRows = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  const rounded = Math.max(1, Math.floor(value));
  return Math.min(8, rounded);
};

function renderListRows(surface: HTMLElement, rows: number): void {
  const count = clampRows(rows);
  for (let index = 0; index < count; index += 1) {
    const row = document.createElement('div');
    row.className = 'loading__row';

    const primary = document.createElement('div');
    primary.className = 'loading__bar loading__bar--primary';
    primary.style.width = `${60 + (index % 3) * 8}%`;

    const secondary = document.createElement('div');
    secondary.className = 'loading__bar loading__bar--secondary';
    secondary.style.width = `${24 + ((index + 1) % 3) * 6}%`;

    row.append(primary, secondary);
    surface.appendChild(row);
  }
}

export function createLoading(
  props: LoadingSkeletonProps = {},
): LoadingSkeletonElement {
  const root = document.createElement('div') as LoadingSkeletonElement;
  root.dataset.ui = 'loading';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-busy', 'true');

  const surface = document.createElement('div');
  surface.className = 'loading__surface';

  const label = document.createElement('span');
  label.className = 'loading__label';

  let currentVariant: LoadingSkeletonVariant = props.variant ?? 'block';
  let currentRows = clampRows(props.rows ?? 4);
  let currentLabel = props.label ?? '';
  let currentInlineWidth = props.inlineWidth ?? '';

  const syncSurface = () => {
    surface.innerHTML = '';
    if (currentVariant === 'list') {
      renderListRows(surface, currentRows);
    } else if (currentVariant === 'inline') {
      const inline = document.createElement('div');
      inline.className = 'loading__inline';
      surface.appendChild(inline);
    } else {
      const block = document.createElement('div');
      block.className = 'loading__block';
      surface.appendChild(block);
    }
  };

  const sync = () => {
    root.className = `loading loading--${currentVariant}`;
    if (currentVariant === 'inline') {
      if (currentInlineWidth) {
        root.style.setProperty('--loading-inline-width', currentInlineWidth);
      } else {
        root.style.removeProperty('--loading-inline-width');
      }
    } else {
      root.style.removeProperty('--loading-inline-width');
    }

    syncSurface();

    if (currentLabel) {
      label.textContent = currentLabel;
      label.hidden = false;
      if (!label.isConnected) {
        root.appendChild(label);
      }
    } else {
      label.textContent = '';
      label.hidden = true;
      if (label.isConnected) {
        label.remove();
      }
    }
  };

  root.appendChild(surface);
  sync();

  root.update = (next: Partial<LoadingSkeletonProps>) => {
    if (next.variant !== undefined) currentVariant = next.variant;
    if (next.rows !== undefined) currentRows = clampRows(next.rows);
    if (next.label !== undefined) currentLabel = next.label ?? '';
    if (next.inlineWidth !== undefined) currentInlineWidth = next.inlineWidth ?? '';
    sync();
  };

  return root;
}

export default createLoading;
