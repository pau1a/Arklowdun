import createButton from '@ui/Button';

export interface ErrorBannerProps {
  message: string;
  onDismiss?: () => void;
}

export type ErrorBannerElement = HTMLDivElement & {
  update: (next: Partial<ErrorBannerProps>) => void;
};

export function createErrorBanner(props: ErrorBannerProps): ErrorBannerElement {
  const root = document.createElement('div') as ErrorBannerElement;
  root.className = 'error-banner';
  root.dataset.ui = 'error-banner';
  root.setAttribute('role', 'alert');

  let currentMessage = props.message;
  let currentOnDismiss = props.onDismiss ?? null;

  const messageEl = document.createElement('span');
  messageEl.className = 'error-banner__message';
  const actions = document.createElement('div');
  actions.className = 'error-banner__actions';

  const sync = () => {
    messageEl.textContent = currentMessage;
    if (currentOnDismiss) {
      if (!actions.firstChild) {
        const button = createButton({
          label: 'Dismiss',
          variant: 'ghost',
          size: 'sm',
          className: 'error-banner__dismiss',
          onClick: (event) => {
            event.preventDefault();
            currentOnDismiss?.();
          },
        });
        actions.appendChild(button);
      }
    } else {
      actions.innerHTML = '';
    }
  };

  root.append(messageEl, actions);
  sync();

  root.update = (next: Partial<ErrorBannerProps>) => {
    if (next.message !== undefined) currentMessage = next.message;
    if (next.onDismiss !== undefined) currentOnDismiss = next.onDismiss ?? null;
    sync();
  };

  return root;
}

export default createErrorBanner;
