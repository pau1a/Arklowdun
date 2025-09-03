import { readTextFile, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { newUuidV7 } from "./db/id";
import { nowMs, toDate } from "./db/time";
import { defaultHouseholdId } from "./db/household";
import { toMs } from "./db/normalize";
import storage from "./storage";
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
    const hh = await defaultHouseholdId();
    let changed = false;
    arr = arr.map((i: any) => {
      if (typeof i.id === "number") { i.id = newUuidV7(); changed = true; }
      const rename: Record<string, string> = {
        dueDate: "due_date",
        renewalDate: "renewal_date",
        warrantyExpiry: "warranty_expiry",
        purchaseDate: "purchase_date",
        motDate: "mot_date",
        serviceDate: "service_date",
        motReminder: "mot_reminder",
        serviceReminder: "service_reminder",
        categoryId: "category_id",
        monthlyBudget: "monthly_budget",
      };
      for (const [oldK, newK] of Object.entries(rename)) {
        if (oldK in i) {
          i[newK] = i[oldK];
          delete i[oldK];
          changed = true;
        }
      }
      for (const k of [
        "due_date",
        "renewal_date",
        "warranty_expiry",
        "purchase_date",
        "date",
        "mot_date",
        "service_date",
        "datetime",
        "reminder",
        "mot_reminder",
        "service_reminder",
        "birthday",
      ]) {
        if (k in i) {
          const ms = toMs(i[k]);
          if (ms !== undefined) {
            if (ms !== i[k]) changed = true;
            i[k] = ms;
          }
        }
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
      if ("deletedAt" in i) {
        (i as any).deleted_at = i.deletedAt;
        delete i.deletedAt;
        changed = true;
      }
      return i as T;
    });
    arr = arr.filter((i: any) => (i as any).deleted_at == null);
    arr.sort((a: any, b: any) => (a as any).position - (b as any).position || (a as any).created_at - (b as any).created_at);
    if (changed) {
      const key = file.replace(/\.json$/, "") as keyof typeof storage;
      if (!(key in storage) || storage[key] === "json") {
        await writeTextFile(p, JSON.stringify(arr), { baseDir: BaseDirectory.AppLocalData });
      }
    }
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
    .filter((b) => b.due_date >= now)
    .sort((a, b) => a.due_date - b.due_date)[0];
  if (nextBill) {
    const due = nextBill.due_date;
    items.push({
      date: due,
      text: `Bill ${money.format(nextBill.amount)} due ${toDate(due).toLocaleDateString()}`,
    });
  }

  const policies = await loadJson<Policy>("policies.json");
  const nextPolicy = policies
    .filter((p) => p.due_date >= now)
    .sort((a, b) => a.due_date - b.due_date)[0];
  if (nextPolicy) {
    const due = nextPolicy.due_date;
    items.push({
      date: due,
      text: `Policy ${money.format(nextPolicy.amount)} renews ${toDate(due).toLocaleDateString()}`,
    });
  }

  const vehicles = await loadJson<Vehicle>("vehicles.json");
  const vehicleDates: { date: number; text: string }[] = [];
  vehicles.forEach((v) => {
    const mot = v.mot_date;
    if (mot >= now)
      vehicleDates.push({ date: mot, text: `${v.name} MOT ${toDate(mot).toLocaleDateString()}` });
    const service = v.service_date;
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

