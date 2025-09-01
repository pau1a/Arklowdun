import { readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { newUuidV7 } from "./db/id";
import { nowMs, toDate } from "./db/time";
import { toMs } from "./db/normalize";
import type { Bill, Policy, Vehicle } from "./models";

const STORE_DIR = "Arklowdun";
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" });

// Keep this local so Dashboard doesn't depend on CalendarView exports.
interface DashEvent {
  id: string;
  title: string;
  datetime: number; // timestamp ms
}

async function loadJson<T>(file: string): Promise<T[]> {
  try {
    const p = await join(STORE_DIR, file);
    const json = await readTextFile(p, { baseDir: BaseDirectory.AppLocalData });
    let arr = JSON.parse(json) as any[];
    arr = arr.map((i: any) => {
      if (typeof i.id === "number") i.id = newUuidV7();
      for (const k of [
        "dueDate",
        "renewalDate",
        "warrantyExpiry",
        "purchaseDate",
        "date",
        "motDate",
        "serviceDate",
        "datetime",
        "reminder",
        "motReminder",
        "serviceReminder",
        "birthday",
      ]) {
        if (k in i) {
          const ms = toMs(i[k]);
          if (ms !== undefined) i[k] = ms;
        }
      }
      return i as T;
    });
    return arr as T[];
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
  const now = nowMs();

  const bills = await loadJson<Bill>("bills.json");
  const nextBill = bills
    .filter((b) => b.dueDate >= now)
    .sort((a, b) => a.dueDate - b.dueDate)[0];
  if (nextBill) {
    const due = nextBill.dueDate;
    items.push({
      date: due,
      text: `Bill ${money.format(nextBill.amount)} due ${toDate(due).toLocaleDateString()}`,
    });
  }

  const policies = await loadJson<Policy>("policies.json");
  const nextPolicy = policies
    .filter((p) => p.dueDate >= now)
    .sort((a, b) => a.dueDate - b.dueDate)[0];
  if (nextPolicy) {
    const due = nextPolicy.dueDate;
    items.push({
      date: due,
      text: `Policy ${money.format(nextPolicy.amount)} renews ${toDate(due).toLocaleDateString()}`,
    });
  }

  const vehicles = await loadJson<Vehicle>("vehicles.json");
  const vehicleDates: { date: number; text: string }[] = [];
  vehicles.forEach((v) => {
    const mot = v.motDate;
    if (mot >= now)
      vehicleDates.push({ date: mot, text: `${v.name} MOT ${toDate(mot).toLocaleDateString()}` });
    const service = v.serviceDate;
    if (service >= now)
      vehicleDates.push({ date: service, text: `${v.name} service ${toDate(service).toLocaleDateString()}` });
  });
  vehicleDates.sort((a, b) => a.date - b.date);
  if (vehicleDates[0]) items.push(vehicleDates[0]);

  const events = await loadEvents();
  const nextEvent = events
    .filter((e) => e.datetime >= now)
    .sort((a, b) => a.datetime - b.datetime)[0];
  if (nextEvent) {
    const dt = nextEvent.datetime;
    items.push({ date: dt, text: `${nextEvent.title} ${toDate(dt).toLocaleString()}` });
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

