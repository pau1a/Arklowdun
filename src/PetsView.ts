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
import { newUuidV7 } from "./db/id";
import { nowMs } from "./db/time";
import { toMs } from "./db/normalize";
import { defaultHouseholdId } from "./db/household";
import { sanitizeRelativePath } from "./files/path";

const MAX_TIMEOUT = 2_147_483_647; // ~24.8 days
function scheduleAt(ts: number, cb: () => void) {
  const delay = ts - nowMs();
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
    let arr = JSON.parse(json) as any[];
    let changed = false;
    const hh = await defaultHouseholdId();
    arr = arr.map((i: any) => {
      if (typeof i.id === "number") {
        i.id = newUuidV7();
        changed = true;
      }
      if (Array.isArray(i.medical)) {
        i.medical = i.medical
          .map((m: any) => {
            for (const k of ["date", "reminder"]) {
              if (k in m) {
                const ms = toMs(m[k]);
                if (ms !== undefined) {
                  if (ms !== m[k]) changed = true;
                  m[k] = ms;
                }
              }
            }
            if (!m.id) {
              m.id = newUuidV7();
              changed = true;
            }
            if ("document" in m) {
              m.root_key = "appData";
              m.relative_path = sanitizeRelativePath(m.document);
              delete m.document;
              changed = true;
            }
            if (!m.pet_id) {
              m.pet_id = i.id;
              changed = true;
            }
            if (!m.created_at) {
              m.created_at = nowMs();
              changed = true;
            }
            if (!m.updated_at) {
              m.updated_at = m.created_at;
              changed = true;
            }
            if (!m.household_id) {
              m.household_id = hh;
              changed = true;
            }
            if ("deletedAt" in m) {
              m.deleted_at = m.deletedAt;
              delete m.deletedAt;
              changed = true;
            }
            return m;
          })
          .filter((m: any) => m.deleted_at == null);
      }
      if ("deletedAt" in i) {
        i.deleted_at = i.deletedAt;
        delete i.deletedAt;
        changed = true;
      }
      if (!i.created_at) {
        i.created_at = nowMs();
        changed = true;
      }
      if (!i.updated_at) {
        i.updated_at = i.created_at;
        changed = true;
      }
      if (!i.household_id) {
        i.household_id = hh;
        changed = true;
      }
      if (typeof i.position !== 'number') {
        i.position = 0;
        changed = true;
      }
      return i;
    });
    arr = arr.filter((i: any) => i.deleted_at == null);
    arr.sort((a: any, b: any) => a.position - b.position || a.created_at - b.created_at);
    if (changed) await savePets(arr as Pet[]);
    return arr as Pet[];
  } catch (e) {
    console.error("loadPets failed:", e);
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
    p.medical.forEach((r) => {
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

  let pets: Pet[] = await loadPets();
  await schedulePetReminders(pets);

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
      const now = nowMs();
      const pet: Pet = {
        id: newUuidV7(),
        name: nameInput.value,
        type: typeInput.value,
        medical: [],
        position: pets.length,
        household_id: await defaultHouseholdId(),
        created_at: now,
        updated_at: now,
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
      const id = btn.dataset.id!;
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

