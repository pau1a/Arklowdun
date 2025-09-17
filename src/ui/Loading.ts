export type LoadingKind = 'inline' | 'block';

export interface LoadingProps {
  kind: LoadingKind;
  skeleton?: boolean;
  label?: string;
}

export type LoadingElement = HTMLDivElement & {
  update: (next: Partial<LoadingProps>) => void;
};

export function createLoading(props: LoadingProps): LoadingElement {
  const root = document.createElement('div') as LoadingElement;
  root.className = 'loading';
  root.dataset.ui = 'loading';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');

  const spinner = document.createElement('span');
  spinner.className = 'loading__spinner';

  const label = document.createElement('span');
  label.className = 'loading__label';

  let currentKind: LoadingKind = props.kind;
  let currentSkeleton = props.skeleton ?? false;
  let currentLabel = props.label ?? 'Loading…';

  const sync = () => {
    root.className = `loading loading--${currentKind}`;
    if (currentSkeleton) root.classList.add('loading--skeleton');
    label.textContent = currentLabel;
  };

  root.append(spinner, label);
  sync();

  root.update = (next: Partial<LoadingProps>) => {
    if (next.kind !== undefined) currentKind = next.kind;
    if (next.skeleton !== undefined) currentSkeleton = next.skeleton;
    if (next.label !== undefined) currentLabel = next.label;
    sync();
  };

  return root;
}

export default createLoading;
