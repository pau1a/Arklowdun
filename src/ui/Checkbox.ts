export interface CheckboxProps {
  checked?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  name?: string;
  value?: string;
  className?: string;
  onChange?: (event: Event) => void;
}

export type CheckboxElement = HTMLInputElement & {
  update: (next: Partial<CheckboxProps>) => void;
};

function applyClassName(el: HTMLInputElement, className?: string): void {
  el.className = '';
  if (className) {
    for (const token of className.split(/\s+/)) {
      if (token) el.classList.add(token);
    }
  }
}

export function createCheckbox(props: CheckboxProps = {}): CheckboxElement {
  const checkbox = document.createElement('input') as CheckboxElement;
  checkbox.type = 'checkbox';
  checkbox.dataset.ui = 'checkbox';
  let currentClassName = props.className;

  if (props.id) checkbox.id = props.id;
  if (props.name) checkbox.name = props.name;
  if (props.value !== undefined) checkbox.value = props.value;
  checkbox.checked = props.checked ?? false;
  checkbox.disabled = props.disabled ?? false;
  if (props.ariaLabel) checkbox.setAttribute('aria-label', props.ariaLabel);

  applyClassName(checkbox, currentClassName);

  if (props.onChange) checkbox.addEventListener('change', props.onChange);

  checkbox.update = (next: Partial<CheckboxProps>) => {
    if (next.id !== undefined) {
      if (next.id) checkbox.id = next.id;
      else checkbox.removeAttribute('id');
    }
    if (next.name !== undefined) {
      if (next.name) checkbox.name = next.name;
      else checkbox.removeAttribute('name');
    }
    if (next.value !== undefined) checkbox.value = next.value;
    if (next.checked !== undefined) checkbox.checked = next.checked;
    if (next.disabled !== undefined) checkbox.disabled = next.disabled;
    if (next.ariaLabel !== undefined) {
      if (next.ariaLabel) checkbox.setAttribute('aria-label', next.ariaLabel);
      else checkbox.removeAttribute('aria-label');
    }
    if (next.className !== undefined) currentClassName = next.className;
    applyClassName(checkbox, currentClassName);
  };

  return checkbox;
}

export default createCheckbox;
