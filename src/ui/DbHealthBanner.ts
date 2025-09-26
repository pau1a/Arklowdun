import createButton from '@ui/Button';
import { recoveryText } from '@strings/recovery';

export type DbHealthBannerState = 'running' | 'healthy' | 'unhealthy';

export interface DbHealthBannerProps {
  state: DbHealthBannerState;
  message?: string | null;
  description?: string | null;
  hidden?: boolean;
  showSpinner?: boolean;
  disableDetails?: boolean;
  onViewDetails?: () => void;
}

export type DbHealthBannerElement = HTMLDivElement & {
  update: (next: Partial<DbHealthBannerProps>) => void;
};

const defaultMessages: Record<DbHealthBannerState, string> = {
  running: recoveryText('db.health.banner.running'),
  healthy: recoveryText('db.health.banner.healthy'),
  unhealthy: recoveryText('db.health.banner.unhealthy'),
};

function applyStateClass(el: HTMLElement, state: DbHealthBannerState): void {
  el.className = 'db-health-banner';
  el.classList.add(`db-health-banner--${state}`);
  el.dataset.state = state;
}

export function createDbHealthBanner(
  props: DbHealthBannerProps,
): DbHealthBannerElement {
  const root = document.createElement('div') as DbHealthBannerElement;
  root.dataset.ui = 'db-health-banner';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-busy', 'false');

  const status = document.createElement('div');
  status.className = 'db-health-banner__status';

  const spinner = document.createElement('span');
  spinner.className = 'db-health-banner__spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const message = document.createElement('p');
  message.className = 'db-health-banner__message';

  status.append(spinner, message);

  const description = document.createElement('p');
  description.className = 'db-health-banner__description';
  description.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'db-health-banner__actions';

  const viewButton = createButton({
    label: recoveryText('db.common.view_details'),
    variant: 'ghost',
    size: 'sm',
    className: 'db-health-banner__details',
    onClick: (event) => {
      event.preventDefault();
      currentOnViewDetails?.();
    },
  });

  actions.appendChild(viewButton);
  root.append(status, description, actions);

  let currentState: DbHealthBannerState = props.state;
  let currentMessage = props.message ?? defaultMessages[currentState];
  let currentDescription = props.description ?? '';
  let currentHidden = props.hidden ?? false;
  let currentShowSpinner = props.showSpinner ?? currentState === 'running';
  let currentDisableDetails = props.disableDetails ?? false;
  let currentOnViewDetails = props.onViewDetails ?? null;

  const sync = () => {
    applyStateClass(root, currentState);
    root.hidden = currentHidden;
    root.setAttribute('aria-busy', currentShowSpinner ? 'true' : 'false');

    const messageText = currentMessage?.trim().length
      ? currentMessage
      : defaultMessages[currentState];
    message.textContent = messageText;

    if (currentDescription && currentDescription.trim().length > 0) {
      description.textContent = currentDescription;
      description.hidden = false;
    } else {
      description.textContent = '';
      description.hidden = true;
    }

    spinner.hidden = !currentShowSpinner;

    if (currentOnViewDetails) {
      viewButton.hidden = false;
      viewButton.update({ disabled: currentDisableDetails });
    } else {
      viewButton.hidden = true;
    }
    actions.hidden = viewButton.hidden;
  };

  sync();

  root.update = (next: Partial<DbHealthBannerProps>) => {
    if (next.state !== undefined) currentState = next.state;
    if (next.message !== undefined)
      currentMessage = next.message ?? defaultMessages[currentState];
    if (next.description !== undefined)
      currentDescription = next.description ?? '';
    if (next.hidden !== undefined) currentHidden = next.hidden;
    if (next.showSpinner !== undefined) currentShowSpinner = next.showSpinner;
    if (next.disableDetails !== undefined)
      currentDisableDetails = next.disableDetails;
    if (next.onViewDetails !== undefined)
      currentOnViewDetails = next.onViewDetails ?? null;
    sync();
  };

  return root;
}

export default createDbHealthBanner;
