import { sanitizeRelativePath } from "../../files/path";
import type { Pet, PetMedicalRecord } from "../../models";
import { petMedicalRepo, petsRepo } from "../../repos";
import { getHouseholdIdForCalls } from "../../db/household";
import { toast } from "../../ui/Toast";
import { openAttachment, revealAttachment, revealLabel } from "../../ui/attachments";
import { logUI } from "@lib/uiLog";
import {
  normalizeError,
  DB_UNHEALTHY_WRITE_BLOCKED,
  DB_UNHEALTHY_WRITE_BLOCKED_MESSAGE,
} from "../../lib/ipc/call";

type Nullable<T> = T | null | undefined;

const PET_MEDICAL_CATEGORY = "pet_medical" as const;

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_HOUSEHOLD: "No active household selected. Refresh and try again.",
  INVALID_CATEGORY: "Attachments must stay inside the pets vault.",
  PATH_OUT_OF_VAULT: "Attachments must stay inside the pets vault.",
  FILENAME_INVALID: "File name is not allowed for vault attachments.",
  [DB_UNHEALTHY_WRITE_BLOCKED]: DB_UNHEALTHY_WRITE_BLOCKED_MESSAGE,
};

interface FocusSnapshot {
  scrollTop: number;
  focusKey: string | null;
}

function formatDate(timestamp: Nullable<number>): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "—";
  const date = new Date(timestamp);
  return date.toLocaleDateString();
}

function toDateInputValue(timestamp: Nullable<number>): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const y = `${date.getFullYear()}`;
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateInput(value: string): number | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parts = value.split("-");
  if (parts.length !== 3) return null;
  const [ys, ms, ds] = parts;
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const date = new Date();
  date.setFullYear(y, m - 1, d);
  date.setHours(12, 0, 0, 0);
  return date.getTime();
}

function computeAge(birthday: Nullable<number>): string | null {
  if (typeof birthday !== "number" || !Number.isFinite(birthday)) return null;
  const birth = new Date(birthday);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let years = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  const dayDiff = today.getDate() - birth.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    years -= 1;
  }
  if (years < 0) return null;
  return `${years} ${years === 1 ? "year" : "years"}`;
}

function resolveError(error: unknown, fallback: string): { message: string; code: string } {
  const normalized = normalizeError(error);
  const message = ERROR_MESSAGES[normalized.code] ?? normalized.message ?? fallback;
  return { message: message || fallback, code: normalized.code };
}

function compareRecords(a: PetMedicalRecord, b: PetMedicalRecord): number {
  const dateDiff = (b.date ?? 0) - (a.date ?? 0);
  if (dateDiff !== 0) return dateDiff;
  const createdDiff = (b.created_at ?? 0) - (a.created_at ?? 0);
  if (createdDiff !== 0) return createdDiff;
  return a.id.localeCompare(b.id);
}

function sortRecords(records: PetMedicalRecord[]): PetMedicalRecord[] {
  return [...records].sort(compareRecords);
}

function snapshotFocus(container: HTMLElement): FocusSnapshot {
  const active = container.contains(document.activeElement)
    ? (document.activeElement as HTMLElement)
    : null;
  const focusKey = active?.dataset.focusKey ?? null;
  const scrollTop = container.scrollTop;
  return { scrollTop, focusKey };
}

function restoreFocus(container: HTMLElement, snapshot: FocusSnapshot): void {
  container.scrollTop = snapshot.scrollTop;
  if (!snapshot.focusKey) return;
  const next = container.querySelector<HTMLElement>(
    `[data-focus-key="${snapshot.focusKey.replace(/"/g, '\\"')}"]`,
  );
  next?.focus();
}

function insertMeta(meta: HTMLElement, label: string, value: string): void {
  const dt = document.createElement("dt");
  dt.textContent = label;
  dt.className = "pet-detail__meta-label";

  const dd = document.createElement("dd");
  dd.textContent = value;
  dd.className = "pet-detail__meta-value";

  meta.append(dt, dd);
}

export async function PetDetailView(
  container: HTMLElement,
  pet: Pet,
  onChange: () => Promise<void> | void,
  onBack: () => void,
): Promise<void> {
  const householdId = await getHouseholdIdForCalls();
  logUI("INFO", "ui.pets.detail_opened", { id: pet.id, household_id: householdId });

  const revealText = revealLabel();

  const root = document.createElement("section");
  root.className = "pet-detail";

  const header = document.createElement("header");
  header.className = "pet-detail__header";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "pet-detail__back";
  backBtn.textContent = "Back";
  backBtn.addEventListener("click", () => {
    onBack();
  });

  const title = document.createElement("h1");
  title.className = "pet-detail__title";
  title.textContent = pet.name;

  header.append(backBtn, title);

  const identity = document.createElement("section");
  identity.className = "pet-detail__identity";

  const avatar = document.createElement("div");
  avatar.className = "pet-detail__avatar";
  avatar.textContent = (pet.name?.[0] ?? "?").toUpperCase();

  const identityBody = document.createElement("div");
  identityBody.className = "pet-detail__identity-body";

  const nameHeading = document.createElement("h2");
  nameHeading.className = "pet-detail__name";
  nameHeading.textContent = pet.name;

  const subtitle = document.createElement("p");
  subtitle.className = "pet-detail__subtitle";
  const species = pet.species ?? pet.type ?? "—";
  const breed = pet.breed ?? "";
  subtitle.textContent = breed ? `${species} · ${breed}` : species;

  const meta = document.createElement("dl");
  meta.className = "pet-detail__meta";
  insertMeta(meta, "Species", species);
  insertMeta(meta, "Breed", breed || "—");
  insertMeta(meta, "Birthday", formatDate(pet.birthday));

  const age = computeAge(pet.birthday);
  if (age) {
    const ageChip = document.createElement("span");
    ageChip.className = "pet-detail__age";
    ageChip.textContent = age;
    identityBody.append(nameHeading, subtitle, meta, ageChip);
  } else {
    identityBody.append(nameHeading, subtitle, meta);
  }

  identity.append(avatar, identityBody);

  const medicalSection = document.createElement("section");
  medicalSection.className = "pet-detail__section";

  const formHeading = document.createElement("h3");
  formHeading.className = "pet-detail__section-title";
  formHeading.textContent = "Add medical record";

  const form = document.createElement("form");
  form.className = "pet-detail__form";
  form.autocomplete = "off";

  const fieldsRow = document.createElement("div");
  fieldsRow.className = "pet-detail__form-row";

  const dateField = document.createElement("label");
  dateField.className = "pet-detail__field";
  dateField.textContent = "Date";
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.required = true;
  dateInput.id = "pet-medical-date";
  dateInput.name = "date";
  dateField.append(dateInput);

  const descField = document.createElement("label");
  descField.className = "pet-detail__field";
  descField.textContent = "Description";
  const descInput = document.createElement("textarea");
  descInput.required = true;
  descInput.name = "description";
  descInput.rows = 2;
  descInput.className = "pet-detail__textarea";
  descField.append(descInput);

  fieldsRow.append(dateField, descField);

  const secondaryRow = document.createElement("div");
  secondaryRow.className = "pet-detail__form-row";

  const reminderField = document.createElement("label");
  reminderField.className = "pet-detail__field";
  reminderField.textContent = "Reminder";
  const reminderInput = document.createElement("input");
  reminderInput.type = "date";
  reminderInput.name = "reminder";
  reminderField.append(reminderInput);

  const documentField = document.createElement("label");
  documentField.className = "pet-detail__field";
  documentField.textContent = "Attachment path";
  const documentInput = document.createElement("input");
  documentInput.type = "text";
  documentInput.name = "document";
  documentInput.placeholder = "e.g. vet/records.pdf";
  documentField.append(documentInput);

  secondaryRow.append(reminderField, documentField);

  const submitRow = document.createElement("div");
  submitRow.className = "pet-detail__actions";
  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "pet-detail__submit";
  submitBtn.textContent = "Add record";
  submitBtn.disabled = true;
  submitRow.append(submitBtn);

  form.append(fieldsRow, secondaryRow, submitRow);

  const historyHeading = document.createElement("h3");
  historyHeading.className = "pet-detail__section-title";
  historyHeading.textContent = "Medical history";

  const historyContainer = document.createElement("div");
  historyContainer.className = "pet-detail__history";
  historyContainer.tabIndex = 0;

  const historyList = document.createElement("div");
  historyList.className = "pet-detail__history-list";
  historyList.setAttribute("role", "list");

  const historyEmpty = document.createElement("p");
  historyEmpty.className = "pet-detail__empty";
  historyEmpty.textContent = "No medical records yet.";
  historyEmpty.hidden = true;

  const historyLoading = document.createElement("p");
  historyLoading.className = "pet-detail__loading";
  historyLoading.textContent = "Loading medical history…";

  historyContainer.append(historyLoading, historyEmpty, historyList);

  medicalSection.append(formHeading, form, historyHeading, historyContainer);

  root.append(header, identity, medicalSection);
  container.innerHTML = "";
  container.append(root);

  let records: PetMedicalRecord[] = [];
  let creating = false;
  const pendingDeletes = new Set<string>();

  function updateSubmitState() {
    const hasRequired = dateInput.value.trim().length > 0 && descInput.value.trim().length > 0;
    submitBtn.disabled = creating || !hasRequired;
  }

  function renderRecords() {
    historyList.innerHTML = "";
    if (records.length === 0) {
      historyEmpty.hidden = false;
    } else {
      historyEmpty.hidden = true;
      for (const record of records) {
        const card = document.createElement("article");
        card.className = "pet-detail__record";
        card.setAttribute("role", "listitem");
        card.dataset.recordId = record.id;

        const cardHeader = document.createElement("header");
        cardHeader.className = "pet-detail__record-header";

        const dateEl = document.createElement("time");
        dateEl.className = "pet-detail__record-date";
        const dateIso = new Date(record.date).toISOString();
        dateEl.dateTime = dateIso;
        dateEl.textContent = formatDate(record.date);
        cardHeader.append(dateEl);

        if (record.reminder) {
          const reminderChip = document.createElement("span");
          reminderChip.className = "pet-detail__record-reminder";
          reminderChip.textContent = `Reminder ${formatDate(record.reminder)}`;
          cardHeader.append(reminderChip);
        }

        const desc = document.createElement("p");
        desc.className = "pet-detail__record-description";
        desc.textContent = record.description;

        const actions = document.createElement("div");
        actions.className = "pet-detail__record-actions";

        if (record.relative_path) {
          const openBtn = document.createElement("button");
          openBtn.type = "button";
          openBtn.className = "pet-detail__record-action";
          openBtn.textContent = "Open";
          openBtn.dataset.recordId = record.id;
          openBtn.dataset.focusKey = `${record.id}:open`;
          openBtn.addEventListener("click", (event) => {
            event.preventDefault();
            void (async () => {
              const result = await openAttachment(PET_MEDICAL_CATEGORY, record.id);
              logUI(result ? "INFO" : "WARN", "ui.pets.attach_open", {
                path: record.relative_path ?? record.document ?? null,
                result: result ? "ok" : "error",
                record_id: record.id,
                pet_id: pet.id,
                household_id: householdId,
              });
            })();
          });
          actions.append(openBtn);

          const revealBtn = document.createElement("button");
          revealBtn.type = "button";
          revealBtn.className = "pet-detail__record-action";
          revealBtn.textContent = revealText;
          revealBtn.dataset.recordId = record.id;
          revealBtn.dataset.focusKey = `${record.id}:reveal`;
          revealBtn.addEventListener("click", (event) => {
            event.preventDefault();
            void (async () => {
              const result = await revealAttachment(PET_MEDICAL_CATEGORY, record.id);
              logUI(result ? "INFO" : "WARN", "ui.pets.attach_reveal", {
                path: record.relative_path ?? record.document ?? null,
                result: result ? "ok" : "error",
                record_id: record.id,
                pet_id: pet.id,
                household_id: householdId,
              });
            })();
          });
          actions.append(revealBtn);
        }

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "pet-detail__record-delete";
        deleteBtn.textContent = "Delete";
        deleteBtn.dataset.recordId = record.id;
        deleteBtn.dataset.focusKey = `${record.id}:delete`;
        deleteBtn.disabled = pendingDeletes.has(record.id);
        deleteBtn.addEventListener("click", (event) => {
          event.preventDefault();
          if (pendingDeletes.has(record.id)) return;
          pendingDeletes.add(record.id);
          deleteBtn.disabled = true;
          const snapshot = snapshotFocus(historyContainer);
          void (async () => {
            try {
              await petMedicalRepo.delete(householdId, record.id);
              await petsRepo.update(householdId, pet.id, { updated_at: Date.now() } as Partial<Pet>);
              records = records.filter((r) => r.id !== record.id);
              renderRecords();
              restoreFocus(historyContainer, snapshot);
              toast.show({ kind: "success", message: "Medical record deleted." });
              logUI("INFO", "ui.pets.medical_delete_success", {
                id: record.id,
                pet_id: pet.id,
                household_id: householdId,
              });
              await onChange?.();
            } catch (err) {
              const { message, code } = resolveError(err, "Could not delete medical record.");
              toast.show({ kind: "error", message });
              logUI("WARN", "ui.pets.medical_delete_fail", {
                id: record.id,
                pet_id: pet.id,
                household_id: householdId,
                code,
              });
              deleteBtn.disabled = false;
            } finally {
              pendingDeletes.delete(record.id);
            }
          })();
        });
        actions.append(deleteBtn);

        card.append(cardHeader, desc, actions);
        historyList.append(card);
      }
    }
  }

  dateInput.addEventListener("input", updateSubmitState);
  descInput.addEventListener("input", updateSubmitState);
  reminderInput.addEventListener("input", () => {
    const reminder = parseDateInput(reminderInput.value);
    if (reminder != null && dateInput.value && reminder < parseDateInput(dateInput.value)!) {
      reminderInput.setCustomValidity("Reminder must be on or after the visit date.");
    } else {
      reminderInput.setCustomValidity("");
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (creating) return;
    const dateValue = parseDateInput(dateInput.value);
    const description = descInput.value.trim();
    if (!dateValue || description.length === 0) {
      updateSubmitState();
      return;
    }
    const reminderValue = parseDateInput(reminderInput.value);
    const rawPath = documentInput.value.trim();
    const relativePath = rawPath.length > 0 ? sanitizeRelativePath(rawPath) : undefined;

    creating = true;
    updateSubmitState();
    const snapshot = snapshotFocus(historyContainer);
    void (async () => {
      try {
        const created = await petMedicalRepo.create(householdId, {
          pet_id: pet.id,
          date: dateValue,
          description,
          reminder: reminderValue ?? undefined,
          relative_path: relativePath,
          category: PET_MEDICAL_CATEGORY,
        });
        await petsRepo.update(householdId, pet.id, { updated_at: Date.now() } as Partial<Pet>);
        records = sortRecords([created, ...records]);
        renderRecords();
        restoreFocus(historyContainer, snapshot);
        toast.show({ kind: "success", message: "Medical record added." });
        logUI("INFO", "ui.pets.medical_create_success", {
          id: created.id,
          pet_id: pet.id,
          household_id: householdId,
        });
        form.reset();
        reminderInput.setCustomValidity("");
        updateSubmitState();
        dateInput.focus();
        await onChange?.();
      } catch (err) {
        const { message, code } = resolveError(err, "Could not save medical record.");
        toast.show({ kind: "error", message });
        logUI("WARN", "ui.pets.medical_create_fail", {
          pet_id: pet.id,
          household_id: householdId,
          code,
        });
      } finally {
        creating = false;
        updateSubmitState();
      }
    })();
  });

  try {
    const fetched = await petMedicalRepo.list({
      householdId,
      petId: pet.id,
      orderBy: "date DESC, created_at DESC, id",
    });
    records = sortRecords(fetched.filter((record) => record.pet_id === pet.id));
  } catch (err) {
    const { message } = resolveError(err, "Could not load medical records.");
    toast.show({ kind: "error", message });
    records = [];
  } finally {
    historyLoading.remove();
    renderRecords();
  }

  updateSubmitState();
  dateInput.value = toDateInputValue(Date.now());
  updateSubmitState();
}
