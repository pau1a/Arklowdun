import { openPath } from "@tauri-apps/plugin-opener";
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
import type { Bill } from "./models";
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
const FILE_NAME = "bills.json";
async function loadBills(): Promise<Bill[]> {
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
      if ("dueDate" in i) {
        const ms = toMs(i.dueDate);
        if (ms !== undefined) {
          i.due_date = ms;
          changed = true;
        }
        delete i.dueDate;
      }
      for (const k of ["due_date", "reminder"]) {
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
      if ("deletedAt" in i) {
        i.deleted_at = i.deletedAt;
        delete i.deletedAt;
        changed = true;
      }
      if (!i.household_id) {
        i.household_id = hh;
        changed = true;
      }
      return i;
    });
    arr = arr.filter((i: any) => i.deleted_at == null);
    if (changed) await saveBills(arr as Bill[]);
    return arr as Bill[];
  } catch (e) {
    console.error("loadBills failed:", e);
    return [];
  }
}
async function saveBills(bills: Bill[]): Promise<void> {
  await mkdir(STORE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
  const p = await join(STORE_DIR, FILE_NAME);
  await writeTextFile(p, JSON.stringify(bills, null, 2), { baseDir: BaseDirectory.AppLocalData });
}

function renderBills(listEl: HTMLUListElement, bills: Bill[]) {
  listEl.innerHTML = "";
  bills.forEach((b) => {
    const li = document.createElement("li");
    li.textContent = `${money.format(b.amount)} due ${toDate(b.due_date).toLocaleDateString()} `;
    const btn = document.createElement("button");
    btn.textContent = "Open document";
    btn.addEventListener("click", () => openPath(b.document));
    li.appendChild(btn);
    listEl.appendChild(li);
  });
}

async function scheduleBillReminders(bills: Bill[]) {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return;
  const now = nowMs();
  bills.forEach((b) => {
    const dueTs = b.due_date;
    if (!b.reminder) return;
    if (b.reminder > now) {
      scheduleAt(b.reminder, () => {
        sendNotification({
          title: "Bill Due",
          body: `${money.format(b.amount)} due on ${toDate(dueTs).toLocaleDateString()}`,
        });
      });
    } else if (now < dueTs) {
      // catch-up if the app was closed at reminder time
      sendNotification({
        title: "Bill Due",
        body: `${money.format(b.amount)} due on ${toDate(dueTs).toLocaleDateString()}`,
      });
    }
  });
}

export async function BillsView(container: HTMLElement) {
  const section = document.createElement("section");
  section.innerHTML = `
    <h2>Bills</h2>
    <ul id="bill-list"></ul>
    <form id="bill-form">
      <input id="bill-amount" type="number" step="0.01" placeholder="Amount" required />
      <input id="bill-due" type="date" required />
      <input id="bill-doc" type="text" placeholder="Document path" required />
      <button type="submit">Add Bill</button>
    </form>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const listEl = section.querySelector<HTMLUListElement>("#bill-list");
  const form = section.querySelector<HTMLFormElement>("#bill-form");
  const amountInput = section.querySelector<HTMLInputElement>("#bill-amount");
  const dueInput = section.querySelector<HTMLInputElement>("#bill-due");
  const docInput = section.querySelector<HTMLInputElement>("#bill-doc");

  let bills: Bill[] = await loadBills();
  if (listEl) renderBills(listEl, bills);
  await scheduleBillReminders(bills);

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!amountInput || !dueInput || !docInput) return;
    // parse YYYY-MM-DD safely: store due at local noon to avoid UTC date shifts
    const [y, m, d] = dueInput.value.split("-").map(Number);
    const dueLocalNoon = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
    const dueTs = dueLocalNoon.getTime();
    const reminder = dueTs - 24 * 60 * 60 * 1000; // 1 day before
    const now = nowMs();
    const bill: Bill = {
      id: newUuidV7(),
      amount: parseFloat(amountInput.value),
      due_date: dueTs,
      document: docInput.value,
      reminder,
      household_id: await defaultHouseholdId(),
      created_at: now,
      updated_at: now,
    };
    bills.push(bill);
    saveBills(bills).then(() => {
      if (listEl) renderBills(listEl, bills);
      scheduleBillReminders([bill]);
    });
    form.reset();
  });
}
