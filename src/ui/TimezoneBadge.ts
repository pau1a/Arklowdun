import attachTooltip from './Tooltip';

export interface TimezoneBadgeProps {
  eventTimezone?: string | null;
  appTimezone?: string | null;
  tooltipId?: string;
  className?: string;
}

export type TimezoneBadgeElement = HTMLSpanElement & {
  update: (next: Partial<TimezoneBadgeProps>) => void;
};

function normalise(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function shouldDisplayBadge(eventTz: string | null, appTz: string | null): boolean {
  if (!eventTz) return false;
  if (!appTz) return true;
  return eventTz.toLowerCase() !== appTz.toLowerCase();
}

function buildTooltip(eventTz: string, appTz: string): string {
  return `This event is set in ${eventTz}. Current app timezone is ${appTz}.`;
}

function applyClassName(el: HTMLElement, base: string, className?: string | null): void {
  el.className = base;
  if (!className) return;
  for (const token of className.split(/\s+/)) {
    if (token) el.classList.add(token);
  }
}

export function createTimezoneBadge(props: TimezoneBadgeProps): TimezoneBadgeElement {
  const element = document.createElement('span') as TimezoneBadgeElement;
  element.dataset.ui = 'timezone-badge';
  element.setAttribute('role', 'note');

  let currentEventTz = normalise(props.eventTimezone);
  let currentAppTz =
    normalise(props.appTimezone) ??
    normalise(
      typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
    );
  let currentTooltipId = props.tooltipId ?? undefined;
  let currentClassName = props.className ?? null;

  let detachTooltip: (() => void) | null = null;

  const sync = () => {
    const eventTz = currentEventTz;
    const appTz = currentAppTz;
    const shouldShow = shouldDisplayBadge(eventTz, appTz);

    if (!shouldShow || !eventTz || !appTz) {
      element.hidden = true;
      element.tabIndex = -1;
      element.setAttribute('aria-hidden', 'true');
      element.removeAttribute('aria-label');
      element.textContent = '';
      detachTooltip?.();
      detachTooltip = null;
      applyClassName(element, 'timezone-badge', currentClassName);
      return;
    }

    const tooltip = buildTooltip(eventTz, appTz);
    element.hidden = false;
    element.tabIndex = 0;
    element.setAttribute('aria-hidden', 'false');
    element.setAttribute('aria-label', tooltip);
    element.textContent = eventTz;
    applyClassName(element, 'timezone-badge', currentClassName);

    detachTooltip?.();
    detachTooltip = attachTooltip(element, {
      content: tooltip,
      id: currentTooltipId,
    });
  };

  const originalRemove = element.remove.bind(element);
  element.remove = () => {
    detachTooltip?.();
    detachTooltip = null;
    originalRemove();
  };

  element.update = (next: Partial<TimezoneBadgeProps>) => {
    if (Object.prototype.hasOwnProperty.call(next, 'eventTimezone')) {
      currentEventTz = normalise(next.eventTimezone);
    }
    if (Object.prototype.hasOwnProperty.call(next, 'appTimezone')) {
      currentAppTz = normalise(next.appTimezone);
    }
    if (Object.prototype.hasOwnProperty.call(next, 'tooltipId')) {
      currentTooltipId = next.tooltipId ?? undefined;
    }
    if (Object.prototype.hasOwnProperty.call(next, 'className')) {
      currentClassName = next.className ?? null;
    }
    sync();
  };

  sync();

  return element;
}

export default createTimezoneBadge;
