export interface SwitchProps {
  checked?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
  onChange?: (event: Event, checked: boolean) => void;
}

export type SwitchElement = HTMLButtonElement & {
  update: (next: Partial<SwitchProps>) => void;
};

function applyClassName(el: HTMLButtonElement, className?: string): void {
  el.className = 'switch';
  if (className) {
    for (const token of className.split(/\s+/)) {
      if (token) el.classList.add(token);
    }
  }
}

export function createSwitch(props: SwitchProps = {}): SwitchElement {
  const toggle = document.createElement('button') as SwitchElement;
  toggle.dataset.ui = 'switch';
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  let currentChecked = props.checked ?? false;
  let currentClassName = props.className;

  const setChecked = (value: boolean) => {
    currentChecked = value;
    toggle.setAttribute('aria-checked', String(value));
    toggle.dataset.state = value ? 'on' : 'off';
  };

  setChecked(currentChecked);
  toggle.disabled = props.disabled ?? false;
  if (props.disabled) toggle.setAttribute('aria-disabled', 'true');
  else toggle.removeAttribute('aria-disabled');
  if (props.ariaLabel) toggle.setAttribute('aria-label', props.ariaLabel);
  if (props.id) toggle.id = props.id;

  applyClassName(toggle, currentClassName);

  const emitChange = (event: Event, next: boolean) => {
    if (props.onChange) props.onChange(event, next);
  };

  const handleToggle = (event: Event) => {
    if (toggle.disabled) return;
    const next = !currentChecked;
    setChecked(next);
    emitChange(event, next);
  };

  toggle.addEventListener('click', (event) => {
    handleToggle(event);
  });

  toggle.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      handleToggle(event);
    } else if (key === 'Enter') {
      event.preventDefault();
      handleToggle(event);
    }
  });

  toggle.update = (next: Partial<SwitchProps>) => {
    if (next.checked !== undefined) setChecked(next.checked);
    if (next.disabled !== undefined) {
      toggle.disabled = next.disabled;
      if (next.disabled) toggle.setAttribute('aria-disabled', 'true');
      else toggle.removeAttribute('aria-disabled');
    }
    if (next.ariaLabel !== undefined) {
      if (next.ariaLabel) toggle.setAttribute('aria-label', next.ariaLabel);
      else toggle.removeAttribute('aria-label');
    }
    if (next.id !== undefined) {
      if (next.id) toggle.id = next.id;
      else toggle.removeAttribute('id');
    }
    if (next.className !== undefined) currentClassName = next.className;
    applyClassName(toggle, currentClassName);
  };

  return toggle;
}

export default createSwitch;
