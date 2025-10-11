import type { Pet } from "./models";
import { PetDetailView, type PetDetailController } from "./ui/pets/PetDetailView";
import { getHouseholdIdForCalls } from "./db/household";
import { petsRepo } from "./repos";
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

  let listController: PetsListController | null = null;
  const page = createPetsPage(container);

  listController = {
    focusCreate: () => page.focusCreate(),
    focusSearch: () => page.focusSearch(),
    submitCreateForm: () => page.submitCreateForm(),
    clearSearch: () => page.clearSearch(),
    getSearchValue: () => page.getSearchValue(),
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
  let searchHandle: number | undefined;
  let lastScroll = 0;
  let detailController: PetDetailController | null = null;
  let detailActive = false;
  let reorderLock = false;

  function applyFilters() {
    filters = { ...filters, models: createFilterModels(pets, filters.query) };
    page.setPets(pets);
    page.setFilter(filters.models);
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
        page.focusCreate();
        logUI("INFO", "ui.pets.kbd_shortcut", { key: "N", scope: "list" });
      }
      return;
    }

    if (key === "/" && !event.altKey && !primaryModifier && !event.shiftKey) {
      if (isEditableTarget) return;
      event.preventDefault();
      page.focusSearch();
      logUI("INFO", "ui.pets.kbd_shortcut", { key: "/", scope: detailActive ? "detail" : "list" });
      return;
    }

    if (key === "Escape" && !event.altKey && !event.shiftKey && !primaryModifier) {
      event.preventDefault();
      if (detailActive && detailController) {
        detailController.handleEscape();
        logUI("INFO", "ui.pets.kbd_shortcut", { key: "Escape", scope: "detail" });
      } else {
        if (page.getSearchValue()) {
          page.clearSearch();
        } else {
          const active = document.activeElement as HTMLElement | null;
          active?.blur?.();
        }
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

  async function handleCreate(input: { name: string; type: string }): Promise<Pet> {
    return await timeIt(
      "list.create",
      async () => {
        try {
          const created = await petsRepo.create(hh, {
            name: input.name,
            type: input.type,
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

  async function openDetail(pet: Pet) {
    lastScroll = page.getScrollOffset();
    const host = document.createElement("div");
    page.showDetail(host);
    detailActive = true;

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
      page.focusCreate();
    });
  } else if (focusAction === "search") {
    requestAnimationFrame(() => {
      page.focusSearch();
    });
  }

  page.setCallbacks({
    onCreate: (input) => handleCreate(input),
    onOpenPet: (pet) => { void openDetail(pet); },
    onEditPet: (pet, patch) => { void handleEdit(pet, patch); },
    onReorderPet: (id, delta) => {
      void movePet(id, delta);
    },
    onSearchChange: (value: string) => {
      if (searchHandle) window.clearTimeout(searchHandle);
      searchHandle = window.setTimeout(() => {
        filters = { ...filters, query: value.trim() };
        applyFilters();
      }, 200);
    },
  });

  if (typeof document !== "undefined") {
    document.addEventListener("keydown", handleShortcut, true);
    registerViewCleanup(container, () => {
      document.removeEventListener("keydown", handleShortcut, true);
    });
  }

  registerViewCleanup(container, () => {
    if (searchHandle) {
      window.clearTimeout(searchHandle);
      searchHandle = undefined;
    }
  });
}
