import {
  readTextFile,
  writeTextFile,
  mkdir,
  BaseDirectory,
} from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { isPermissionGranted, requestPermission, sendNotification } from "./notification";
import type { Pet } from "./models";
import { PetDetailView } from "./PetDetailView";

let nextPetId = 1;

const MAX_TIMEOUT = 2_147_483_647; // ~24.8 days
function scheduleAt(ts: number, cb: () => void) {
  const delay = ts - Date.now();
  if (delay <= 0) return void cb();
  const chunk = Math.min(delay, MAX_TIMEOUT);
  setTimeout(() => scheduleAt(ts, cb), chunk);
}

// ----- storage -----
const STORE_DIR = "Arklowdun";
const FILE_NAME = "pets.json";
async function loadPets(): Promise<Pet[]> {
  try {
    const p = await join(STORE_DIR, FILE_NAME);
    const json = await readTextFile(p, { baseDir: BaseDirectory.AppLocalData });
    return JSON.parse(json) as Pet[];
  } catch {
    return [];
  }
}
async function savePets(pets: Pet[]): Promise<void> {
  await mkdir(STORE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
  const p = await join(STORE_DIR, FILE_NAME);
  await writeTextFile(p, JSON.stringify(pets, null, 2), {
    baseDir: BaseDirectory.AppLocalData,
  });
}

function renderPets(listEl: HTMLUListElement, pets: Pet[]) {
  listEl.innerHTML = "";
  pets.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = `${p.name} (${p.type}) `;
    const btn = document.createElement("button");
    btn.textContent = "Open";
    btn.dataset.id = String(p.id);
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
  const now = Date.now();
  pets.forEach((p) => {
    p.medical.forEach((r) => {
      if (!r.reminder) return;
      if (r.reminder > now) {
        scheduleAt(r.reminder, () => {
          sendNotification({ title: "Pet Reminder", body: `${p.name}: ${r.description}` });
        });
      } else {
        const due = Date.parse(r.date);
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

  let pets: Pet[] = await loadPets();
  await schedulePetReminders(pets);
  nextPetId = pets.reduce((m, p) => Math.max(m, p.id), 0) + 1;

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

    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!nameInput || !typeInput || !listEl) return;
      const pet: Pet = {
        id: nextPetId++,
        name: nameInput.value,
        type: typeInput.value,
        medical: [],
      };
      pets.push(pet);
      savePets(pets).then(() => {
        renderPets(listEl, pets);
      });
      form.reset();
    });

    listEl?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
      if (!btn) return;
      const id = Number(btn.dataset.id);
      const pet = pets.find((p) => p.id === id);
      if (pet) {
        PetDetailView(
          section,
          pet,
          () => {
            savePets(pets).then(() => schedulePetReminders([pet]));
          },
          showList
        );
      }
    });
  }

  showList();
}

