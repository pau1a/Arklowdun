import createButton, { type ButtonProps } from '@ui/Button';

export interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  id?: string;
  icon?: string;
}

export type EmptyStateElement = HTMLDivElement & {
  update: (next: Partial<EmptyStateProps>) => void;
};

export function createEmptyState(props: EmptyStateProps): EmptyStateElement {
  const root = document.createElement('div') as EmptyStateElement;
  root.className = 'empty-state';
  root.dataset.ui = 'empty-state';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  if (props.id) root.id = props.id;

  let currentTitle = props.title;
  let currentDescription = props.description;
  let currentActionLabel = props.actionLabel;
  let currentIcon = props.icon;
  let currentOnAction = props.onAction ?? null;
  let actionButton: ReturnType<typeof createButton> | null = null;

  const title = document.createElement('h3');
  title.className = 'empty-state__title';
  const description = document.createElement('p');
  description.className = 'empty-state__desc';
  const icon = document.createElement('div');
  icon.className = 'empty-state__icon';

  const sync = () => {
    if (currentIcon) {
      icon.textContent = currentIcon;
      if (!icon.isConnected) root.insertBefore(icon, title);
    } else if (icon.isConnected) {
      icon.remove();
    }

    title.textContent = currentTitle;
    if (currentDescription) {
      description.textContent = currentDescription;
      if (!description.isConnected) root.appendChild(description);
    } else if (description.isConnected) {
      description.remove();
    }

    if (currentActionLabel && currentOnAction) {
      if (!actionButton) {
        const buttonProps: ButtonProps = {
          label: currentActionLabel,
          variant: 'primary',
          onClick: (event) => {
            event.preventDefault();
            currentOnAction?.();
          },
          className: 'empty-state__action',
        };
        actionButton = createButton(buttonProps);
      } else {
        actionButton.update({ label: currentActionLabel });
      }
      if (!actionButton.isConnected) root.appendChild(actionButton);
    } else if (actionButton && actionButton.isConnected) {
      actionButton.remove();
    }
  };

  root.appendChild(title);
  sync();

  root.update = (next: Partial<EmptyStateProps>) => {
    if (next.title !== undefined) currentTitle = next.title;
    if (next.description !== undefined) currentDescription = next.description;
    if (next.actionLabel !== undefined) currentActionLabel = next.actionLabel;
    if (next.onAction !== undefined) currentOnAction = next.onAction ?? null;
    if (next.icon !== undefined) currentIcon = next.icon;
    if (next.id !== undefined) {
      if (next.id) root.id = next.id;
      else root.removeAttribute('id');
    }
    sync();
  };

  return root;
}

export default createEmptyState;
