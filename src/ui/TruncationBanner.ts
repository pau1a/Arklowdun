import createButton from "@ui/Button";

export interface TruncationBannerProps {
  count: number;
  hidden?: boolean;
  onDismiss?: () => void;
  onRefine?: () => void;
  closeLabel?: string;
  closeAriaLabel?: string;
  refineLabel?: string;
  refineAriaLabel?: string;
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
  if (!Number.isFinite(count)) return "0";
  const safe = Math.max(0, Math.trunc(count));
  return safe.toLocaleString();
}

export function createTruncationBanner(
  props: TruncationBannerProps,
): TruncationBannerElement {
  const root = document.createElement("div") as TruncationBannerElement;
  root.dataset.ui = "truncation-banner";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  const message = document.createElement("span");
  message.className = "truncation-banner__message";

  const dismissHandler = (event: MouseEvent) => {
    event.preventDefault();
    currentOnDismiss?.();
  };

  const refineHandler = (event: MouseEvent) => {
    event.preventDefault();
    currentOnRefine?.();
  };

  const refineButton = createButton({
    label: props.refineLabel ?? "Refine filters",
    variant: "ghost",
    size: "sm",
    className: "truncation-banner__refine",
    ariaLabel: props.refineAriaLabel ?? "Refine filters",
    onClick: refineHandler,
  });

  const closeButton = createButton({
    label: props.closeLabel ?? "Dismiss",
    variant: "ghost",
    size: "sm",
    className: "truncation-banner__dismiss",
    ariaLabel: props.closeAriaLabel ?? "Dismiss truncation message",
    onClick: dismissHandler,
  });

  root.append(message, refineButton, closeButton);

  let currentCount = props.count;
  let currentHidden = props.hidden ?? false;
  let currentOnDismiss = props.onDismiss ?? null;
  let currentOnRefine = props.onRefine ?? null;
  let currentClassName = props.className;
  let currentCloseLabel = props.closeLabel ?? "Dismiss";
  let currentCloseAriaLabel = props.closeAriaLabel ?? "Dismiss truncation message";
  let currentRefineLabel = props.refineLabel ?? "Refine filters";
  let currentRefineAriaLabel = props.refineAriaLabel ?? "Refine filters";

  const sync = () => {
    message.textContent = `Only showing the first ${formatCount(currentCount)} events — refine filters to see more.`;
    root.hidden = currentHidden;
    applyClassName(root, "truncation-banner", currentClassName);
    closeButton.update({ label: currentCloseLabel, ariaLabel: currentCloseAriaLabel });
    refineButton.update({
      label: currentRefineLabel,
      ariaLabel: currentRefineAriaLabel,
      disabled: currentOnRefine === null,
    });
    refineButton.hidden = currentOnRefine === null;
  };

  sync();

  root.update = (next: Partial<TruncationBannerProps>) => {
    if (next.count !== undefined) currentCount = next.count;
    if (next.hidden !== undefined) currentHidden = next.hidden;
    if (next.onDismiss !== undefined) currentOnDismiss = next.onDismiss ?? null;
    if (next.onRefine !== undefined) currentOnRefine = next.onRefine ?? null;
    if (next.className !== undefined) currentClassName = next.className;
    if (next.closeLabel !== undefined) currentCloseLabel = next.closeLabel ?? "Dismiss";
    if (next.closeAriaLabel !== undefined) {
      currentCloseAriaLabel = next.closeAriaLabel ?? "Dismiss truncation message";
    }
    if (next.refineLabel !== undefined) currentRefineLabel = next.refineLabel ?? "Refine filters";
    if (next.refineAriaLabel !== undefined) {
      currentRefineAriaLabel = next.refineAriaLabel ?? "Refine filters";
    }
    sync();
  };

  return root;
}

export default createTruncationBanner;
