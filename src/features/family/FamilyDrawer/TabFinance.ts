import { canParseJson, collectNumericFieldErrors, parseJsonOrNull, stringifyJson } from "./validators";

export interface FinanceFormData {
  bankAccounts: unknown | null;
  pensionDetails: unknown | null;
  insuranceRefs: string;
}

export interface FinanceTabValue {
  bankAccountsRaw: string;
  pensionDetailsRaw: string;
  insuranceRefs: string;
}

export interface FinanceValidationResult {
  valid: boolean;
  focus?: () => void;
  bankAccounts?: unknown | null;
  pensionDetails?: unknown | null;
}

export interface TabFinanceInstance {
  element: HTMLElement;
  getData(): FinanceTabValue;
  setData(data: FinanceFormData): void;
  validate(): FinanceValidationResult;
}

function createTextarea(labelText: string, id: string): {
  wrapper: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  error: HTMLDivElement;
} {
  const wrapper = document.createElement("div");
  wrapper.className = "family-drawer__field";

  const label = document.createElement("label");
  label.className = "family-drawer__label";
  label.textContent = labelText;
  label.htmlFor = id;
  wrapper.appendChild(label);

  const textarea = document.createElement("textarea");
  textarea.className = "family-drawer__textarea";
  textarea.id = id;
  textarea.rows = 6;
  wrapper.appendChild(textarea);

  const error = document.createElement("div");
  error.className = "family-drawer__error";
  error.id = `${id}-error`;
  error.hidden = true;
  wrapper.appendChild(error);

  textarea.setAttribute("aria-describedby", error.id);

  return { wrapper, textarea, error };
}

function setError(entry: { wrapper: HTMLElement; error: HTMLElement; textarea?: HTMLTextAreaElement }, message: string | null) {
  if (message) {
    entry.error.textContent = message;
    entry.error.hidden = false;
    entry.wrapper.setAttribute("data-invalid", "true");
    entry.textarea?.setAttribute("aria-invalid", "true");
  } else {
    entry.error.textContent = "";
    entry.error.hidden = true;
    entry.wrapper.removeAttribute("data-invalid");
    entry.textarea?.removeAttribute("aria-invalid");
  }
}

export function createFinanceTab(): TabFinanceInstance {
  const element = document.createElement("div");
  element.className = "family-drawer__panel";
  element.id = "family-drawer-panel-finance";

  const bankField = createTextarea("Bank accounts (JSON)", "family-drawer-bank");
  element.appendChild(bankField.wrapper);

  const pensionField = createTextarea("Pension details (JSON)", "family-drawer-pension");
  element.appendChild(pensionField.wrapper);

  const insuranceFieldWrapper = document.createElement("div");
  insuranceFieldWrapper.className = "family-drawer__field";
  const insuranceLabel = document.createElement("label");
  insuranceLabel.className = "family-drawer__label";
  insuranceLabel.textContent = "Insurance references";
  insuranceLabel.htmlFor = "family-drawer-insurance";
  insuranceFieldWrapper.appendChild(insuranceLabel);

  const insuranceInput = document.createElement("input");
  insuranceInput.className = "family-drawer__input";
  insuranceInput.id = "family-drawer-insurance";
  insuranceFieldWrapper.appendChild(insuranceInput);

  const insuranceError = document.createElement("div");
  insuranceError.className = "family-drawer__error";
  insuranceError.id = "family-drawer-insurance-error";
  insuranceError.hidden = true;
  insuranceFieldWrapper.appendChild(insuranceError);

  insuranceInput.setAttribute("aria-describedby", insuranceError.id);

  element.appendChild(insuranceFieldWrapper);

  const getData = (): FinanceTabValue => ({
    bankAccountsRaw: bankField.textarea.value,
    pensionDetailsRaw: pensionField.textarea.value,
    insuranceRefs: insuranceInput.value.trim(),
  });

  const setData = (data: FinanceFormData) => {
    bankField.textarea.value = stringifyJson(data.bankAccounts);
    pensionField.textarea.value = stringifyJson(data.pensionDetails);
    insuranceInput.value = data.insuranceRefs ?? "";
    setError(bankField, null);
    setError(pensionField, null);
    setError({ wrapper: insuranceFieldWrapper, error: insuranceError }, null);
  };

  const validate = (): FinanceValidationResult => {
    const { bankAccountsRaw, pensionDetailsRaw } = getData();
    let parsedBank: unknown | null = null;
    let parsedPension: unknown | null = null;
    let firstInvalid: (() => void) | undefined;

    const ensureFirst = (focus: () => void) => {
      if (!firstInvalid) firstInvalid = focus;
    };

    if (!canParseJson(bankAccountsRaw)) {
      setError(bankField, "Enter valid JSON for bank accounts.");
      ensureFirst(() => bankField.textarea.focus());
    } else {
      setError(bankField, null);
      try {
        parsedBank = parseJsonOrNull(bankAccountsRaw);
      } catch {
        parsedBank = null;
      }
      if (parsedBank) {
        const numericErrors = collectNumericFieldErrors(parsedBank);
        if (numericErrors.length > 0) {
          setError(bankField, numericErrors[0]);
          ensureFirst(() => bankField.textarea.focus());
          parsedBank = null;
        }
      }
    }

    if (!canParseJson(pensionDetailsRaw)) {
      setError(pensionField, "Enter valid JSON for pension details.");
      ensureFirst(() => pensionField.textarea.focus());
    } else {
      setError(pensionField, null);
      try {
        parsedPension = parseJsonOrNull(pensionDetailsRaw);
      } catch {
        parsedPension = null;
      }
    }

    setError({ wrapper: insuranceFieldWrapper, error: insuranceError }, null);

    return {
      valid: !firstInvalid,
      focus: firstInvalid,
      bankAccounts: parsedBank,
      pensionDetails: parsedPension,
    };
  };

  return {
    element,
    getData,
    setData,
    validate,
  };
}
