export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string;
  options?: SelectOption[];
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  name?: string;
  className?: string;
  onChange?: (event: Event) => void;
}

export type SelectElement = HTMLSelectElement & {
  update: (next: Partial<SelectProps>) => void;
};

function applyClassName(el: HTMLSelectElement, className?: string): void {
  el.className = '';
  if (className) {
    for (const token of className.split(/\s+/)) {
      if (token) el.classList.add(token);
    }
  }
}

function applyOptions(el: HTMLSelectElement, options?: SelectOption[]): void {
  if (!options) return;
  el.innerHTML = '';
  for (const option of options) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    if (option.disabled) opt.disabled = true;
    el.appendChild(opt);
  }
}

export function createSelect(props: SelectProps = {}): SelectElement {
  const select = document.createElement('select') as SelectElement;
  select.dataset.ui = 'select';
  let currentClassName = props.className;
  let currentOptions = props.options;

  if (props.id) select.id = props.id;
  if (props.name) select.name = props.name;
  if (props.disabled !== undefined) select.disabled = props.disabled;
  if (props.ariaLabel) select.setAttribute('aria-label', props.ariaLabel);

  applyOptions(select, currentOptions);
  if (props.value !== undefined) select.value = props.value;
  applyClassName(select, currentClassName);

  if (props.onChange) select.addEventListener('change', props.onChange);

  select.update = (next: Partial<SelectProps>) => {
    if (next.id !== undefined) {
      if (next.id) select.id = next.id;
      else select.removeAttribute('id');
    }
    if (next.name !== undefined) {
      if (next.name) select.name = next.name;
      else select.removeAttribute('name');
    }
    if (next.disabled !== undefined) select.disabled = next.disabled;
    if (next.ariaLabel !== undefined) {
      if (next.ariaLabel) select.setAttribute('aria-label', next.ariaLabel);
      else select.removeAttribute('aria-label');
    }
    if (next.options !== undefined) {
      currentOptions = next.options;
      applyOptions(select, currentOptions);
    }
    if (next.value !== undefined) select.value = next.value;
    if (next.className !== undefined) currentClassName = next.className;
    applyClassName(select, currentClassName);
  };

  return select;
}

export default createSelect;
