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
  refineButton: HTMLButtonElement;
};

function applyClassName(el: HTMLElement, base: string, className?: string): void {
  el.className = base;
  if (!className) return;
  for (const token of className.split(/\s+/)) {
    if (token) el.classList.add(token);
  }
}

function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function formatCount(count: number): string {
  return normalizeCount(count).toLocaleString();
}

function bannerCopy(count: number): string {
  const normalized = normalizeCount(count);
  const formatted = normalized.toLocaleString();
  const suffix = normalized === 1 ? "event" : "events";
  return `Only showing the first ${formatted} ${suffix} — refine filters to see more.`;
}

export function createTruncationBanner(
  props: TruncationBannerProps,
): TruncationBannerElement {
  const root = document.createElement("div") as TruncationBannerElement;
  root.dataset.ui = "truncation-banner";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-atomic", "true");
  root.setAttribute("data-testid", "truncation-banner limit=0");

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

  let currentCount = normalizeCount(props.count);
  let currentHidden = props.hidden ?? false;
  let currentOnDismiss = props.onDismiss ?? null;
  let currentOnRefine = props.onRefine ?? null;
  let currentClassName = props.className;
  let currentCloseLabel = props.closeLabel ?? "Dismiss";
  let currentCloseAriaLabel = props.closeAriaLabel ?? "Dismiss truncation message";
  let currentRefineLabel = props.refineLabel ?? "Refine filters";
  let currentRefineAriaLabel = props.refineAriaLabel ?? "Refine filters";

  const sync = () => {
    message.textContent = bannerCopy(currentCount);
    root.hidden = currentHidden;
    applyClassName(root, "truncation-banner", currentClassName);
    root.setAttribute(
      "data-testid",
      `truncation-banner limit=${Math.max(0, Math.trunc(currentCount))}`,
    );
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
    if (next.count !== undefined) currentCount = normalizeCount(next.count);
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

  root.refineButton = refineButton;

  return root;
}

export default createTruncationBanner;
