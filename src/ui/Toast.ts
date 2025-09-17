export type ToastKind = 'info' | 'error' | 'success';

export interface ToastOptions {
  kind: ToastKind;
  message: string;
  timeoutMs?: number;
}

export interface ToastEvent extends ToastOptions {
  id: number;
}

type Listener = (event: ToastEvent) => void;

const listeners = new Set<Listener>();
let counter = 0;

function ensureContainer(): HTMLElement {
  let container = document.getElementById('ui-toast-region');
  if (!container) {
    container = document.createElement('div');
    container.id = 'ui-toast-region';
    container.className = 'toast-region';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(container);
  }
  return container;
}

function renderToast(options: ToastEvent): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `toast toast--${options.kind}`;
  el.dataset.ui = 'toast';
  el.textContent = options.message;
  return el;
}

function emit(event: ToastEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // ignore listener errors
    }
  }
}

function show(options: ToastOptions): void {
  const container = ensureContainer();
  const event: ToastEvent = { ...options, id: ++counter };
  const toastEl = renderToast(event);
  container.appendChild(toastEl);
  emit(event);
  const timeout = options.timeoutMs ?? 4000;
  window.setTimeout(() => {
    toastEl.classList.add('toast--exit');
    window.setTimeout(() => {
      if (toastEl.parentElement === container) {
        container.removeChild(toastEl);
      }
    }, 200);
  }, timeout);
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const toast = {
  show,
  subscribe,
};

export default toast;
