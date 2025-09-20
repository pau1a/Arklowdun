import createButton from '@ui/Button';

export interface TruncationBannerProps {
  count: number;
  hidden?: boolean;
  onDismiss?: () => void;
  closeLabel?: string;
  closeAriaLabel?: string;
  className?: string;
}

export type TruncationBannerElement = HTMLDivElement & {
  update: (next: Partial<TruncationBannerProps>) => void;
};

function applyClassName(el: HTMLElement, base: string, className?: string): void {
  el.className = base;
  if (!className) return;
  for (const token of className.split(/\s+/)) {
    if (token) el.classList.add(token);
  }
}

function formatCount(count: number): string {
  if (!Number.isFinite(count)) return '0';
  const safe = Math.max(0, Math.trunc(count));
  return safe.toLocaleString();
}

export function createTruncationBanner(
  props: TruncationBannerProps,
): TruncationBannerElement {
  const root = document.createElement('div') as TruncationBannerElement;
  root.dataset.ui = 'truncation-banner';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');

  const message = document.createElement('span');
  message.className = 'truncation-banner__message';

  const dismissHandler = (event: MouseEvent) => {
    event.preventDefault();
    currentOnDismiss?.();
  };

  const closeButton = createButton({
    label: props.closeLabel ?? 'Close',
    variant: 'ghost',
    size: 'sm',
    className: 'truncation-banner__dismiss',
    ariaLabel: props.closeAriaLabel ?? 'Close truncation message',
    onClick: dismissHandler,
  });

  root.append(message, closeButton);

  let currentCount = props.count;
  let currentHidden = props.hidden ?? false;
  let currentOnDismiss = props.onDismiss ?? null;
  let currentClassName = props.className;
  let currentCloseLabel = props.closeLabel ?? 'Close';
  let currentCloseAriaLabel = props.closeAriaLabel ?? 'Close truncation message';

  const sync = () => {
    message.textContent = `This list was shortened to the first ${formatCount(currentCount)} results.`;
    root.hidden = currentHidden;
    applyClassName(root, 'truncation-banner', currentClassName);
    closeButton.update({ label: currentCloseLabel, ariaLabel: currentCloseAriaLabel });
  };

  sync();

  root.update = (next: Partial<TruncationBannerProps>) => {
    if (next.count !== undefined) currentCount = next.count;
    if (next.hidden !== undefined) currentHidden = next.hidden;
    if (next.onDismiss !== undefined) currentOnDismiss = next.onDismiss ?? null;
    if (next.className !== undefined) currentClassName = next.className;
    if (next.closeLabel !== undefined) currentCloseLabel = next.closeLabel ?? 'Close';
    if (next.closeAriaLabel !== undefined) {
      currentCloseAriaLabel = next.closeAriaLabel ?? 'Close truncation message';
    }
    sync();
  };

  return root;
}

export default createTruncationBanner;
