// src/VehiclesView.ts
import { openPath } from "@tauri-apps/plugin-opener";
import { resolvePath, sanitizeRelativePath } from "./files/path";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "./notification";
import type { Vehicle, MaintenanceEntry } from "./models";
import { nowMs, toDate } from "./db/time";
import { defaultHouseholdId } from "./db/household";
import { vehiclesRepo } from "./repos";
import { invoke } from "@tauri-apps/api/core";

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

// --- maintenance helpers (direct invokes to backend commands) ---
async function listMaintenance(householdId: string, vehicleId: string): Promise<MaintenanceEntry[]> {
  const rows = await invoke<MaintenanceEntry[]>("vehicle_maintenance_list", {
    householdId,
    orderBy: "date, created_at, id",
  });
  return rows.filter((m) => m.vehicle_id === vehicleId);
}

async function createMaintenance(householdId: string, data: Partial<MaintenanceEntry>) {
  return await invoke<MaintenanceEntry>("vehicle_maintenance_create", {
    data: { ...data, household_id: householdId },
  });
}

// --- renderers ---
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

  const hh = await defaultHouseholdId();
  let vehicles: Vehicle[] = await vehiclesRepo.list({ householdId: hh });
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

      // Parse dates at local noon
      const [y1, m1, d1] = motInput.value.split("-").map(Number);
      const motDate = new Date(y1, (m1 ?? 1) - 1, d1 ?? 1, 12, 0, 0, 0);
      const motReminder = motDate.getTime() - 7 * 24 * 60 * 60 * 1000;

      const [y2, m2, d2] = serviceInput.value.split("-").map(Number);
      const serviceDate = new Date(y2, (m2 ?? 1) - 1, d2 ?? 1, 12, 0, 0, 0);
      const serviceReminder = serviceDate.getTime() - 7 * 24 * 60 * 60 * 1000;

      const vehicle = await vehiclesRepo.create(hh, {
        name: nameInput.value,
        mot_date: motDate.getTime(),
        service_date: serviceDate.getTime(),
        mot_reminder: motReminder,
        service_reminder: serviceReminder,
        position: vehicles.length,
      } as Partial<Vehicle>);

      vehicles.push(vehicle);
      renderVehicles(listEl, vehicles);
      scheduleVehicleReminders([vehicle]);
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

  async function renderVehicleDetail(vehicle: Vehicle) {
    const maintenance = await listMaintenance(hh, vehicle.id);

    section.innerHTML = `
      <button id="back">Back</button>
      <h2>${vehicle.name}</h2>
      <form id="dates-form">
        <label>MOT:
          <input id="mot-date" type="date" value="${toDate(vehicle.mot_date).toISOString().slice(0, 10)}" required />
        </label>
        <label>Service:
          <input id="service-date" type="date" value="${toDate(vehicle.service_date).toISOString().slice(0, 10)}" required />
        </label>
        <button type="submit">Update Dates</button>
      </form>

      <h3>Maintenance</h3>
      <ul id="maint-list"></ul>
      <form id="maint-form">
        <input id="maint-date" type="date" required />
        <input id="maint-type" type="text" placeholder="Type" required />
        <input id="maint-cost" type="number" step="0.01" placeholder="Cost" required />
        <input id="maint-doc" type="text" placeholder="Document path (optional)" />
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

    if (maintList) renderMaintenance(maintList, maintenance);

    backBtn?.addEventListener("click", () => showList());

    datesForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!motDateInput || !serviceDateInput) return;

      const [y1, m1, d1] = motDateInput.value.split("-").map(Number);
      const motDate = new Date(y1, (m1 ?? 1) - 1, d1 ?? 1, 12, 0, 0, 0).getTime();
      const motReminder = motDate - 7 * 24 * 60 * 60 * 1000;

      const [y2, m2, d2] = serviceDateInput.value.split("-").map(Number);
      const serviceDate = new Date(y2, (m2 ?? 1) - 1, d2 ?? 1, 12, 0, 0, 0).getTime();
      const serviceReminder = serviceDate - 7 * 24 * 60 * 60 * 1000;

      await vehiclesRepo.update(hh, vehicle.id, {
        mot_date: motDate,
        service_date: serviceDate,
        mot_reminder: motReminder,
        service_reminder: serviceReminder,
        updated_at: Date.now(),
      } as Partial<Vehicle>);

      // refresh local copy
      vehicles = vehicles.map((v) => (v.id === vehicle.id ? { ...v, mot_date: motDate, service_date: serviceDate, mot_reminder: motReminder, service_reminder: serviceReminder, updated_at: Date.now() } : v));
      await scheduleVehicleReminders([vehicles.find(v => v.id === vehicle.id)!]);
    });

    maintForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!maintDate || !maintType || !maintCost || !maintList) return;

      const [y, m, d] = maintDate.value.split("-").map(Number);
      const entryDate = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0).getTime();

      const rel = maintDoc?.value ? sanitizeRelativePath(maintDoc.value) : "";

      await createMaintenance(hh, {
        vehicle_id: vehicle.id,
        date: entryDate,
        type: maintType.value,
        cost: parseFloat(maintCost.value), // kept as-is (major units) to match existing UI formatting
        root_key: "appData",
        relative_path: rel,
      });

      // bump vehicle.updated_at so ordering stays fresh
      await vehiclesRepo.update(hh, vehicle.id, { updated_at: Date.now() } as Partial<Vehicle>);

      const fresh = await listMaintenance(hh, vehicle.id);
      renderMaintenance(maintList, fresh);
      maintForm.reset();
    });
  }

  showList();
}
