import type { Pet } from "./models";
import { PetDetailView } from "./PetDetailView";
import { nowMs } from "./db/time";
import { getHouseholdIdForCalls } from "./db/household";
import { petsRepo } from "./repos";
import { isPermissionGranted, requestPermission, sendNotification } from "./notification";
import { createPetsPage, createFilterModels, type FilteredPet } from "./features/pets/PetsPage";
import { updatePageBanner } from "./ui/updatePageBanner";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";

const MAX_TIMEOUT = 2_147_483_647; // ~24.8 days

function scheduleAt(ts: number, cb: () => void) {
  const delay = ts - nowMs();
  if (delay <= 0) {
    cb();
    return;
  }
  const chunk = Math.min(delay, MAX_TIMEOUT);
  setTimeout(() => scheduleAt(ts, cb), chunk);
}

async function schedulePetReminders(pets: Pet[]) {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return;

  const now = nowMs();
  pets.forEach((pet) => {
    (pet.medical ?? []).forEach((record) => {
      if (!record.reminder) return;
      if (record.reminder > now) {
        scheduleAt(record.reminder, () => {
          sendNotification({ title: "Pet Reminder", body: `${pet.name}: ${record.description}` });
        });
      } else if (now < record.date) {
        sendNotification({ title: "Pet Reminder", body: `${pet.name}: ${record.description}` });
      }
    });
  });
}

interface FiltersState {
  query: string;
  models: FilteredPet[];
}

export async function PetsView(container: HTMLElement) {
  runViewCleanups(container);
  updatePageBanner({ id: "pets", display: { label: "Pets" } });

  const page = createPetsPage(container);
  registerViewCleanup(container, () => {
    page.destroy();
  });

  const householdId = await getHouseholdIdForCalls();

  async function loadPets(): Promise<Pet[]> {
    return await petsRepo.list({ householdId, orderBy: "position, created_at, id" });
  }

  let pets: Pet[] = await loadPets();
  await schedulePetReminders(pets);

  let filters: FiltersState = {
    query: "",
    models: createFilterModels(pets, ""),
  };
  page.setFilter(filters.models);

  let searchHandle: number | undefined;
  let lastScroll = 0;

  function applyFilters() {
    filters = {
      query: filters.query,
      models: createFilterModels(pets, filters.query),
    };
    page.setFilter(filters.models);
    if (filters.query) {
      page.setScrollOffset(0);
    }
  }

  async function refreshFromSource() {
    pets = await loadPets();
    applyFilters();
    await schedulePetReminders(pets);
  }

  async function handleCreate(input: { name: string; type: string }): Promise<Pet> {
    const created = await petsRepo.create(householdId, {
      name: input.name,
      type: input.type,
      position: pets.length,
    } as Partial<Pet>);
    pets = [...pets, created];
    applyFilters();
    await schedulePetReminders([created]);
    return created;
  }

  async function handleEdit(pet: Pet, patch: { name: string; type: string }) {
    const next: Partial<Pet> = { name: patch.name, type: patch.type };
    await petsRepo.update(householdId, pet.id, next);
    const idx = pets.findIndex((p) => p.id === pet.id);
    if (idx !== -1) {
      pets[idx] = { ...pets[idx], name: patch.name, type: patch.type };
    }
    applyFilters();
  }

  function showList() {
    page.showList();
    page.setScrollOffset(lastScroll);
  }

  async function openDetail(pet: Pet) {
    lastScroll = page.getScrollOffset();
    const host = document.createElement("div");
    host.className = "pets__detail-host";
    page.showDetail(host);

    const persist = async () => {
      await petsRepo.update(householdId, pet.id, {
        name: pet.name,
        type: pet.type,
        position: pet.position,
      } as Partial<Pet>);
      await refreshFromSource();
    };

    await PetDetailView(host, pet, persist, showList);
  }

  page.setCallbacks({
    onCreate: handleCreate,
    onOpenPet: (pet) => {
      void openDetail(pet);
    },
    onEditPet: (pet, patch) => {
      void handleEdit(pet, patch);
    },
    onSearchChange: (value: string) => {
      if (searchHandle) {
        window.clearTimeout(searchHandle);
      }
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
