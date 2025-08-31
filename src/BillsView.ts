import * as opener from "@tauri-apps/plugin-opener";
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

let nextId = 1;

const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "GBP",
});

const MAX_TIMEOUT = 2_147_483_647; // ~24.8 days
function scheduleAt(ts: number, cb: () => void) {
  const delay = ts - Date.now();
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
    return JSON.parse(json) as Bill[];
  } catch {
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
    li.textContent = `${money.format(b.amount)} due ${new Date(b.dueDate).toLocaleDateString()} `;
    const btn = document.createElement("button");
    btn.textContent = "Open document";
    btn.addEventListener("click", () => opener.open(b.document));
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
  const now = Date.now();
  bills.forEach((b) => {
    const dueTs = Date.parse(b.dueDate);
    if (!b.reminder || isNaN(dueTs)) return;
    if (b.reminder > now) {
      scheduleAt(b.reminder, () => {
        sendNotification({
          title: "Bill Due",
          body: `${money.format(b.amount)} due on ${new Date(dueTs).toLocaleDateString()}`,
        });
      });
    } else if (now < dueTs) {
      // catch-up if the app was closed at reminder time
      sendNotification({
        title: "Bill Due",
        body: `${money.format(b.amount)} due on ${new Date(dueTs).toLocaleDateString()}`,
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
  // schedule reminders for anything already saved
  await scheduleBillReminders(bills);
  // ensure IDs keep increasing across restarts
  nextId = bills.reduce((m, b) => Math.max(m, b.id), 0) + 1;

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!amountInput || !dueInput || !docInput) return;
    // parse YYYY-MM-DD safely: store due at local noon to avoid UTC date shifts
    const [y, m, d] = dueInput.value.split("-").map(Number);
    const dueLocalNoon = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
    const dueTs = dueLocalNoon.getTime();
    const reminder = dueTs - 24 * 60 * 60 * 1000; // 1 day before
    const bill: Bill = {
      id: nextId++,
      amount: parseFloat(amountInput.value),
      dueDate: dueLocalNoon.toISOString(),
      document: docInput.value,
      reminder,
    };
    bills.push(bill);
    saveBills(bills).then(() => {
      if (listEl) renderBills(listEl, bills);
      scheduleBillReminders([bill]);
    });
    form.reset();
  });
}
