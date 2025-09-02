import { openPath } from "@tauri-apps/plugin-opener";
import { resolvePath, sanitizeRelativePath } from "./files/path";
import {
  readTextFile,
  writeTextFile,
  mkdir,
  BaseDirectory,
} from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "./notification";
import type { Vehicle, MaintenanceEntry } from "./models";
import { newUuidV7 } from "./db/id";
import { nowMs, toDate } from "./db/time";
import { defaultHouseholdId } from "./db/household";
import { toMs } from "./db/normalize";

const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "GBP",
});

const MAX_TIMEOUT = 2_147_483_647; // ~24.8 days
function scheduleAt(ts: number, cb: () => void) {
  const delay = ts - nowMs();
  if (delay <= 0) return void cb();
  const chunk = Math.min(delay, MAX_TIMEOUT);
  setTimeout(() => scheduleAt(ts, cb), chunk);
}

// ----- storage -----
const STORE_DIR = "Arklowdun";
const FILE_NAME = "vehicles.json";
async function loadVehicles(): Promise<Vehicle[]> {
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
      if ("motDate" in i) {
        const ms = toMs(i.motDate);
        if (ms !== undefined) {
          i.mot_date = ms;
          changed = true;
        }
        delete i.motDate;
      }
      if ("serviceDate" in i) {
        const ms = toMs(i.serviceDate);
        if (ms !== undefined) {
          i.service_date = ms;
          changed = true;
        }
        delete i.serviceDate;
      }
      if ("motReminder" in i) {
        const ms = toMs(i.motReminder);
        if (ms !== undefined) {
          i.mot_reminder = ms;
          changed = true;
        }
        delete i.motReminder;
      }
      if ("serviceReminder" in i) {
        const ms = toMs(i.serviceReminder);
        if (ms !== undefined) {
          i.service_reminder = ms;
          changed = true;
        }
        delete i.serviceReminder;
      }
      for (const k of ["mot_date", "service_date", "mot_reminder", "service_reminder"]) {
        if (k in i) {
          const ms = toMs(i[k]);
          if (ms !== undefined) {
            if (ms !== i[k]) changed = true;
            i[k] = ms;
          }
        }
      }
      if (Array.isArray(i.maintenance)) {
        i.maintenance = i.maintenance
          .map((m: any) => {
            const ms = toMs(m.date);
            if (ms !== undefined) {
              if (ms !== m.date) changed = true;
              m.date = ms;
            }
            if (!m.id) {
              m.id = newUuidV7();
              changed = true;
            }
            if (!m.vehicle_id) {
              m.vehicle_id = i.id;
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
            if ("document" in m) {
              m.root_key = "appData";
              m.relative_path = sanitizeRelativePath(m.document);
              delete m.document;
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
    if (changed) await saveVehicles(arr as Vehicle[]);
    return arr as Vehicle[];
  } catch (e) {
    console.error("loadVehicles failed:", e);
    return [];
  }
}
async function saveVehicles(vehicles: Vehicle[]): Promise<void> {
  await mkdir(STORE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
  const p = await join(STORE_DIR, FILE_NAME);
  await writeTextFile(p, JSON.stringify(vehicles, null, 2), {
    baseDir: BaseDirectory.AppLocalData,
  });
}

function renderVehicles(listEl: HTMLUListElement, vehicles: Vehicle[]) {
  listEl.innerHTML = "";
  vehicles.forEach((v) => {
    const li = document.createElement("li");
    li.textContent = `${v.name} (MOT ${toDate(v.mot_date).toLocaleDateString()}, Service ${toDate(v.service_date).toLocaleDateString()}) `;
    const btn = document.createElement("button");
    btn.textContent = "Open";
    btn.dataset.id = v.id;
    li.appendChild(btn);
    listEl.appendChild(li);
  });
}

function renderMaintenance(listEl: HTMLUListElement, entries: MaintenanceEntry[]) {
  listEl.innerHTML = "";
  entries.forEach((m) => {
    const li = document.createElement("li");
    li.textContent = `${toDate(m.date).toLocaleDateString()} ${m.type} ${money.format(m.cost)} `;
    if (m.relative_path) {
      const btn = document.createElement("button");
      btn.textContent = "Open document";
      btn.addEventListener("click", async () => {
        try {
          await openPath(await resolvePath(m.root_key, m.relative_path));
        } catch {
          alert(`File location unavailable (root: ${m.root_key})`);
        }
      });
      li.appendChild(btn);
    }
    listEl.appendChild(li);
  });
}

async function scheduleVehicleReminders(vehicles: Vehicle[]) {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return;
  const now = nowMs();
  vehicles.forEach((v) => {
    const motTs = v.mot_date;
    if (v.mot_reminder) {
      if (v.mot_reminder > now) {
        scheduleAt(v.mot_reminder, () => {
          sendNotification({
            title: "MOT Due",
            body: `${v.name} MOT on ${toDate(motTs).toLocaleDateString()}`,
          });
        });
      } else if (now < motTs) {
        sendNotification({
          title: "MOT Due",
          body: `${v.name} MOT on ${toDate(motTs).toLocaleDateString()}`,
        });
      }
    }
    const serviceTs = v.service_date;
    if (v.service_reminder) {
      if (v.service_reminder > now) {
        scheduleAt(v.service_reminder, () => {
          sendNotification({
            title: "Service Due",
            body: `${v.name} service on ${toDate(serviceTs).toLocaleDateString()}`,
          });
        });
      } else if (now < serviceTs) {
        sendNotification({
          title: "Service Due",
          body: `${v.name} service on ${toDate(serviceTs).toLocaleDateString()}`,
        });
      }
    }
  });
}

export async function VehiclesView(container: HTMLElement) {
  const section = document.createElement("section");
  container.innerHTML = "";
  container.appendChild(section);

  let vehicles: Vehicle[] = await loadVehicles();
  await scheduleVehicleReminders(vehicles);

  function showList() {
    section.innerHTML = `
      <h2>Vehicles</h2>
      <ul id="vehicle-list"></ul>
      <form id="vehicle-form">
        <input id="vehicle-name" type="text" placeholder="Name" required />
        <input id="vehicle-mot" type="date" required />
        <input id="vehicle-service" type="date" required />
        <button type="submit">Add Vehicle</button>
      </form>
    `;
    const listEl = section.querySelector<HTMLUListElement>("#vehicle-list");
    const form = section.querySelector<HTMLFormElement>("#vehicle-form");
    const nameInput = section.querySelector<HTMLInputElement>("#vehicle-name");
    const motInput = section.querySelector<HTMLInputElement>("#vehicle-mot");
    const serviceInput = section.querySelector<HTMLInputElement>("#vehicle-service");

    if (listEl) renderVehicles(listEl, vehicles);

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!nameInput || !motInput || !serviceInput || !listEl) return;
      const [y1, m1, d1] = motInput.value.split("-").map(Number);
      const motDate = new Date(y1, (m1 ?? 1) - 1, d1 ?? 1, 12, 0, 0, 0);
      const motReminder = motDate.getTime() - 7 * 24 * 60 * 60 * 1000;
      const [y2, m2, d2] = serviceInput.value.split("-").map(Number);
      const serviceDate = new Date(y2, (m2 ?? 1) - 1, d2 ?? 1, 12, 0, 0, 0);
      const serviceReminder = serviceDate.getTime() - 7 * 24 * 60 * 60 * 1000;
      const now = nowMs();
      const vehicle: Vehicle = {
        id: newUuidV7(),
        name: nameInput.value,
        mot_date: motDate.getTime(),
        service_date: serviceDate.getTime(),
        mot_reminder: motReminder,
        service_reminder: serviceReminder,
        maintenance: [],
        position: vehicles.length,
        household_id: await defaultHouseholdId(),
        created_at: now,
        updated_at: now,
      };
      vehicles.push(vehicle);
      saveVehicles(vehicles).then(() => {
        renderVehicles(listEl, vehicles);
        scheduleVehicleReminders([vehicle]);
      });
      form.reset();
    });

    listEl?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
      if (!btn) return;
      const id = btn.dataset.id!;
      const vehicle = vehicles.find((v) => v.id === id);
      if (vehicle) renderVehicleDetail(vehicle);
    });
  }

  function renderVehicleDetail(vehicle: Vehicle) {
    section.innerHTML = `
      <button id="back">Back</button>
      <h2>${vehicle.name}</h2>
      <form id="dates-form">
        <label>MOT: <input id="mot-date" type="date" value="${toDate(vehicle.mot_date).toISOString().slice(0, 10)}" required /></label>
        <label>Service: <input id="service-date" type="date" value="${toDate(vehicle.service_date).toISOString().slice(0, 10)}" required /></label>
      <button type="submit">Update Dates</button>
      </form>
      <h3>Maintenance</h3>
      <ul id="maint-list"></ul>
      <form id="maint-form">
        <input id="maint-date" type="date" required />
        <input id="maint-type" type="text" placeholder="Type" required />
        <input id="maint-cost" type="number" step="0.01" placeholder="Cost" required />
        <input id="maint-doc" type="text" placeholder="Document path" />
        <button type="submit">Add Entry</button>
      </form>
    `;
    const backBtn = section.querySelector<HTMLButtonElement>("#back");
    const datesForm = section.querySelector<HTMLFormElement>("#dates-form");
    const motDateInput = section.querySelector<HTMLInputElement>("#mot-date");
    const serviceDateInput = section.querySelector<HTMLInputElement>("#service-date");
    const maintList = section.querySelector<HTMLUListElement>("#maint-list");
    const maintForm = section.querySelector<HTMLFormElement>("#maint-form");
    const maintDate = section.querySelector<HTMLInputElement>("#maint-date");
    const maintType = section.querySelector<HTMLInputElement>("#maint-type");
    const maintCost = section.querySelector<HTMLInputElement>("#maint-cost");
    const maintDoc = section.querySelector<HTMLInputElement>("#maint-doc");

    if (maintList) renderMaintenance(maintList, vehicle.maintenance);

    backBtn?.addEventListener("click", () => {
      showList();
    });

    datesForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!motDateInput || !serviceDateInput) return;
      const [y1, m1, d1] = motDateInput.value.split("-").map(Number);
      const motDate = new Date(y1, (m1 ?? 1) - 1, d1 ?? 1, 12, 0, 0, 0);
      vehicle.mot_date = motDate.getTime();
      vehicle.mot_reminder = motDate.getTime() - 7 * 24 * 60 * 60 * 1000;
      const [y2, m2, d2] = serviceDateInput.value.split("-").map(Number);
      const serviceDate = new Date(y2, (m2 ?? 1) - 1, d2 ?? 1, 12, 0, 0, 0);
      vehicle.service_date = serviceDate.getTime();
      vehicle.service_reminder = serviceDate.getTime() - 7 * 24 * 60 * 60 * 1000;
      vehicle.updated_at = nowMs();
      saveVehicles(vehicles).then(() => scheduleVehicleReminders([vehicle]));
    });

    maintForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!maintDate || !maintType || !maintCost || !maintList) return;
      const [y, m, d] = maintDate.value.split("-").map(Number);
      const entryDate = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
      const now = nowMs();
      const entry: MaintenanceEntry = {
        id: newUuidV7(),
        vehicle_id: vehicle.id,
        date: entryDate.getTime(),
        type: maintType.value,
        cost: parseFloat(maintCost.value),
        root_key: "appData",
        relative_path: sanitizeRelativePath(maintDoc?.value ?? ""),
        household_id: vehicle.household_id,
        created_at: now,
        updated_at: now,
      };
      vehicle.updated_at = now;
      vehicle.maintenance.push(entry);
      saveVehicles(vehicles).then(() => {
        renderMaintenance(maintList, vehicle.maintenance);
      });
      maintForm.reset();
    });
  }

  showList();
}

