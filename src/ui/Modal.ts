import { registerOverlay } from './keys';

const FOCUSABLE_SELECTORS =
  [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleId: string;
  descriptionId?: string;
  initialFocus?: HTMLElement | (() => HTMLElement | null) | null;
  closeOnOverlayClick?: boolean;
}

export interface ModalInstance {
  root: HTMLDivElement;
  dialog: HTMLDivElement;
  setOpen: (open: boolean) => void;
  update: (next: Partial<Omit<ModalProps, 'onOpenChange'>>) => void;
  isOpen: () => boolean;
}

function resolveInitialFocus(
  initialFocus: ModalProps['initialFocus'],
): HTMLElement | null {
  if (!initialFocus) return null;
  if (typeof initialFocus === 'function') {
    try {
      return initialFocus() ?? null;
    } catch {
      return null;
    }
  }
  return initialFocus;
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  const elements = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
  return Array.from(elements).filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return true;
  });
}

export function createModal(props: ModalProps): ModalInstance {
  const root = document.createElement('div');
  root.className = 'modal-overlay';
  root.dataset.ui = 'modal';
  const dialog = document.createElement('div');
  dialog.className = 'modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.tabIndex = -1;
  root.appendChild(dialog);

  let isOpen = Boolean(props.open);
  let currentTitleId = props.titleId;
  let currentDescriptionId = props.descriptionId;
  let currentInitialFocus = props.initialFocus ?? null;
  let closeOnOverlay = props.closeOnOverlayClick ?? true;
  let onOpenChange = props.onOpenChange;
  let lastFocusedElement: HTMLElement | null = null;
  let restoreScroll = '';
  let releaseOverlay: (() => void) | null = null;

  const applyAria = () => {
    dialog.setAttribute('aria-labelledby', currentTitleId);
    if (currentDescriptionId) dialog.setAttribute('aria-describedby', currentDescriptionId);
    else dialog.removeAttribute('aria-describedby');
  };

  applyAria();

  const focusTrapHandler = (event: KeyboardEvent) => {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const handleOverlayClick = (event: MouseEvent) => {
    if (!closeOnOverlay) return;
    if (event.target === root) {
      onOpenChange(false);
    }
  };

  root.addEventListener('click', handleOverlayClick);
  root.addEventListener('keydown', (event) => focusTrapHandler(event as KeyboardEvent));

  const applyOpen = () => {
    if (isOpen) {
      if (!root.isConnected) {
        const host = document.getElementById('modal-root');
        (host ?? document.body).appendChild(root);
      }
      root.removeAttribute('hidden');
      restoreScroll = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      lastFocusedElement = document.activeElement as HTMLElement | null;
      releaseOverlay = registerOverlay('modal', () => onOpenChange(false));
      const desired = resolveInitialFocus(currentInitialFocus) ?? getFocusableElements(dialog)[0];
      window.setTimeout(() => {
        if (!isOpen) return;
        if (desired && dialog.contains(desired)) {
          desired.focus();
        } else {
          dialog.focus();
        }
      }, 0);
    } else {
      if (root.isConnected) {
        root.remove();
      }
      releaseOverlay?.();
      releaseOverlay = null;
      document.body.style.overflow = restoreScroll;
      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        window.setTimeout(() => {
          try {
            lastFocusedElement?.focus();
          } catch {
            /* ignore */
          }
        }, 0);
      }
    }
  };

  applyOpen();

  return {
    root,
    dialog,
    setOpen(nextOpen: boolean) {
      if (isOpen === nextOpen) return;
      isOpen = nextOpen;
      applyOpen();
    },
    update(next: Partial<Omit<ModalProps, 'onOpenChange'>>) {
      if (next.titleId !== undefined) {
        currentTitleId = next.titleId;
        applyAria();
      }
      if (next.descriptionId !== undefined) {
        currentDescriptionId = next.descriptionId;
        applyAria();
      }
      if (next.initialFocus !== undefined) {
        currentInitialFocus = next.initialFocus;
      }
      if (next.closeOnOverlayClick !== undefined) {
        closeOnOverlay = next.closeOnOverlayClick;
      }
      if (next.open !== undefined) {
        if (isOpen !== next.open) {
          isOpen = next.open;
          applyOpen();
        }
      }
    },
    isOpen() {
      return isOpen;
    },
  };
}

export default createModal;
