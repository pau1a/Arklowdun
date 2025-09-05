// src/DashboardView.ts
import { readTextFile, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { newUuidV7 } from "./db/id";
import { nowMs, toDate } from "./db/time";
import { defaultHouseholdId } from "./db/household";
import { toMs } from "./db/normalize";
import storage from "./storage";
import { billsRepo, policiesRepo, eventsApi } from "./repos";
import type { Vehicle, Event } from "./models";

const STORE_DIR = "Arklowdun";
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" });

function classifyStatus(dueMs: number, now = Date.now()): "overdue" | "today" | "soon" {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  if (dueMs < start.getTime()) return "overdue";
  if (dueMs < end.getTime()) return "today";
  if (dueMs - now <= 7 * 86400000) return "soon";
  return "soon";
}

function renderRow(text: string, due: number) {
  const status = classifyStatus(due);
  const title = status === "today" ? "Due today" : status[0].toUpperCase() + status.slice(1);

  return `
    <div class="item" role="listitem">
      <div class="item__left">
        <span class="status-dot status-dot--${status}" title="${title}" aria-label="${title}"></span>
        <span>${text}</span>
      </div>
      <a class="pill pill--ghost" href="#" aria-label="View item">View</a>
    </div>`;
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
      const rename: Record<string,string> = {
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
        if (oldK in i) { i[newK] = i[oldK]; delete i[oldK]; changed = true; }
      }
      for (const k of [
        "due_date","renewal_date","warranty_expiry","purchase_date","date",
        "mot_date","service_date","starts_at","reminder","mot_reminder",
        "service_reminder","birthday",
      ]) {
        if (k in i) {
          const ms = toMs(i[k]);
          if (ms !== undefined) { if (ms !== i[k]) changed = true; i[k] = ms; }
        }
      }
      if (!i.created_at) { i.created_at = nowMs(); changed = true; }
      if (!i.updated_at) { i.updated_at = i.created_at; changed = true; }
      if (!i.household_id) { i.household_id = hh; changed = true; }
      if (typeof i.position !== "number") { i.position = 0; changed = true; }
      if ("deletedAt" in i) { (i as any).deleted_at = i.deletedAt; delete i.deletedAt; changed = true; }
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

export async function DashboardView(container: HTMLElement) {
  const section = document.createElement("section");
  section.className = "dashboard";
  section.innerHTML = `
      <header class="dashboard__header">
        <div>
          <h2>Dashboard</h2>
          <p class="kicker">What needs your attention</p>
        </div>
        <div class="dashboard__actions">
          <button class="btn btn--accent">+ Event</button>
          <button class="btn btn--secondary">+ Note</button>
        </div>
      </header>
      <div class="card">
        <h3><i class="card__icon fa-solid fa-triangle-exclamation" aria-hidden="true"></i>Attention</h3>
        <div class="list" id="dash-list" role="list"></div>
      </div>
      <div class="card">
        <h3><i class="card__icon fa-regular fa-clock" aria-hidden="true"></i>Upcoming</h3>
        <p>Coming soon</p>
      </div>
    `;
  container.innerHTML = "";
  container.appendChild(section);

  const listEl = section.querySelector<HTMLDivElement>("#dash-list");
  const items: { date: number; text: string }[] = [];
  const now = nowMs();
  const hh = await defaultHouseholdId();

  // Bills
  {
    const bills = await billsRepo.list({ householdId: hh });
    const next = bills.filter(b => b.due_date >= now).sort((a,b) => a.due_date - b.due_date)[0];
    if (next) {
      const due = next.due_date;
      items.push({ date: due, text: `Bill ${money.format(next.amount / 100)} due ${toDate(due).toLocaleDateString()}` });
    }
  }

  // Policies
  {
    const policies = await policiesRepo.list({ householdId: hh });
    const next = policies.filter(p => p.due_date >= now).sort((a,b) => a.due_date - b.due_date)[0];
    if (next) {
      const due = next.due_date;
      items.push({ date: due, text: `Policy ${money.format(next.amount / 100)} renews ${toDate(due).toLocaleDateString()}` });
    }
  }

  // Vehicles (still from local JSON for now)
  {
    const vehicles = await loadJson<Vehicle>("vehicles.json");
    const vehicleDates: { date: number; text: string }[] = [];
    for (const v of vehicles) {
      if (v.mot_date >= now) vehicleDates.push({ date: v.mot_date, text: `${v.name} MOT ${toDate(v.mot_date).toLocaleDateString()}` });
      if (v.service_date >= now) vehicleDates.push({ date: v.service_date, text: `${v.name} service ${toDate(v.service_date).toLocaleDateString()}` });
    }
    vehicleDates.sort((a,b) => a.date - b.date);
    if (vehicleDates[0]) items.push(vehicleDates[0]);
  }

  // Events (via eventsApi)
  {
    const events: Event[] = await eventsApi.listRange(hh, now, Number.MAX_SAFE_INTEGER);
    const next = events.sort((a,b) => a.starts_at - b.starts_at)[0];
    if (next) items.push({ date: next.starts_at, text: `${next.title} ${toDate(next.starts_at).toLocaleString()}` });
  }

  // Render
  items.sort((a, b) => a.date - b.date);
  if (!items.length) {
    if (listEl) listEl.textContent = "No upcoming items";
  } else if (listEl) {
    listEl.innerHTML = items.map((i) => renderRow(i.text, i.date)).join("");
  }
}
