export interface TooltipProps {
  content: string;
  delay?: number;
  id?: string;
}

function ensureContainer(): HTMLElement {
  let container = document.getElementById('ui-tooltip-root');
  if (!container) {
    container = document.createElement('div');
    container.id = 'ui-tooltip-root';
    container.setAttribute('role', 'presentation');
    document.body.appendChild(container);
  }
  return container;
}

function createTooltipElement(props: TooltipProps): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'tooltip';
  el.dataset.ui = 'tooltip';
  el.setAttribute('role', 'tooltip');
  if (props.id) el.id = props.id;
  el.textContent = props.content;
  el.hidden = true;
  return el;
}

export function attachTooltip(target: HTMLElement, props: TooltipProps): () => void {
  const container = ensureContainer();
  const tooltip = createTooltipElement(props);
  const id = tooltip.id || `tooltip-${Math.random().toString(36).slice(2, 9)}`;
  tooltip.id = id;
  let showTimer: number | undefined;
  let isVisible = false;
  const delay = props.delay ?? 200;
  const prevDescribedBy = target.getAttribute('aria-describedby');

  const show = () => {
    if (isVisible) return;
    if (!tooltip.isConnected) container.appendChild(tooltip);
    const rect = target.getBoundingClientRect();
    tooltip.style.position = 'fixed';
    tooltip.style.top = `${rect.bottom + 8}px`;
    tooltip.style.left = `${rect.left}px`;
    tooltip.hidden = false;
    isVisible = true;
    const describedBy = prevDescribedBy ? `${prevDescribedBy} ${id}`.trim() : id;
    target.setAttribute('aria-describedby', describedBy);
  };

  const hide = () => {
    if (!isVisible) return;
    tooltip.hidden = true;
    isVisible = false;
    if (prevDescribedBy) target.setAttribute('aria-describedby', prevDescribedBy);
    else target.removeAttribute('aria-describedby');
  };

  const scheduleShow = () => {
    window.clearTimeout(showTimer);
    showTimer = window.setTimeout(show, delay);
  };

  const cancelShow = () => {
    window.clearTimeout(showTimer);
    hide();
  };

  const onFocus = () => scheduleShow();
  const onBlur = () => cancelShow();
  const onMouseEnter = () => scheduleShow();
  const onMouseLeave = () => cancelShow();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      cancelShow();
    }
  };

  target.addEventListener('focus', onFocus);
  target.addEventListener('blur', onBlur);
  target.addEventListener('mouseenter', onMouseEnter);
  target.addEventListener('mouseleave', onMouseLeave);
  target.addEventListener('keydown', onKeyDown);

  return () => {
    window.clearTimeout(showTimer);
    hide();
    target.removeEventListener('focus', onFocus);
    target.removeEventListener('blur', onBlur);
    target.removeEventListener('mouseenter', onMouseEnter);
    target.removeEventListener('mouseleave', onMouseLeave);
    target.removeEventListener('keydown', onKeyDown);
    if (tooltip.parentElement === container) {
      container.removeChild(tooltip);
    }
    if (prevDescribedBy) target.setAttribute('aria-describedby', prevDescribedBy);
    else target.removeAttribute('aria-describedby');
  };
}

export default attachTooltip;
