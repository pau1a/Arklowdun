import { readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { newUuidV7 } from "./db/id";
import type { Bill, Policy, Vehicle } from "./models";

const STORE_DIR = "Arklowdun";
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" });

// Keep this local so Dashboard doesn't depend on CalendarView exports.
interface DashEvent {
  id: string;
  title: string;
  datetime: string; // ISO string
}

async function loadJson<T>(file: string): Promise<T[]> {
  try {
    const p = await join(STORE_DIR, file);
    const json = await readTextFile(p, { baseDir: BaseDirectory.AppLocalData });
    const arr = JSON.parse(json) as any[];
    return arr.map((i) => (typeof i.id === "number" ? { ...i, id: newUuidV7() } : i)) as T[];
  } catch {
    return [];
  }
}

// Try Tauri command first; fall back to reading common JSON filenames used by the Calendar view.
async function loadEvents(): Promise<DashEvent[]> {
  try {
    const ev = await invoke<DashEvent[]>("get_events");
    if (Array.isArray(ev)) return ev;
  } catch {}
  for (const f of ["calendar.json", "events.json"]) {
    const fromFs = await loadJson<DashEvent>(f);
    if (fromFs.length) return fromFs;
  }
  return [];
}

export async function DashboardView(container: HTMLElement) {
  const section = document.createElement("section");
  section.innerHTML = `
    <h2>Dashboard</h2>
    <ul id="dash-list"></ul>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const listEl = section.querySelector<HTMLUListElement>("#dash-list");
  const items: { date: number; text: string }[] = [];
  const now = Date.now();

  const bills = await loadJson<Bill>("bills.json");
  const nextBill = bills
    .filter((b) => Date.parse(b.dueDate) >= now)
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate))[0];
  if (nextBill) {
    const due = Date.parse(nextBill.dueDate);
    items.push({
      date: due,
      text: `Bill ${money.format(nextBill.amount)} due ${new Date(due).toLocaleDateString()}`,
    });
  }

  const policies = await loadJson<Policy>("policies.json");
  const nextPolicy = policies
    .filter((p) => Date.parse(p.dueDate) >= now)
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate))[0];
  if (nextPolicy) {
    const due = Date.parse(nextPolicy.dueDate);
    items.push({
      date: due,
      text: `Policy ${money.format(nextPolicy.amount)} renews ${new Date(due).toLocaleDateString()}`,
    });
  }

  const vehicles = await loadJson<Vehicle>("vehicles.json");
  const vehicleDates: { date: number; text: string }[] = [];
  vehicles.forEach((v) => {
    const mot = Date.parse(v.motDate);
    if (!isNaN(mot) && mot >= now)
      vehicleDates.push({ date: mot, text: `${v.name} MOT ${new Date(mot).toLocaleDateString()}` });
    const service = Date.parse(v.serviceDate);
    if (!isNaN(service) && service >= now)
      vehicleDates.push({ date: service, text: `${v.name} service ${new Date(service).toLocaleDateString()}` });
  });
  vehicleDates.sort((a, b) => a.date - b.date);
  if (vehicleDates[0]) items.push(vehicleDates[0]);

  const events = await loadEvents();
  const nextEvent = events
    .filter((e) => Date.parse(e.datetime) >= now)
    .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime))[0];
  if (nextEvent) {
    const dt = Date.parse(nextEvent.datetime);
    items.push({ date: dt, text: `${nextEvent.title} ${new Date(dt).toLocaleString()}` });
  }

  items.sort((a, b) => a.date - b.date);
  if (!items.length) {
    listEl && (listEl.textContent = "No upcoming items");
  } else {
    items.forEach((i) => {
      const li = document.createElement("li");
      li.textContent = i.text;
      listEl?.appendChild(li);
    });
  }
}

