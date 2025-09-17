export type ButtonVariant = 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps {
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  type?: 'button' | 'submit';
  ariaPressed?: boolean;
  autoFocus?: boolean;
  onClick?: (event: MouseEvent) => void;
  className?: string;
  ariaLabel?: string;
  id?: string;
  children?: Array<Node | string> | Node | string;
}

const variantClass: Record<ButtonVariant, string | undefined> = {
  primary: 'btn--accent',
  ghost: undefined,
  danger: 'btn--danger',
};

const sizeClass: Record<ButtonSize, string | undefined> = {
  md: undefined,
  sm: 'btn--sm',
};

function applyContent(
  el: HTMLButtonElement,
  children: ButtonProps['children'],
  label?: string,
): void {
  if (children === undefined) {
    if (label !== undefined) {
      el.textContent = label;
    }
    return;
  }

  el.textContent = '';
  if (Array.isArray(children)) {
    for (const child of children) {
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      } else {
        el.appendChild(child);
      }
    }
  } else if (typeof children === 'string') {
    el.textContent = children;
  } else {
    el.appendChild(children);
  }
}

function applyAriaPressed(el: HTMLButtonElement, value: boolean | undefined): void {
  if (value === undefined) {
    el.removeAttribute('aria-pressed');
  } else {
    el.setAttribute('aria-pressed', String(value));
  }
}

function applyClassName(
  el: HTMLButtonElement,
  baseClass: string,
  className?: string,
): void {
  el.className = baseClass;
  if (className) {
    for (const token of className.split(/\s+/)) {
      if (token) el.classList.add(token);
    }
  }
}

export type ButtonElement = HTMLButtonElement & {
  update: (next: Partial<ButtonProps>) => void;
};

export function createButton(props: ButtonProps = {}): ButtonElement {
  const button = document.createElement('button') as ButtonElement;
  button.dataset.ui = 'button';
  let currentVariant: ButtonVariant = props.variant ?? 'ghost';
  let currentSize: ButtonSize = props.size ?? 'md';
  let currentClassName = props.className;
  let currentChildren = props.children;
  let currentLabel = props.label;
  let currentAriaPressed = props.ariaPressed;

  button.type = props.type ?? 'button';
  button.autofocus = props.autoFocus ?? false;
  button.disabled = props.disabled ?? false;
  if (props.id) button.id = props.id;
  if (props.ariaLabel) button.setAttribute('aria-label', props.ariaLabel);

  const baseClass = ['btn'];
  const variantToken = variantClass[currentVariant];
  if (variantToken) baseClass.push(variantToken);
  const sizeToken = sizeClass[currentSize];
  if (sizeToken) baseClass.push(sizeToken);

  applyClassName(button, baseClass.join(' '), currentClassName);
  applyContent(button, currentChildren, currentLabel);
  applyAriaPressed(button, currentAriaPressed);

  if (props.onClick) {
    button.addEventListener('click', props.onClick);
  }

  button.update = (next: Partial<ButtonProps>) => {
    if (next.type) button.type = next.type;
    if (next.autoFocus !== undefined) button.autofocus = next.autoFocus;
    if (next.disabled !== undefined) button.disabled = next.disabled;
    if (next.ariaLabel !== undefined) {
      if (next.ariaLabel) button.setAttribute('aria-label', next.ariaLabel);
      else button.removeAttribute('aria-label');
    }
    if (next.variant !== undefined) currentVariant = next.variant;
    if (next.size !== undefined) currentSize = next.size;
    if (next.className !== undefined) currentClassName = next.className;
    if (next.label !== undefined) currentLabel = next.label;
    if (next.children !== undefined) currentChildren = next.children;
    if (next.ariaPressed !== undefined) currentAriaPressed = next.ariaPressed;

    const classes = ['btn'];
    const newVariantToken = variantClass[currentVariant];
    if (newVariantToken) classes.push(newVariantToken);
    const newSizeToken = sizeClass[currentSize];
    if (newSizeToken) classes.push(newSizeToken);
    applyClassName(button, classes.join(' '), currentClassName);
    applyContent(button, currentChildren, currentLabel);
    applyAriaPressed(button, currentAriaPressed);
  };

  return button;
}

export default createButton;
