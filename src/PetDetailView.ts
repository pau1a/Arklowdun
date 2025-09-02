import { openPath } from "@tauri-apps/plugin-opener";
import type { Pet, PetMedicalRecord } from "./models";
import { nowMs, toDate } from "./db/time";
import { defaultHouseholdId } from "./db/household";
import { newUuidV7 } from "./db/id";

function renderRecords(listEl: HTMLUListElement, records: PetMedicalRecord[]) {
  listEl.innerHTML = "";
  records.forEach((r) => {
    const li = document.createElement("li");
    let text = `${toDate(r.date).toLocaleDateString()} ${r.description}`;
    if (r.reminder) {
      text += ` (reminder ${toDate(r.reminder).toLocaleDateString()})`;
    }
    text += " ";
    li.textContent = text;
    if (r.document) {
      const btn = document.createElement("button");
      btn.textContent = "Open document";
      btn.addEventListener("click", () => openPath(r.document));
      li.appendChild(btn);
    }
    listEl.appendChild(li);
  });
}

export function PetDetailView(
  container: HTMLElement,
  pet: Pet,
  onChange: () => void,
  onBack: () => void
) {
  container.innerHTML = `
    <button id="back">Back</button>
    <h2>${pet.name}</h2>
    <h3>Medical Records</h3>
    <ul id="record-list"></ul>
    <form id="record-form">
      <input id="record-date" type="date" required />
      <input id="record-desc" type="text" placeholder="Description" required />
      <input id="record-doc" type="text" placeholder="Document path" />
      <input id="record-rem" type="date" placeholder="Reminder" />
      <button type="submit">Add Record</button>
    </form>
  `;

  const backBtn = container.querySelector<HTMLButtonElement>("#back");
  const listEl = container.querySelector<HTMLUListElement>("#record-list");
  const form = container.querySelector<HTMLFormElement>("#record-form");
  const dateInput = container.querySelector<HTMLInputElement>("#record-date");
  const descInput = container.querySelector<HTMLInputElement>("#record-desc");
  const docInput = container.querySelector<HTMLInputElement>("#record-doc");
  const remInput = container.querySelector<HTMLInputElement>("#record-rem");

  if (listEl) renderRecords(listEl, pet.medical);

  backBtn?.addEventListener("click", () => onBack());

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!dateInput || !descInput || !listEl) return;
    const [y, m, d] = dateInput.value.split("-").map(Number);
    const recordDate = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
    let reminder: number | undefined;
    if (remInput && remInput.value) {
      const [ry, rm, rd] = remInput.value.split("-").map(Number);
      const remDate = new Date(ry, (rm ?? 1) - 1, rd ?? 1, 12, 0, 0, 0);
      reminder = remDate.getTime();
    }
    const now = nowMs();
    const record: PetMedicalRecord = {
      id: newUuidV7(),
      pet_id: pet.id,
      date: recordDate.getTime(),
      description: descInput.value,
      document: docInput?.value ?? "",
      reminder,
      household_id: pet.household_id || (await defaultHouseholdId()),
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    pet.medical.push(record);
    pet.updated_at = now;
    onChange();
    renderRecords(listEl, pet.medical);
    form.reset();
  });
}

