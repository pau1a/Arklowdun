import createButton from '@ui/Button';
import { toast, type ToastKind } from '@ui/Toast';

export interface ErrorBannerProps {
  message: string;
  detail?: string;
  onDismiss?: () => void;
  promoteToToast?: {
    label?: string;
    message?: string;
    kind?: ToastKind;
  };
}

export type ErrorBannerElement = HTMLDivElement & {
  update: (next: Partial<ErrorBannerProps>) => void;
};

let detailIdCounter = 0;
const nextDetailId = () => {
  detailIdCounter += 1;
  return `error-banner-detail-${detailIdCounter}`;
};

export function createErrorBanner(props: ErrorBannerProps): ErrorBannerElement {
  const root = document.createElement('div') as ErrorBannerElement;
  root.className = 'error-banner';
  root.dataset.ui = 'error-banner';
  root.setAttribute('role', 'alert');

  const header = document.createElement('div');
  header.className = 'error-banner__header';

  const messageEl = document.createElement('span');
  messageEl.className = 'error-banner__message';

  const actions = document.createElement('div');
  actions.className = 'error-banner__actions';

  header.append(messageEl, actions);

  const detail = document.createElement('pre');
  detail.className = 'error-banner__detail';
  detail.id = nextDetailId();
  detail.hidden = true;

  root.append(header, detail);

  let currentMessage = props.message;
  let currentDetail = props.detail ?? '';
  let currentOnDismiss = props.onDismiss ?? null;
  let currentPromotion = props.promoteToToast ?? null;
  let detailExpanded = false;

  const detailButton = createButton({
    label: 'Show details',
    variant: 'ghost',
    size: 'sm',
    className: 'error-banner__detail-toggle',
    onClick: (event) => {
      event.preventDefault();
      detailExpanded = !detailExpanded;
      syncDetail();
    },
  });
  detailButton.setAttribute('aria-controls', detail.id);
  detailButton.setAttribute('aria-expanded', 'false');

  let dismissButton: ReturnType<typeof createButton> | null = null;
  let promoteButton: ReturnType<typeof createButton> | null = null;

  const syncDetail = () => {
    const hasDetail = currentDetail.trim().length > 0;
    if (!hasDetail) {
      if (detailButton.isConnected) detailButton.remove();
      detail.textContent = '';
      detail.hidden = true;
      detailExpanded = false;
      root.classList.remove('error-banner--expanded');
      return;
    }

    detail.textContent = currentDetail;
    detail.hidden = !detailExpanded;
    root.classList.toggle('error-banner--expanded', detailExpanded);
    detailButton.update({ label: detailExpanded ? 'Hide details' : 'Show details' });
    detailButton.setAttribute('aria-expanded', String(detailExpanded));
    if (!detailButton.isConnected) actions.prepend(detailButton);
  };

  const syncDismiss = () => {
    if (!currentOnDismiss) {
      dismissButton?.remove();
      dismissButton = null;
      return;
    }

    if (!dismissButton) {
      dismissButton = createButton({
        label: 'Dismiss',
        variant: 'ghost',
        size: 'sm',
        className: 'error-banner__dismiss',
        onClick: (event) => {
          event.preventDefault();
          currentOnDismiss?.();
        },
      });
    }
    if (!dismissButton.isConnected) actions.appendChild(dismissButton);
  };

  const syncPromotion = () => {
    if (!currentPromotion) {
      promoteButton?.remove();
      promoteButton = null;
      return;
    }

    const promoteLabel = currentPromotion.label ?? 'Open alert';

    if (!promoteButton) {
      promoteButton = createButton({
        label: promoteLabel,
        variant: 'ghost',
        size: 'sm',
        className: 'error-banner__promote',
        onClick: (event) => {
          event.preventDefault();
          const promotion = currentPromotion;
          const kind = promotion?.kind ?? 'error';
          const message = promotion?.message ?? currentMessage;
          toast.show({ kind, message });
        },
      });
    } else {
      promoteButton.update({ label: promoteLabel });
    }
    if (!promoteButton.isConnected) actions.appendChild(promoteButton);
  };

  const syncActions = () => {
    syncDetail();
    syncPromotion();
    syncDismiss();
    actions.hidden = actions.childElementCount === 0;
  };

  const sync = () => {
    messageEl.textContent = currentMessage;
    syncActions();
  };

  sync();

  root.update = (next: Partial<ErrorBannerProps>) => {
    if (next.message !== undefined) currentMessage = next.message;
    if (next.detail !== undefined) currentDetail = next.detail ?? '';
    if (next.onDismiss !== undefined) currentOnDismiss = next.onDismiss ?? null;
    if (next.promoteToToast !== undefined) currentPromotion = next.promoteToToast ?? null;
    sync();
  };

  return root;
}

export default createErrorBanner;
