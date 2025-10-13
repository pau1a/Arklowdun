import type { Pet } from "./models";
import { PetDetailView, type PetDetailController } from "./ui/pets/PetDetailView";
import { getHouseholdIdForCalls } from "./db/household";
import { petsRepo, petsUpdateImage } from "./repos";
import { reminderScheduler } from "@features/pets/reminderScheduler";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";
import { createPetsPage, createFilterModels, type FilteredPet } from "@features/pets/PetsPage";
import { toast } from "./ui/Toast";
import { logUI } from "@lib/uiLog";
import { incrementDiagnosticsCounter } from "./diagnostics/runtime";
import {
  registerPetsListController,
  unregisterPetsListController,
  type PetsListController,
} from "@features/pets/pageController";
import { isMacPlatform } from "@ui/keys";
import { timeIt } from "@lib/obs/timeIt";
import { recordPetsMutationFailure } from "@features/pets/mutationTelemetry";
import { open as openDialog } from "@lib/ipc/dialog";
import { sanitizeRelativePath, PathValidationError } from "./files/path";
import { mkdir, writeBinary } from "./files/safe-fs";
import { presentFsError } from "@lib/ipc";
import { revealAttachment } from "./ui/attachments";
import { createModal } from "@ui/Modal";
import createButton, { type ButtonElement } from "@ui/Button";
import { ENABLE_PETS_HARD_DELETE } from "./config/flags";

function toDisplayName(pet: Pet): string {
  const raw = pet.name ?? "";
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : "Unnamed pet";
}

function requiredDeleteToken(pet: Pet): { token: string; label: string } {
  const trimmed = (pet.name ?? "").trim();
  if (trimmed.length > 0) {
    return { token: trimmed, label: "name" };
  }
  return { token: pet.id, label: "ID" };
}

function clonePet(pet: Pet): Pet {
  return JSON.parse(JSON.stringify(pet)) as Pet;
}

function toReminderRecords(pets: Pet[]): {
  records: Array<{
    medical_id: string;
    pet_id: string;
    date: string;
    reminder_at: string;
    description: string;
    pet_name: string;
  }>;
  petNames: Record<string, string>;
} {
  const records: Array<{
    medical_id: string;
    pet_id: string;
    date: string;
    reminder_at: string;
    description: string;
    pet_name: string;
  }> = [];
  const petNames: Record<string, string> = {};
  pets.forEach((pet) => {
    petNames[pet.id] = pet.name;
    (pet.medical ?? []).forEach((record) => {
      if (record.reminder == null) return;
      const reminderIso = new Date(record.reminder).toISOString();
      const baseDateIso = new Date(record.date).toISOString();
      const dateIso = baseDateIso.split("T")[0] ?? baseDateIso;
      records.push({
        medical_id: record.id,
        pet_id: pet.id,
        date: dateIso,
        reminder_at: reminderIso,
        description: record.description,
        pet_name: pet.name,
      });
    });
  });
  return { records, petNames };
}

interface FiltersState {
  query: string;
  models: FilteredPet[];
}

const IMAGE_DIALOG_FILTERS = [
  {
    name: "Images",
    extensions: ["png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "heic", "heif"],
  },
];

export async function PetsView(container: HTMLElement) {
  runViewCleanups(container);

  let listController: PetsListController | null = null;
  let addPetModal: ReturnType<typeof createModal> | null = null;
  let pendingCreateOpen = false;
  const page = createPetsPage(container);

  listController = {
    focusCreate: () => openAddPetModal(),
    focusSearch: () => page.focusSearch(),
    submitCreateForm: () => page.submitCreateForm(),
    focusRow: (id) => page.focusRow(id),
  };
  registerPetsListController(listController);

  registerViewCleanup(container, () => {
    try {
      page.destroy();
    } catch {
      // ignore
    }
    reminderScheduler.cancelAll();
    if (listController) {
      unregisterPetsListController(listController);
      listController = null;
    }
    if (addPetModal) {
      try {
        addPetModal.setOpen(false);
      } catch {
        /* ignore */
      }
      addPetModal = null;
    }
    pendingCreateOpen = false;
  });

  const hh = await getHouseholdIdForCalls();

  async function loadPets(): Promise<Pet[]> {
    return await timeIt(
      "list.load",
      async () => await petsRepo.list({ householdId: hh, orderBy: "position, created_at, id" }),
      {
        successFields: (result) => ({ count: result.length, household_id: hh }),
        errorFields: () => ({ household_id: hh }),
      },
    );
  }

  let pets: Pet[] = await loadPets();
  let filters: FiltersState = { query: "", models: [] };
  let lastScroll = 0;
  let detailController: PetDetailController | null = null;
  let detailActive = false;
  let detailPetId: string | null = null;
  let reorderLock = false;
  const allowHardDelete = ENABLE_PETS_HARD_DELETE;

  const createModalSeed = Math.random().toString(36).slice(2, 8);
  const createModalTitleId = `pets-create-title-${createModalSeed}`;
  const createModalDescriptionId = `pets-create-desc-${createModalSeed}`;
  const createModalStatusId = `pets-create-status-${createModalSeed}`;
  const createModalNameId = `pets-create-name-${createModalSeed}`;
  const createModalSpeciesId = `pets-create-species-${createModalSeed}`;
  const createModalBreedId = `pets-create-breed-${createModalSeed}`;

  interface CreateFieldControl {
    wrapper: HTMLDivElement;
    input: HTMLInputElement;
    error: HTMLParagraphElement;
  }

  let createForm: HTMLFormElement;
  let createStatus: HTMLParagraphElement | null = null;
  let createSubmitButton: ButtonElement;
  let createCancelButton: ButtonElement;
  let createNameField: CreateFieldControl;
  let createSpeciesField: CreateFieldControl;
  let createBreedField: CreateFieldControl;
  let createSubmitting = false;

  function clearFieldError(control: CreateFieldControl) {
    control.error.textContent = "";
    control.error.hidden = true;
    control.input.removeAttribute("aria-invalid");
    const describedBy = control.input.getAttribute("aria-describedby");
    if (describedBy) {
      const tokens = describedBy
        .split(/\s+/)
        .filter((token) => token && token !== control.error.id);
      if (tokens.length > 0) {
        control.input.setAttribute("aria-describedby", tokens.join(" "));
      } else {
        control.input.removeAttribute("aria-describedby");
      }
    }
  }

  function setFieldError(control: CreateFieldControl, message: string) {
    control.error.textContent = message;
    control.error.hidden = false;
    control.input.setAttribute("aria-invalid", "true");
    const describedBy = control.input.getAttribute("aria-describedby");
    const tokens = new Set((describedBy ?? "").split(/\s+/).filter(Boolean));
    tokens.add(control.error.id);
    control.input.setAttribute("aria-describedby", Array.from(tokens).join(" "));
    createStatus?.setAttribute("data-active", "true");
    if (createStatus) {
      createStatus.textContent = message;
    }
  }

  function buildField(
    labelText: string,
    id: string,
    opts: { required?: boolean; maxLength: number },
  ): CreateFieldControl {
    const wrapper = document.createElement("div");
    wrapper.className = "pets-create-modal__field";

    const label = document.createElement("label");
    label.className = "pets-create-modal__label";
    label.htmlFor = id;
    label.textContent = labelText;

    const input = document.createElement("input");
    input.className = "pets-create-modal__input";
    input.id = id;
    input.type = "text";
    input.autocomplete = "off";
    input.maxLength = opts.maxLength;
    if (opts.required) {
      input.required = true;
    }

    const error = document.createElement("p");
    error.className = "pets-create-modal__error";
    error.id = `${id}-error`;
    error.hidden = true;

    const control: CreateFieldControl = { wrapper, input, error };

    input.addEventListener("input", () => {
      clearFieldError(control);
      if (createStatus) {
        createStatus.textContent = "";
        createStatus.removeAttribute("data-active");
      }
    });

    wrapper.append(label, input, error);
    return control;
  }

  function resetCreateForm() {
    if (!createForm) return;
    createForm.reset();
    if (createStatus) {
      createStatus.textContent = "";
      createStatus.removeAttribute("data-active");
    }
    if (createNameField) clearFieldError(createNameField);
    if (createSpeciesField) clearFieldError(createSpeciesField);
    if (createBreedField) clearFieldError(createBreedField);
  }

  function setCreateSubmitting(submitting: boolean) {
    createSubmitting = submitting;
    if (createNameField) createNameField.input.disabled = submitting;
    if (createSpeciesField) createSpeciesField.input.disabled = submitting;
    if (createBreedField) createBreedField.input.disabled = submitting;
    createSubmitButton?.update({ label: submitting ? "Creating…" : "Create", disabled: submitting });
    createCancelButton?.update({ disabled: submitting });
    if (createForm) {
      if (submitting) createForm.setAttribute("aria-busy", "true");
      else createForm.removeAttribute("aria-busy");
    }
  }

  function validateCreateForm(): {
    values: { name: string; species: string | null; breed: string | null };
    hasError: boolean;
    firstInvalid: HTMLInputElement | null;
  } {
    const nameValue = createNameField.input.value.trim();
    const speciesValue = createSpeciesField.input.value.trim();
    const breedValue = createBreedField.input.value.trim();

    clearFieldError(createNameField);
    clearFieldError(createSpeciesField);
    clearFieldError(createBreedField);
    if (createStatus) {
      createStatus.textContent = "";
      createStatus.removeAttribute("data-active");
    }

    let hasError = false;
    let firstInvalid: HTMLInputElement | null = null;

    if (!nameValue) {
      setFieldError(createNameField, "Enter a name.");
      hasError = true;
      if (!firstInvalid) firstInvalid = createNameField.input;
    } else if (nameValue.length > 120) {
      setFieldError(createNameField, "Name can’t be longer than 120 characters.");
      hasError = true;
      if (!firstInvalid) firstInvalid = createNameField.input;
    }

    if (speciesValue.length > 64) {
      setFieldError(createSpeciesField, "Species can’t be longer than 64 characters.");
      hasError = true;
      if (!firstInvalid) firstInvalid = createSpeciesField.input;
    }

    if (breedValue.length > 64) {
      setFieldError(createBreedField, "Breed can’t be longer than 64 characters.");
      hasError = true;
      if (!firstInvalid) firstInvalid = createBreedField.input;
    }

    return {
      values: {
        name: nameValue,
        species: speciesValue ? speciesValue : null,
        breed: breedValue ? breedValue : null,
      },
      hasError,
      firstInvalid,
    };
  }

  addPetModal = createModal({
    open: false,
    titleId: createModalTitleId,
    descriptionId: createModalDescriptionId,
    initialFocus: () => createNameField?.input ?? null,
    onOpenChange(open) {
      if (createSubmitting && !open) {
        addPetModal?.setOpen(true);
        return;
      }
      if (open) {
        resetCreateForm();
        setCreateSubmitting(false);
        logUI("INFO", "pets.modal_open", { household_id: hh });
      } else {
        setCreateSubmitting(false);
        resetCreateForm();
      }
    },
  });

  addPetModal.root.classList.add("pets-create-modal__overlay");
  addPetModal.dialog.classList.add("pets-create-modal");

  const createHeader = document.createElement("header");
  createHeader.className = "pets-create-modal__header";

  const createTitle = document.createElement("h2");
  createTitle.id = createModalTitleId;
  createTitle.className = "pets-create-modal__title";
  createTitle.textContent = "Add a pet";
  createHeader.append(createTitle);

  const createBody = document.createElement("div");
  createBody.className = "pets-create-modal__body";

  const createDescription = document.createElement("p");
  createDescription.id = createModalDescriptionId;
  createDescription.className = "pets-create-modal__description";
  createDescription.textContent = "Create a pet record. Only the name is required.";

  createForm = document.createElement("form");
  createForm.className = "pets-create-modal__form";
  createForm.noValidate = true;

  createNameField = buildField("Name", createModalNameId, { required: true, maxLength: 120 });
  createSpeciesField = buildField("Species", createModalSpeciesId, { maxLength: 64 });
  createBreedField = buildField("Breed", createModalBreedId, { maxLength: 64 });

  createForm.append(
    createNameField.wrapper,
    createSpeciesField.wrapper,
    createBreedField.wrapper,
  );

  const createFooter = document.createElement("div");
  createFooter.className = "pets-create-modal__footer";

  createCancelButton = createButton({
    label: "Cancel",
    onClick: (event) => {
      event.preventDefault();
      if (createSubmitting) return;
      addPetModal?.setOpen(false);
    },
  });

  createSubmitButton = createButton({
    label: "Create",
    variant: "primary",
    type: "submit",
  });

  createFooter.append(createCancelButton, createSubmitButton);
  createForm.append(createFooter);

  createStatus = document.createElement("p");
  createStatus.id = createModalStatusId;
  createStatus.className = "sr-only";
  createStatus.setAttribute("role", "status");
  createStatus.setAttribute("aria-live", "polite");

  createBody.append(createDescription, createForm);
  addPetModal.dialog.append(createHeader, createBody, createStatus);

  createForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (createSubmitting) return;
    const { values, hasError, firstInvalid } = validateCreateForm();
    if (hasError) {
      firstInvalid?.focus();
      return;
    }
    logUI("INFO", "pets.create_submitted", { household_id: hh });
    setCreateSubmitting(true);
    let shouldRefocusName = false;
    void Promise.resolve(
      handleCreate({
        name: values.name,
        species: values.species ?? undefined,
        breed: values.breed ?? undefined,
      }),
    )
      .then((created) => {
        logUI("INFO", "pets.create_success", { household_id: hh, pet_id: created.id });
        toast.show({ kind: "success", message: "Pet created" });
        addPetModal?.setOpen(false);
        resetCreateForm();
        page.focusRow(created.id);
      })
      .catch((error) => {
        shouldRefocusName = true;
        const maybe = error as { code?: string | null } | null;
        const code = typeof maybe?.code === "string" ? maybe.code : "unknown";
        logUI("WARN", "pets.create_error", { household_id: hh, code });
        toast.show({
          kind: "error",
          message: "Couldn’t create the pet. Try again or check your connection.",
        });
        if (createStatus) {
          createStatus.textContent = "Couldn’t create the pet. Try again or check your connection.";
          createStatus.setAttribute("data-active", "true");
        }
      })
      .finally(() => {
        setCreateSubmitting(false);
        if (shouldRefocusName) {
          createNameField.input.focus();
        }
      });
  });

  if (pendingCreateOpen) {
    pendingCreateOpen = false;
    openAddPetModal();
  }

  function openAddPetModal(): void {
    if (!addPetModal) {
      pendingCreateOpen = true;
      return;
    }
    if (addPetModal.isOpen()) return;
    pendingCreateOpen = false;
    page.focusCreate();
    addPetModal.setOpen(true);
  }

  interface PendingUndoEntry {
    pet: Pet;
    index: number;
    timer: number | null;
  }

  const pendingUndo = new Map<string, PendingUndoEntry>();

  registerViewCleanup(container, () => {
    for (const entry of pendingUndo.values()) {
      if (entry.timer != null) {
        window.clearTimeout(entry.timer);
      }
    }
    pendingUndo.clear();
  });

  function clearPendingUndo(petId: string): void {
    const entry = pendingUndo.get(petId);
    if (!entry) return;
    if (entry.timer != null) {
      window.clearTimeout(entry.timer);
    }
    pendingUndo.delete(petId);
  }

  function confirmSoftDelete(pet: Pet): Promise<boolean> {
    if (typeof document === "undefined") return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const modalId = Math.random().toString(36).slice(2, 8);
      const titleId = `pets-soft-delete-title-${modalId}`;
      const descId = `pets-soft-delete-desc-${modalId}`;
      const modal = createModal({
        open: true,
        titleId,
        descriptionId: descId,
        onOpenChange(open) {
          if (!open && !settled) {
            finish(false);
          }
        },
      });

      modal.root.classList.add("pets-confirm__overlay");
      modal.dialog.classList.add("pets-confirm__dialog");

      const container = document.createElement("div");
      container.className = "pets-confirm";

      const title = document.createElement("h1");
      title.id = titleId;
      title.className = "pets-confirm__title";
      title.textContent = `Delete ${toDisplayName(pet)}?`;

      const description = document.createElement("p");
      description.id = descId;
      description.className = "pets-confirm__description";
      description.textContent = "You can restore this pet from Trash.";

      const actions = document.createElement("div");
      actions.className = "pets-confirm__actions";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "pets-confirm__button";
      cancelBtn.textContent = "Cancel";

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "pets-confirm__button pets-confirm__button--danger";
      confirmBtn.textContent = "Delete";

      actions.append(cancelBtn, confirmBtn);
      container.append(title, description, actions);
      modal.dialog.append(container);

      let settled = false;

      function cleanup() {
        cancelBtn.removeEventListener("click", handleCancel);
        confirmBtn.removeEventListener("click", handleConfirm);
      }

      function closeModal() {
        window.setTimeout(() => {
          modal.setOpen(false);
          if (modal.root.isConnected) {
            modal.root.remove();
          }
        }, 0);
      }

      function finish(result: boolean) {
        if (settled) return;
        settled = true;
        cleanup();
        closeModal();
        resolve(result);
      }

      function handleCancel(event: Event) {
        event.preventDefault();
        finish(false);
      }

      function handleConfirm(event: Event) {
        event.preventDefault();
        finish(true);
      }

      cancelBtn.addEventListener("click", handleCancel);
      confirmBtn.addEventListener("click", handleConfirm);

      window.setTimeout(() => {
        if (!settled) {
          try {
            confirmBtn.focus();
          } catch {
            /* ignore */
          }
        }
      }, 0);
    });
  }

  function confirmHardDelete(pet: Pet): Promise<boolean> {
    if (typeof document === "undefined") return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const modalId = Math.random().toString(36).slice(2, 8);
      const titleId = `pets-hard-delete-title-${modalId}`;
      const descId = `pets-hard-delete-desc-${modalId}`;
      const inputId = `pets-hard-delete-input-${modalId}`;
      const modal = createModal({
        open: true,
        titleId,
        descriptionId: descId,
        onOpenChange(open) {
          if (!open && !settled) {
            finish(false);
          }
        },
      });

      modal.root.classList.add("pets-confirm__overlay");
      modal.dialog.classList.add("pets-confirm__dialog");

      const { token, label } = requiredDeleteToken(pet);

      const container = document.createElement("div");
      container.className = "pets-confirm";

      const title = document.createElement("h1");
      title.id = titleId;
      title.className = "pets-confirm__title";
      title.textContent = `Delete ${toDisplayName(pet)} permanently?`;

      const description = document.createElement("p");
      description.id = descId;
      description.className = "pets-confirm__description";
      description.textContent = `Type the pet’s ${label} to confirm. This action cannot be undone.`;

      const inputLabel = document.createElement("label");
      inputLabel.className = "pets-confirm__field";
      inputLabel.setAttribute("for", inputId);
      inputLabel.textContent = `Confirm by typing “${token}”`;

      const input = document.createElement("input");
      input.id = inputId;
      input.type = "text";
      input.className = "pets-confirm__input";
      input.placeholder = token;

      inputLabel.append(input);

      const actions = document.createElement("div");
      actions.className = "pets-confirm__actions";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "pets-confirm__button";
      cancelBtn.textContent = "Cancel";

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "pets-confirm__button pets-confirm__button--danger";
      confirmBtn.textContent = "Delete permanently";
      confirmBtn.disabled = true;

      actions.append(cancelBtn, confirmBtn);
      container.append(title, description, inputLabel, actions);
      modal.dialog.append(container);

      let settled = false;

      function cleanup() {
        input.removeEventListener("input", handleInput);
        cancelBtn.removeEventListener("click", handleCancel);
        confirmBtn.removeEventListener("click", handleConfirm);
      }

      function closeModal() {
        window.setTimeout(() => {
          modal.setOpen(false);
          if (modal.root.isConnected) {
            modal.root.remove();
          }
        }, 0);
      }

      function finish(result: boolean) {
        if (settled) return;
        settled = true;
        cleanup();
        closeModal();
        resolve(result);
      }

      function handleInput() {
        confirmBtn.disabled = input.value.trim() !== token;
      }

      function handleCancel(event: Event) {
        event.preventDefault();
        finish(false);
      }

      function handleConfirm(event: Event) {
        event.preventDefault();
        finish(true);
      }

      input.addEventListener("input", handleInput);
      cancelBtn.addEventListener("click", handleCancel);
      confirmBtn.addEventListener("click", handleConfirm);

      window.setTimeout(() => {
        if (!settled) {
          try {
            input.focus();
          } catch {
            /* ignore */
          }
        }
      }, 0);
    });
  }

  function removePetFromState(petId: string): { pet: Pet; index: number } | null {
    const index = pets.findIndex((item) => item.id === petId);
    if (index === -1) return null;
    const next = [...pets];
    const [removed] = next.splice(index, 1);
    pets = next;
    applyFilters();
    return { pet: removed, index };
  }

  async function restoreSoftDeletedPet(petId: string): Promise<void> {
    const entry = pendingUndo.get(petId);
    if (!entry) return;
    clearPendingUndo(petId);
    logUI("INFO", "ui.pets.restore_clicked", { pet_id: petId, household_id: hh });
    const snapshot = clonePet(entry.pet);
    try {
      await petsRepo.restore(hh, petId);
      const insertIndex = Math.max(0, Math.min(entry.index, pets.length));
      const next = [...pets];
      next.splice(insertIndex, 0, snapshot);
      pets = next;
      applyFilters();
      reminderScheduler.rescheduleForPet(petId);
      const context = toReminderRecords([snapshot]);
      reminderScheduler.scheduleMany(context.records, {
        householdId: hh,
        petNames: context.petNames,
      });
      toast.show({ kind: "success", message: `Restored ${toDisplayName(snapshot)}.` });
      logUI("INFO", "ui.pets.restored", { pet_id: petId, household_id: hh });
    } catch (error) {
      const normalized = await recordPetsMutationFailure("pets_restore", error, {
        household_id: hh,
        pet_id: petId,
      });
      toast.show({ kind: "error", message: normalized.message ?? "Could not restore pet." });
      logUI("WARN", "ui.pets.restore_failed", {
        pet_id: petId,
        household_id: hh,
        code: normalized.code,
      });
      const retryTimer = window.setTimeout(() => {
        clearPendingUndo(petId);
      }, 10_000);
      pendingUndo.set(petId, { ...entry, timer: retryTimer });
    }
  }

  async function handleSoftDelete(petId: string): Promise<void> {
    const pet = pets.find((item) => item.id === petId) ?? pendingUndo.get(petId)?.pet;
    if (!pet) return;
    logUI("INFO", "ui.pets.delete_soft_clicked", { pet_id: petId, household_id: hh });
    const confirmed = await confirmSoftDelete(pet);
    if (!confirmed) return;
    try {
      await petsRepo.delete(hh, petId);
    } catch (error) {
      const normalized = await recordPetsMutationFailure("pets_delete_soft", error, {
        household_id: hh,
        pet_id: petId,
      });
      toast.show({ kind: "error", message: normalized.message ?? "Could not delete pet." });
      logUI("WARN", "ui.pets.delete_soft_failed", {
        pet_id: petId,
        household_id: hh,
        code: normalized.code,
      });
      return;
    }

    logUI("INFO", "ui.pets.deleted_soft", { pet_id: petId, household_id: hh });
    const removal = removePetFromState(petId);
    const snapshot = clonePet(removal?.pet ?? pet);
    reminderScheduler.rescheduleForPet(petId);
    if (detailActive && detailPetId === petId) {
      showList();
    }

    clearPendingUndo(petId);
    const timer = window.setTimeout(() => {
      clearPendingUndo(petId);
    }, 10_000);
    pendingUndo.set(petId, { pet: snapshot, index: removal?.index ?? pets.length, timer });

    toast.show({
      kind: "info",
      message: `Deleted ${toDisplayName(snapshot)}.`,
      timeoutMs: 10_000,
      actions: [
        {
          label: "Restore",
          onSelect: () => {
            void restoreSoftDeletedPet(petId);
          },
        },
      ],
    });
  }

  async function handleHardDelete(petId: string): Promise<void> {
    if (!allowHardDelete) return;
    const pet = pets.find((item) => item.id === petId) ?? pendingUndo.get(petId)?.pet;
    if (!pet) return;
    logUI("INFO", "ui.pets.delete_hard_clicked", { pet_id: petId, household_id: hh });
    const confirmed = await confirmHardDelete(pet);
    if (!confirmed) return;
    logUI("INFO", "ui.pets.delete_hard_confirmed", { pet_id: petId, household_id: hh });
    try {
      await petsRepo.deleteHard(hh, petId);
    } catch (error) {
      const normalized = await recordPetsMutationFailure("pets_delete_hard", error, {
        household_id: hh,
        pet_id: petId,
      });
      toast.show({
        kind: "error",
        message: normalized.message ?? "Could not delete pet permanently.",
      });
      logUI("WARN", "ui.pets.delete_hard_failed", {
        pet_id: petId,
        household_id: hh,
        code: normalized.code,
      });
      return;
    }

    logUI("INFO", "ui.pets.deleted_hard", { pet_id: petId, household_id: hh });
    clearPendingUndo(petId);
    removePetFromState(petId);
    reminderScheduler.rescheduleForPet(petId);
    if (detailActive && detailPetId === petId) {
      showList();
    }
    toast.show({
      kind: "success",
      message: `Deleted ${toDisplayName(pet)} permanently.`,
    });
  }

  function applyFilters() {
    filters = { ...filters, models: createFilterModels(pets, filters.query) };
    page.setPets(pets);
    page.setFilter(filters.models, { query: filters.query });
  }

  function consumeFocusAnchor(): "search" | "create" | null {
    if (typeof window === "undefined") return null;
    const hash = window.location.hash ?? "";
    const parts = hash.split("#");
    if (parts.length < 3) return null;
    const action = parts[2];
    const base = `#${parts[1] ?? ""}`;
    try {
      history.replaceState(null, "", base);
    } catch {
      window.location.hash = base;
    }
    if (action === "focus-search") return "search";
    if (action === "focus-create") return "create";
    return null;
  }

  function showList() {
    page.showList();
    page.setScrollOffset(lastScroll);
    detailController = null;
    detailActive = false;
    detailPetId = null;
  }

  async function refresh(affected?: string[]) {
    pets = await loadPets();
    applyFilters();
    if (!affected || affected.length === 0) {
      reminderScheduler.init();
      const next = toReminderRecords(pets);
      reminderScheduler.scheduleMany(next.records, {
        householdId: hh,
        petNames: next.petNames,
      });
      return;
    }
    const unique = Array.from(new Set(affected));
    unique.forEach((id) => reminderScheduler.rescheduleForPet(id));
    const subset = pets.filter((p) => unique.includes(p.id));
    if (subset.length === 0) return;
    const context = toReminderRecords(subset);
    reminderScheduler.scheduleMany(context.records, {
      householdId: hh,
      petNames: context.petNames,
    });
  }

  async function movePet(id: string, delta: number) {
    if (reorderLock) return;
    if (!Number.isFinite(delta) || delta === 0) return;
    const currentIndex = pets.findIndex((pet) => pet.id === id);
    if (currentIndex === -1) return;
    const targetIndex = currentIndex + delta;
    if (targetIndex < 0 || targetIndex >= pets.length) return;

    reorderLock = true;
    const snapshot = pets.map((pet) => ({ ...pet }));

    const nextOrder = [...pets];
    const [moved] = nextOrder.splice(currentIndex, 1);
    nextOrder.splice(targetIndex, 0, moved);
    const normalized = nextOrder.map((pet, index) => ({ ...pet, position: index }));
    pets = normalized;
    applyFilters();
    page.focusRow(id);

    logUI("INFO", "ui.pets.order_move", {
      id,
      from: currentIndex,
      to: targetIndex,
      total: normalized.length,
      household_id: hh,
    });
    incrementDiagnosticsCounter("pets", "ordering_moves");

    const changed = normalized.filter((pet) => {
      const previous = snapshot.find((item) => item.id === pet.id);
      return previous?.position !== pet.position;
    });

    try {
      const TEMP_OFFSET = pets.length + 1000;

      for (let i = 0; i < changed.length; i += 1) {
        const pet = changed[i]!;
        await petsRepo.update(
          hh,
          pet.id,
          { position: TEMP_OFFSET + i } as Partial<Pet>,
        );
      }

      for (const pet of changed) {
        await petsRepo.update(hh, pet.id, { position: pet.position } as Partial<Pet>);
      }
      logUI("INFO", "ui.pets.order_persist", {
        changed: changed.length,
        household_id: hh,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error ?? "unknown");
      logUI("WARN", "ui.pets.order_revert", { reason, household_id: hh });
      await recordPetsMutationFailure("pets_reorder", error, { household_id: hh });
      toast.show({ kind: "error", message: "Could not reorder pets." });
      pets = snapshot.map((pet) => ({ ...pet }));
      applyFilters();
      page.focusRow(id);
      await refresh();
      page.focusRow(id);
    } finally {
      reorderLock = false;
    }
  }

  function handleShortcut(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    const isEditableTarget = Boolean(
      target?.closest("input, textarea, select, [contenteditable='true']"),
    ) || Boolean(target?.isContentEditable);
    const key = event.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    const primaryModifier = isMacPlatform() ? event.metaKey : event.ctrlKey;

    if (document.querySelector('[aria-modal="true"]')) {
      return;
    }

    if (!event.altKey && !event.metaKey && !event.ctrlKey && lower === "n" && !event.shiftKey) {
      if (isEditableTarget) return;
      event.preventDefault();
      if (detailActive && detailController) {
        detailController.focusMedicalDate();
        logUI("INFO", "ui.pets.kbd_shortcut", { key: "N", scope: "detail" });
      } else {
        openAddPetModal();
        logUI("INFO", "ui.pets.kbd_shortcut", { key: "N", scope: "list" });
      }
      return;
    }

    if (key === "Escape" && !event.altKey && !event.shiftKey && !primaryModifier) {
      event.preventDefault();
      if (detailActive && detailController) {
        detailController.handleEscape();
        logUI("INFO", "ui.pets.kbd_shortcut", { key: "Escape", scope: "detail" });
      } else {
        const active = document.activeElement as HTMLElement | null;
        active?.blur?.();
        logUI("INFO", "ui.pets.kbd_shortcut", { key: "Escape", scope: "list" });
      }
      return;
    }

    if (key === "Enter" && primaryModifier && !event.altKey) {
      event.preventDefault();
      let valid = false;
      if (detailActive && detailController) {
        valid = detailController.submitMedicalForm();
        logUI("INFO", "ui.pets.form_submit_kbd", { form: "detail-medical", valid });
      } else {
        valid = page.submitCreateForm();
        logUI("INFO", "ui.pets.form_submit_kbd", { form: "list-create", valid });
      }
      incrementDiagnosticsCounter("pets", "kbd_submissions");
    }
  }

  async function handleCreate(
    input: { name: string; species?: string | null; breed?: string | null },
  ): Promise<Pet> {
    return await timeIt(
      "list.create",
      async () => {
        try {
          const speciesValue = input.species?.trim() ?? "";
          const breedValue = input.breed?.trim() ?? "";
          const created = await petsRepo.create(hh, {
            name: input.name,
            type: speciesValue,
            species: speciesValue ? speciesValue : null,
            breed: breedValue ? breedValue : null,
            position: pets.length,
          } as Partial<Pet>);
          pets = [...pets, created];
          applyFilters();
          reminderScheduler.rescheduleForPet(created.id);
          const scoped = toReminderRecords([created]);
          reminderScheduler.scheduleMany(scoped.records, {
            householdId: hh,
            petNames: scoped.petNames,
          });
          return created;
        } catch (error) {
          const normalized = await recordPetsMutationFailure("pets_create", error, {
            household_id: hh,
          });
          throw normalized;
        }
      },
      {
        successFields: (created) => ({ household_id: hh, pet_id: created.id }),
        errorFields: () => ({ household_id: hh }),
      },
    );
  }

  async function handleEdit(pet: Pet, patch: { name: string; type: string }) {
    await timeIt(
      "list.update",
      async () => {
        try {
          const next: Partial<Pet> = { name: patch.name, type: patch.type };
          await petsRepo.update(hh, pet.id, next);
          const idx = pets.findIndex((p) => p.id === pet.id);
          if (idx !== -1) {
            pets[idx] = { ...pets[idx], name: patch.name, type: patch.type };
          }
          applyFilters();
        } catch (error) {
          const normalized = await recordPetsMutationFailure("pets_update", error, {
            household_id: hh,
            pet_id: pet.id,
          });
          throw normalized;
        }
      },
      {
        successFields: () => ({ household_id: hh, pet_id: pet.id }),
        errorFields: () => ({ household_id: hh, pet_id: pet.id }),
      },
    );
  }

  async function handleChangePhoto(pet: Pet) {
    const selection = await openDialog({ multiple: false, filters: IMAGE_DIALOG_FILTERS });
    const filePath =
      typeof selection === "string"
        ? selection
        : Array.isArray(selection) && selection.length > 0
        ? selection[0]
        : null;
    if (!filePath) return;

    try {
      const fs = await import("@tauri-apps/plugin-fs");
      const bytes = await fs.readFile(filePath);

      const attachmentDir = `${pet.household_id}/pet_image`;
      await mkdir(attachmentDir, "attachments", { recursive: true });

      const pathTail = filePath.split(/[/\\]/).pop() ?? "";
      const extMatch = pathTail.match(/\.([A-Za-z0-9]{1,10})$/);
      const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : "";
      const idFragment = pet.id.replace(/[^A-Za-z0-9_-]/g, "");
      const nameSeed = idFragment ? `pet-${idFragment}` : "pet";
      const candidate = `${nameSeed}-${Date.now()}${ext}`;
      const sanitized = sanitizeRelativePath(candidate);

      await writeBinary(`${attachmentDir}/${sanitized}`, "attachments", bytes);
      await petsUpdateImage(hh, pet.id, sanitized);

      const updated: Pet = { ...pet, image_path: sanitized };
      pets = pets.map((existing) => (existing.id === pet.id ? updated : existing));
      filters = {
        ...filters,
        models: filters.models.map((model) =>
          model.pet.id === pet.id ? { ...model, pet: { ...model.pet, image_path: sanitized } } : model,
        ),
      };
      page.patchPet(updated);
      logUI("INFO", "ui.pets.photo_updated", { pet_id: pet.id, household_id: hh });
    } catch (error) {
      const maybe = error as { code?: string; message?: string } | undefined;
      if (error instanceof PathValidationError) {
        presentFsError({ code: error.code, message: error.message });
        logUI("WARN", "ui.pets.photo_update_failed", {
          pet_id: pet.id,
          household_id: hh,
          code: error.code,
        });
        return;
      }
      if (maybe?.code) {
        const normalizedCode =
          maybe.code === "OUTSIDE_ROOT" ||
          maybe.code === "DOT_DOT_REJECTED" ||
          maybe.code === "UNC_REJECTED" ||
          maybe.code === "CROSS_VOLUME"
            ? "PATH_OUT_OF_VAULT"
            : maybe.code;
        presentFsError({ code: normalizedCode as any, message: maybe.message ?? "" });
        logUI("WARN", "ui.pets.photo_update_failed", {
          pet_id: pet.id,
          household_id: hh,
          code: normalizedCode,
        });
      } else {
        toast.show({ kind: "error", message: "Couldn’t update pet photo." });
        logUI("WARN", "ui.pets.photo_update_failed", {
          pet_id: pet.id,
          household_id: hh,
          code: "unknown",
        });
      }
    }
  }

  function handleRevealPhoto(pet: Pet) {
    if (!pet.image_path) return;
    void revealAttachment("pets", pet.id);
  }

  async function openDetail(pet: Pet) {
    lastScroll = page.getScrollOffset();
    const host = document.createElement("div");
    page.showDetail(host);
    detailActive = true;
    detailPetId = pet.id;

    const persist = async () => {
      await petsRepo.update(hh, pet.id, {
        name: pet.name,
        type: pet.type,
        position: pet.position,
      } as Partial<Pet>);
      await refresh([pet.id]);
    };

    detailController = await timeIt(
      "detail.open",
      async () =>
        await PetDetailView(host, pet, persist, () => {
          showList();
        }, {
          onDeletePet: () => handleSoftDelete(pet.id),
          onDeletePetHard: allowHardDelete ? () => handleHardDelete(pet.id) : undefined,
        }),
      {
        successFields: () => ({ household_id: hh, pet_id: pet.id }),
        errorFields: () => ({ household_id: hh, pet_id: pet.id }),
      },
    );
  }

  // Initial render + reminders
  applyFilters();
  reminderScheduler.init();
  const initial = toReminderRecords(pets);
  reminderScheduler.scheduleMany(initial.records, { householdId: hh, petNames: initial.petNames });

  const focusAction = consumeFocusAnchor();
  if (focusAction === "create") {
    requestAnimationFrame(() => {
      openAddPetModal();
    });
  } else if (focusAction === "search") {
    requestAnimationFrame(() => {
      page.focusSearch();
    });
  }

  page.setCallbacks({
    onRequestCreate: () => openAddPetModal(),
    onOpenPet: (pet) => { void openDetail(pet); },
    onEditPet: (pet, patch) => { void handleEdit(pet, patch); },
    onChangePhoto: (pet) => { void handleChangePhoto(pet); },
    onRevealImage: (pet) => { handleRevealPhoto(pet); },
    onDeletePet: (pet) => {
      void handleSoftDelete(pet.id);
    },
    onDeletePetHard: allowHardDelete
      ? (pet) => {
          void handleHardDelete(pet.id);
        }
      : undefined,
    onReorderPet: (id, delta) => {
      void movePet(id, delta);
    },
  });

  if (typeof document !== "undefined") {
    document.addEventListener("keydown", handleShortcut, true);
    registerViewCleanup(container, () => {
      document.removeEventListener("keydown", handleShortcut, true);
    });
  }

}
