import type { Pet } from "./models";
import { PetDetailView } from "./PetDetailView";
import { getHouseholdIdForCalls } from "./db/household";
import { petsRepo } from "./repos";
import { reminderScheduler } from "@features/pets/reminderScheduler";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";
import { createPetsPage, createFilterModels, type FilteredPet } from "@features/pets/PetsPage";

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

export async function PetsView(container: HTMLElement) {
  runViewCleanups(container);

  const page = createPetsPage(container);

  registerViewCleanup(container, () => {
    try {
      page.destroy();
    } catch {
      // ignore
    }
    reminderScheduler.cancelAll();
  });

  const hh = await getHouseholdIdForCalls();

  async function loadPets(): Promise<Pet[]> {
    return await petsRepo.list({ householdId: hh, orderBy: "position, created_at, id" });
  }

  let pets: Pet[] = await loadPets();
  let filters: FiltersState = { query: "", models: [] };
  let searchHandle: number | undefined;
  let lastScroll = 0;

  function applyFilters() {
    filters = { ...filters, models: createFilterModels(pets, filters.query) };
    page.setPets(pets);
    page.setFilter(filters.models);
  }

  function showList() {
    page.showList();
    page.setScrollOffset(lastScroll);
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

  async function handleCreate(input: { name: string; type: string }): Promise<Pet> {
    const created = await petsRepo.create(hh, {
      name: input.name,
      type: input.type,
      position: pets.length,
    } as Partial<Pet>);
    pets = [...pets, created];
    applyFilters();
    // Newly created pets likely have no medical records yet; still update scheduler state
    reminderScheduler.rescheduleForPet(created.id);
    const scoped = toReminderRecords([created]);
    reminderScheduler.scheduleMany(scoped.records, { householdId: hh, petNames: scoped.petNames });
    return created;
  }

  async function handleEdit(pet: Pet, patch: { name: string; type: string }) {
    const next: Partial<Pet> = { name: patch.name, type: patch.type };
    await petsRepo.update(hh, pet.id, next);
    const idx = pets.findIndex((p) => p.id === pet.id);
    if (idx !== -1) {
      pets[idx] = { ...pets[idx], name: patch.name, type: patch.type };
    }
    applyFilters();
  }

  async function openDetail(pet: Pet) {
    lastScroll = page.getScrollOffset();
    const host = document.createElement("div");
    page.showDetail(host);

    const persist = async () => {
      await petsRepo.update(hh, pet.id, {
        name: pet.name,
        type: pet.type,
        position: pet.position,
      } as Partial<Pet>);
      await refresh([pet.id]);
    };

    await PetDetailView(host, pet, persist, showList);
  }

  // Initial render + reminders
  applyFilters();
  reminderScheduler.init();
  const initial = toReminderRecords(pets);
  reminderScheduler.scheduleMany(initial.records, { householdId: hh, petNames: initial.petNames });

  page.setCallbacks({
    onCreate: (input) => handleCreate(input),
    onOpenPet: (pet) => { void openDetail(pet); },
    onEditPet: (pet, patch) => { void handleEdit(pet, patch); },
    onSearchChange: (value: string) => {
      if (searchHandle) window.clearTimeout(searchHandle);
      searchHandle = window.setTimeout(() => {
        filters = { ...filters, query: value.trim() };
        applyFilters();
      }, 200);
    },
  });

  registerViewCleanup(container, () => {
    if (searchHandle) {
      window.clearTimeout(searchHandle);
      searchHandle = undefined;
    }
  });
}
