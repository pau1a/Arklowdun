export type InputType =
  | 'text'
  | 'search'
  | 'number'
  | 'datetime-local'
  | 'email'
  | 'password'
  | 'url'
  | 'tel'
  | string;

export interface InputProps {
  type?: InputType;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  id?: string;
  name?: string;
  required?: boolean;
  invalid?: boolean;
  className?: string;
  onInput?: (event: Event) => void;
  onChange?: (event: Event) => void;
}

export type InputElement = HTMLInputElement & {
  update: (next: Partial<InputProps>) => void;
};

function applyClassName(el: HTMLInputElement, className?: string): void {
  el.className = '';
  if (className) {
    for (const token of className.split(/\s+/)) {
      if (token) el.classList.add(token);
    }
  }
}

function applyInvalid(el: HTMLInputElement, invalid?: boolean): void {
  if (invalid === undefined) {
    el.removeAttribute('aria-invalid');
    return;
  }
  el.setAttribute('aria-invalid', String(invalid));
}

export function createInput(props: InputProps = {}): InputElement {
  const input = document.createElement('input') as InputElement;
  input.dataset.ui = 'input';
  let currentClassName = props.className;
  let currentInvalid = props.invalid;

  input.type = props.type ?? 'text';
  if (props.id) input.id = props.id;
  if (props.name) input.name = props.name;
  if (props.value !== undefined) input.value = props.value;
  if (props.placeholder) input.placeholder = props.placeholder;
  if (props.disabled !== undefined) input.disabled = props.disabled;
  if (props.autoFocus) input.autofocus = true;
  if (props.ariaLabel) input.setAttribute('aria-label', props.ariaLabel);
  if (props.required) input.required = true;

  applyClassName(input, currentClassName);
  applyInvalid(input, currentInvalid);

  if (props.onInput) input.addEventListener('input', props.onInput);
  if (props.onChange) input.addEventListener('change', props.onChange);

  input.update = (next: Partial<InputProps>) => {
    if (next.type) input.type = next.type;
    if (next.id !== undefined) {
      if (next.id) input.id = next.id;
      else input.removeAttribute('id');
    }
    if (next.name !== undefined) {
      if (next.name) input.name = next.name;
      else input.removeAttribute('name');
    }
    if (next.value !== undefined) input.value = next.value;
    if (next.placeholder !== undefined) input.placeholder = next.placeholder ?? '';
    if (next.disabled !== undefined) input.disabled = next.disabled;
    if (next.autoFocus !== undefined) input.autofocus = next.autoFocus;
    if (next.ariaLabel !== undefined) {
      if (next.ariaLabel) input.setAttribute('aria-label', next.ariaLabel);
      else input.removeAttribute('aria-label');
    }
    if (next.required !== undefined) input.required = next.required;
    if (next.className !== undefined) currentClassName = next.className;
    if (next.invalid !== undefined) currentInvalid = next.invalid;
    applyClassName(input, currentClassName);
    applyInvalid(input, currentInvalid);
  };

  return input;
}

export default createInput;
