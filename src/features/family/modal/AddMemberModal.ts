import createButton from "@ui/Button";
import { createInput } from "@ui/Input";
import { createModal } from "@ui/Modal";
import { toast } from "@ui/Toast";
import { normalizeError } from "@lib/ipc/call";
import { logUI } from "@lib/uiLog";
import { emit } from "@store/events";
import type { FamilyMember as BackendFamilyMember } from "../../../models";
import { familyRepo } from "../../../repos";
import { familyStore } from "../family.store";

type ModalStep = 1 | 2;

type ModalValues = {
  nickname: string;
  fullName: string;
  relationship: string;
  phone: string;
  email: string;
};

type ModalErrors = {
  identity?: string;
};

export interface AddMemberModalOptions {
  householdId: string;
  getMemberCount: () => number;
}

export interface AddMemberModalInstance {
  open(): void;
  close(): void;
  destroy(): void;
}

const STEP_COUNT = 2;
const TITLE_ID = "family-add-member-title";
const DESCRIPTION_ID = "family-add-member-description";
const IDENTITY_ERROR_ID = "family-add-member-identity-error";
const DUPLICATE_TOAST_MESSAGE = "Could not save — please try again";

function createField(labelText: string, input: HTMLElement): HTMLDivElement {
  const field = document.createElement("div");
  field.className = "add-member-modal__field";

  const label = document.createElement("label");
  label.className = "add-member-modal__label";
  label.textContent = labelText;

  label.appendChild(input);
  field.appendChild(label);

  return field;
}

export function mountAddMemberModal(
  options: AddMemberModalOptions,
): AddMemberModalInstance {
  const modal = createModal({
    open: false,
    onOpenChange(open) {
      if (!open) {
        close();
      }
    },
    titleId: TITLE_ID,
    descriptionId: DESCRIPTION_ID,
  });

  modal.root.classList.add("add-member-modal__overlay");
  modal.dialog.classList.add("add-member-modal__dialog");

  const container = document.createElement("div");
  container.className = "add-member-modal";

  const title = document.createElement("h1");
  title.id = TITLE_ID;
  title.className = "add-member-modal__title";
  title.textContent = "Add family member";

  const progress = document.createElement("p");
  progress.id = DESCRIPTION_ID;
  progress.className = "add-member-modal__progress";
  progress.setAttribute("aria-live", "polite");

  const form = document.createElement("form");
  form.className = "add-member-modal__form";

  const stepBasic = document.createElement("div");
  stepBasic.className = "add-member-modal__step";

  const stepBasicTitle = document.createElement("h2");
  stepBasicTitle.className = "add-member-modal__step-title";
  stepBasicTitle.textContent = "Basic info";
  stepBasic.appendChild(stepBasicTitle);

  const nicknameInput = createInput({
    id: "family-add-member-nickname",
    className: "add-member-modal__input",
    placeholder: "Nickname",
  });
  nicknameInput.setAttribute("aria-describedby", IDENTITY_ERROR_ID);
  nicknameInput.addEventListener("input", (event) => {
    values.nickname = (event.target as HTMLInputElement).value;
    if (errors.identity) {
      errors.identity = undefined;
    }
    updateState();
  });

  const nameInput = createInput({
    id: "family-add-member-name",
    className: "add-member-modal__input",
    placeholder: "Full name",
  });
  nameInput.setAttribute("aria-describedby", IDENTITY_ERROR_ID);
  nameInput.addEventListener("input", (event) => {
    values.fullName = (event.target as HTMLInputElement).value;
    if (errors.identity) {
      errors.identity = undefined;
    }
    updateState();
  });

  const relationshipInput = createInput({
    id: "family-add-member-relationship",
    className: "add-member-modal__input",
    placeholder: "Relationship",
  });
  relationshipInput.addEventListener("input", (event) => {
    values.relationship = (event.target as HTMLInputElement).value;
    updateState();
  });

  const identityError = document.createElement("p");
  identityError.id = IDENTITY_ERROR_ID;
  identityError.className = "add-member-modal__error form-error";
  identityError.setAttribute("role", "alert");
  identityError.hidden = true;

  stepBasic.append(
    createField("Nickname", nicknameInput),
    createField("Full name", nameInput),
    createField("Relationship", relationshipInput),
    identityError,
  );

  const stepOptional = document.createElement("div");
  stepOptional.className = "add-member-modal__step";

  const stepOptionalTitle = document.createElement("h2");
  stepOptionalTitle.className = "add-member-modal__step-title";
  stepOptionalTitle.textContent = "Optional details";
  stepOptional.appendChild(stepOptionalTitle);

  const phoneInput = createInput({
    id: "family-add-member-phone",
    className: "add-member-modal__input",
    type: "tel",
    placeholder: "Phone number",
  });
  phoneInput.addEventListener("input", (event) => {
    values.phone = (event.target as HTMLInputElement).value;
    updateState();
  });

  const emailInput = createInput({
    id: "family-add-member-email",
    className: "add-member-modal__input",
    type: "email",
    placeholder: "Email address",
  });
  emailInput.addEventListener("input", (event) => {
    values.email = (event.target as HTMLInputElement).value;
    updateState();
  });

  stepOptional.append(
    createField("Phone number", phoneInput),
    createField("Email", emailInput),
  );

  const actionsPrimary = document.createElement("div");
  actionsPrimary.className = "add-member-modal__actions";

  const actionsSecondary = document.createElement("div");
  actionsSecondary.className = "add-member-modal__actions";

  const cancelButton = createButton({
    label: "Cancel",
    variant: "ghost",
  });
  cancelButton.addEventListener("click", (event) => {
    event.preventDefault();
    close();
  });

  const nextButton = createButton({
    label: "Next",
    variant: "primary",
    type: "submit",
  });

  const backButton = createButton({
    label: "Back",
    variant: "ghost",
  });
  backButton.addEventListener("click", (event) => {
    event.preventDefault();
    step = 1;
    updateState();
  });

  const submitButton = createButton({
    label: "Add member",
    variant: "primary",
    type: "submit",
  });

  actionsPrimary.append(cancelButton, nextButton);
  actionsSecondary.append(backButton, submitButton);

  form.append(stepBasic, stepOptional, actionsPrimary, actionsSecondary);

  container.append(title, progress, form);
  modal.dialog.appendChild(container);

  let step: ModalStep = 1;
  let submitting = false;
  let isOpen = false;
  let returnFocusEl: HTMLElement | null = null;

  const values: ModalValues = {
    nickname: "",
    fullName: "",
    relationship: "",
    phone: "",
    email: "",
  };

  const errors: ModalErrors = {};

  function resetState(): void {
    step = 1;
    submitting = false;
    values.nickname = "";
    values.fullName = "";
    values.relationship = "";
    values.phone = "";
    values.email = "";
    errors.identity = undefined;
    updateState();
  }

  function validateStepOne(): boolean {
    const hasNickname = values.nickname.trim().length > 0;
    if (!hasNickname) {
      errors.identity = "Enter a nickname.";
      return false;
    }
    errors.identity = undefined;
    return true;
  }

  function updateProgress(): void {
    progress.textContent = `Step ${step} of ${STEP_COUNT}`;
  }

  function updateErrors(): void {
    if (errors.identity) {
      identityError.textContent = errors.identity;
      identityError.hidden = false;
    } else {
      identityError.textContent = "";
      identityError.hidden = true;
    }

    const invalid = Boolean(errors.identity);
    nicknameInput.update({ invalid });
    nameInput.update({ invalid });
    nicknameInput.setAttribute("aria-invalid", String(invalid));
    nameInput.setAttribute("aria-invalid", String(invalid));
  }

  function updateButtons(): void {
    const identityReady = values.nickname.trim().length > 0;
    cancelButton.disabled = submitting;
    nextButton.disabled = submitting || !identityReady;
    backButton.disabled = submitting;
    submitButton.disabled = submitting;
  }

  function updateStepVisibility(): void {
    stepBasic.hidden = step !== 1;
    actionsPrimary.hidden = step !== 1;
    stepOptional.hidden = step !== 2;
    actionsSecondary.hidden = step !== 2;
    modal.update({
      initialFocus: () => (step === 1 ? nicknameInput : phoneInput),
    });
  }

  function syncInputs(): void {
    nicknameInput.update({ value: values.nickname });
    nameInput.update({ value: values.fullName });
    relationshipInput.update({ value: values.relationship });
    phoneInput.update({ value: values.phone });
    emailInput.update({ value: values.email });
  }

  function updateState(): void {
    syncInputs();
    updateProgress();
    updateErrors();
    updateButtons();
    updateStepVisibility();
  }

  async function handleSubmit(): Promise<void> {
    if (submitting) return;
    if (!validateStepOne()) {
      step = 1;
      updateState();
      return;
    }

    submitting = true;
    updateButtons();

    const start = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

    const memberCount = Number(options.getMemberCount?.() ?? 0);
    const nickname = values.nickname.trim();
    const position = Number.isFinite(memberCount) ? memberCount : 0;
    let optimisticHandle: ReturnType<typeof familyStore.optimisticCreate> | null = null;

    try {
      optimisticHandle = familyStore.optimisticCreate({
        name: nickname,
        nickname,
        notes: null,
        position,
      });
      const createPayload = {
        name: nickname,
        notes: null,
        position,
        household_id: options.householdId,
      } as const;
      const createdRaw = await familyRepo.create(
        options.householdId,
        createPayload as unknown as Partial<BackendFamilyMember>,
      );
      const created = familyStore.commitCreated(optimisticHandle.memberId, createdRaw);
      const duration = (typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now()) - start;
      toast.show({ kind: "success", message: "Member added" });
      logUI("DEBUG", "ui.family.modal.create_success", {
        member_id: created.id,
        duration_ms: Math.round(duration),
      });
      emit("family:memberAdded", { memberId: created.id, householdId: options.householdId });
      submitting = false;
      close();
    } catch (error) {
      if (optimisticHandle) {
        try {
          optimisticHandle.rollback();
        } catch {
          // ignore rollback failures
        }
      }
      submitting = false;
      const normalized = normalizeError(error);
      const code = normalized.code ?? "";
      if (code === "DB_CONSTRAINT_UNIQUE" || code === "duplicate-position") {
        toast.show({ kind: "info", message: DUPLICATE_TOAST_MESSAGE });
      } else if (code === "MISSING_FIELD" || code === "missing-nickname") {
        errors.identity = "Enter a nickname.";
        step = 1;
        toast.show({ kind: "error", message: "Unable to create member" });
      } else {
        toast.show({ kind: "error", message: "Unable to create member" });
        console.error("family:add-member:create", normalized);
      }
      logUI("WARN", "ui.family.modal.create_failed", {
        code: normalized.code,
        context: normalized.context,
      });
      updateState();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (step === 1) {
      if (validateStepOne()) {
        step = 2;
      }
      updateState();
      return;
    }
    void handleSubmit();
  });

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    returnFocusEl = (document.activeElement as HTMLElement) ?? null;
    resetState();
    logUI("INFO", "ui.family.modal.open", { event: "family_modal", action: "open" });
    modal.setOpen(true);
  }

  function close(): void {
    if (!isOpen) {
      modal.setOpen(false);
      return;
    }
    isOpen = false;
    modal.setOpen(false);
    logUI("INFO", "ui.family.modal.close", { event: "family_modal", action: "close" });
    if (returnFocusEl && typeof returnFocusEl.focus === "function") {
      try {
        returnFocusEl.focus();
      } catch {
        // ignore focus failures
      }
    }
    returnFocusEl = null;
    resetState();
  }

  updateState();

  return {
    open,
    close,
    destroy() {
      modal.root.remove();
    },
  };
}
