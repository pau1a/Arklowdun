export interface InputOptions {
  placeholder?: string;
  type?: string;
  initialValue?: string;
  onInput?: (value: string, event: Event) => void;
}

export function createInput(options: InputOptions = {}): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "ui-input";
  input.type = options.type ?? "text";
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.initialValue) input.value = options.initialValue;
  if (options.onInput) {
    input.addEventListener("input", (event) => {
      options.onInput?.(input.value, event);
    });
  }
  return input;
}
