import { isPermissionGranted, requestPermission, sendNotification } from "./notification";
import type { Pet } from "./models";
import { PetDetailView } from "./PetDetailView";
import { nowMs } from "./db/time";
import { defaultHouseholdId } from "./db/household";
import { petsRepo } from "./repos";

const MAX_TIMEOUT = 2_147_483_647; // ~24.8 days
function scheduleAt(ts: number, cb: () => void) {
  const delay = ts - nowMs();
  if (delay <= 0) return void cb();
  const chunk = Math.min(delay, MAX_TIMEOUT);
  setTimeout(() => scheduleAt(ts, cb), chunk);
}

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

async function schedulePetReminders(pets: Pet[]) {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return;

  const now = nowMs();
  pets.forEach((p) => {
    (p.medical ?? []).forEach((r) => {
      if (!r.reminder) return;
      if (r.reminder > now) {
        scheduleAt(r.reminder, () => {
          sendNotification({ title: "Pet Reminder", body: `${p.name}: ${r.description}` });
        });
      } else {
        const due = r.date;
        if (now < due) {
          sendNotification({ title: "Pet Reminder", body: `${p.name}: ${r.description}` });
        }
      }
    });
  });
}

export async function PetsView(container: HTMLElement) {
  const section = document.createElement("section");
  container.innerHTML = "";
  container.appendChild(section);

  const hh = await defaultHouseholdId();

  async function loadPets(): Promise<Pet[]> {
    // Ordered to match other views (position, created_at, id)
    return await petsRepo.list({ householdId: hh, orderBy: "position, created_at, id" });
  }

  let pets: Pet[] = await loadPets();
  await schedulePetReminders(pets);

  async function refresh(listEl?: HTMLUListElement) {
    pets = await loadPets();
    if (listEl) renderPets(listEl, pets);
    await schedulePetReminders(pets);
  }

  function showList() {
    section.innerHTML = `
      <h2>Pets</h2>
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
      await schedulePetReminders([created]);
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
        await refresh();
      };

      PetDetailView(section, pet, persist, showList);
    });
  }

  showList();
}
