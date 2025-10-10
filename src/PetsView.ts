import type { Pet } from "./models";
import { PetDetailView } from "./PetDetailView";
import { getHouseholdIdForCalls } from "./db/household";
import { petsRepo } from "./repos";
import { reminderScheduler } from "@features/pets/reminderScheduler";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";

function renderPets(listEl: HTMLUListElement, pets: Pet[]) {
  listEl.innerHTML = "";
  pets.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = `${p.name} (${p.type}) `;
    const btn = document.createElement("button");
    btn.textContent = "Open";
    btn.dataset.id = p.id;
    li.appendChild(btn);
    listEl.appendChild(li);
  });
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

export async function PetsView(container: HTMLElement) {
  runViewCleanups(container);
  const section = document.createElement("section");
  container.innerHTML = "";
  container.appendChild(section);

  registerViewCleanup(container, () => {
    reminderScheduler.cancelAll();
  });

  const hh = await getHouseholdIdForCalls();

  async function loadPets(): Promise<Pet[]> {
    // Ordered to match other views (position, created_at, id)
    return await petsRepo.list({ householdId: hh, orderBy: "position, created_at, id" });
  }

  let pets: Pet[] = await loadPets();
  reminderScheduler.init();
  const initial = toReminderRecords(pets);
  reminderScheduler.scheduleMany(initial.records, {
    householdId: hh,
    petNames: initial.petNames,
  });

  async function refresh(listEl?: HTMLUListElement, affected?: string[]) {
    pets = await loadPets();
    if (listEl) renderPets(listEl, pets);
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

  function showList() {
    section.innerHTML = `
      <ul id="pet-list"></ul>
      <form id="pet-form">
        <input id="pet-name" type="text" placeholder="Name" required />
        <input id="pet-type" type="text" placeholder="Type" required />
        <button type="submit">Add Pet</button>
      </form>
    `;
    const listEl = section.querySelector<HTMLUListElement>("#pet-list");
    const form = section.querySelector<HTMLFormElement>("#pet-form");
    const nameInput = section.querySelector<HTMLInputElement>("#pet-name");
    const typeInput = section.querySelector<HTMLInputElement>("#pet-type");

    if (listEl) renderPets(listEl, pets);

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!nameInput || !typeInput || !listEl) return;

      const created = await petsRepo.create(hh, {
        name: nameInput.value,
        type: typeInput.value,
        position: pets.length,
      } as Partial<Pet>);

      pets.push(created);
      renderPets(listEl, pets);
      reminderScheduler.rescheduleForPet(created.id);
      const scoped = toReminderRecords([created]);
      reminderScheduler.scheduleMany(scoped.records, {
        householdId: hh,
        petNames: scoped.petNames,
      });
      form.reset();
    });

    listEl?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
      if (!btn) return;
      const id = btn.dataset.id!;
      const pet = pets.find((p) => p.id === id);
      if (!pet) return;

      // Persist callback: update basic fields if PetDetailView modified them,
      // then refresh the list and reminders.
      const persist = async () => {
        // defensively update name/type/position if changed
        await petsRepo.update(hh, pet.id, {
          name: pet.name,
          type: pet.type,
          position: pet.position,
        } as Partial<Pet>);
        await refresh(listEl ?? undefined, [pet.id]);
      };

      PetDetailView(section, pet, persist, showList);
    });
  }

  showList();
}
