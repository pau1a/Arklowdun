import createButton, { type ButtonSize, type ButtonVariant } from '@ui/Button';

export type EmptyStateIcon = string | HTMLElement;

export type EmptyStateButtonCta = {
  kind: 'button';
  label: string;
  onClick: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  ariaLabel?: string;
};

export type EmptyStateLinkCta = {
  kind: 'link';
  label: string;
  href: string;
  target?: string;
  rel?: string;
};

export type EmptyStateCta = EmptyStateButtonCta | EmptyStateLinkCta;

export interface EmptyStateProps {
  icon?: EmptyStateIcon;
  title: string;
  body?: string;
  cta?: EmptyStateCta;
  id?: string;
}

export type EmptyStateElement = HTMLDivElement & {
  update: (next: Partial<EmptyStateProps>) => void;
};

function setIconContent(slot: HTMLElement, icon: EmptyStateIcon | undefined): void {
  slot.innerHTML = '';
  if (!icon) {
    slot.hidden = true;
    return;
  }
  slot.hidden = false;
  if (typeof icon === 'string') {
    slot.textContent = icon;
  } else {
    slot.appendChild(icon);
  }
}

export function createEmptyState(props: EmptyStateProps): EmptyStateElement {
  const root = document.createElement('div') as EmptyStateElement;
  root.className = 'empty-state';
  root.dataset.ui = 'empty-state';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  if (props.id) root.id = props.id;

  const iconSlot = document.createElement('div');
  iconSlot.className = 'empty-state__icon';

  const title = document.createElement('h3');
  title.className = 'empty-state__title';

  const body = document.createElement('p');
  body.className = 'empty-state__body';

  const ctaSlot = document.createElement('div');
  ctaSlot.className = 'empty-state__cta';

  root.append(iconSlot, title, body, ctaSlot);

  let currentIcon = props.icon;
  let currentTitle = props.title;
  let currentBody = props.body ?? '';
  let currentCta = props.cta ?? null;

  let buttonCta: ReturnType<typeof createButton> | null = null;
  let linkCta: HTMLAnchorElement | null = null;

  const syncCta = () => {
    if (!currentCta) {
      ctaSlot.hidden = true;
      if (buttonCta && buttonCta.isConnected) buttonCta.remove();
      if (linkCta && linkCta.isConnected) linkCta.remove();
      return;
    }

    ctaSlot.hidden = false;
    if (currentCta.kind === 'button') {
      linkCta?.remove();
      linkCta = null;
      if (!buttonCta) {
        buttonCta = createButton({
          label: currentCta.label,
          variant: currentCta.variant ?? 'primary',
          size: currentCta.size ?? 'md',
          ariaLabel: currentCta.ariaLabel,
          className: 'empty-state__cta-button',
          onClick: (event) => {
            event.preventDefault();
            currentCta.onClick();
          },
        });
      } else {
        buttonCta.update({
          label: currentCta.label,
          variant: currentCta.variant ?? 'primary',
          size: currentCta.size ?? 'md',
          ariaLabel: currentCta.ariaLabel,
        });
      }
      if (!buttonCta.isConnected) ctaSlot.appendChild(buttonCta);
    } else {
      buttonCta?.remove();
      buttonCta = null;
      if (!linkCta) {
        linkCta = document.createElement('a');
        linkCta.className = 'empty-state__link';
      }
      linkCta.textContent = currentCta.label;
      linkCta.href = currentCta.href;
      if (currentCta.target) linkCta.target = currentCta.target;
      else linkCta.removeAttribute('target');
      if (currentCta.rel) linkCta.rel = currentCta.rel;
      else linkCta.removeAttribute('rel');
      if (!linkCta.isConnected) ctaSlot.appendChild(linkCta);
    }
  };

  const sync = () => {
    setIconContent(iconSlot, currentIcon);
    title.textContent = currentTitle;
    body.textContent = currentBody;
    body.hidden = currentBody.trim().length === 0;
    syncCta();
  };

  sync();

  root.update = (next: Partial<EmptyStateProps>) => {
    if (next.id !== undefined) {
      if (next.id) root.id = next.id;
      else root.removeAttribute('id');
    }
    if (next.icon !== undefined) currentIcon = next.icon;
    if (next.title !== undefined) currentTitle = next.title;
    if (next.body !== undefined) currentBody = next.body ?? '';
    if (next.cta !== undefined) currentCta = next.cta ?? null;
    sync();
  };

  return root;
}

export default createEmptyState;
