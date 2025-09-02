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
import type { InventoryItem } from "./models";
import { newUuidV7 } from "./db/id";
import { nowMs, toDate } from "./db/time";
import { defaultHouseholdId } from "./db/household";
import { toMs } from "./db/normalize";

const MAX_TIMEOUT = 2_147_483_647;
function scheduleAt(ts: number, cb: () => void) {
  const delay = ts - nowMs();
  if (delay <= 0) return void cb();
  const chunk = Math.min(delay, MAX_TIMEOUT);
  setTimeout(() => scheduleAt(ts, cb), chunk);
}

const STORE_DIR = "Arklowdun";
const FILE_NAME = "inventory.json";
async function loadItems(): Promise<InventoryItem[]> {
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
      if ("purchaseDate" in i) {
        const ms = toMs(i.purchaseDate);
        if (ms !== undefined) {
          i.purchase_date = ms;
          changed = true;
        }
        delete i.purchaseDate;
      }
      if ("warrantyExpiry" in i) {
        const ms = toMs(i.warrantyExpiry);
        if (ms !== undefined) {
          i.warranty_expiry = ms;
          changed = true;
        }
        delete i.warrantyExpiry;
      }
      for (const k of ["purchase_date", "warranty_expiry", "reminder"]) {
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
      return i;
    });
    arr = arr.filter((i: any) => i.deleted_at == null);
    if (changed) await saveItems(arr as InventoryItem[]);
    return arr as InventoryItem[];
  } catch (e) {
    console.error("loadItems failed:", e);
    return [];
  }
}
async function saveItems(items: InventoryItem[]): Promise<void> {
  await mkdir(STORE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
  const p = await join(STORE_DIR, FILE_NAME);
  await writeTextFile(p, JSON.stringify(items, null, 2), {
    baseDir: BaseDirectory.AppLocalData,
  });
}

function renderItems(listEl: HTMLUListElement, items: InventoryItem[]) {
  listEl.innerHTML = "";
  items.forEach((i) => {
    const li = document.createElement("li");
    li.textContent = `${i.name} warranty expires ${toDate(i.warranty_expiry).toLocaleDateString()} `;
    const btn = document.createElement("button");
    btn.textContent = "Open document";
    btn.addEventListener("click", () => openPath(i.document));
    li.appendChild(btn);
    listEl.appendChild(li);
  });
}

async function scheduleWarrantyReminders(items: InventoryItem[]) {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return;
  const now = nowMs();
  items.forEach((i) => {
    const expTs = i.warranty_expiry;
    if (!i.reminder) return;
    if (i.reminder > now) {
      scheduleAt(i.reminder, () => {
        sendNotification({
          title: "Warranty Expiry",
          body: `${i.name} warranty expires on ${toDate(expTs).toLocaleDateString()}`,
        });
      });
    } else if (now < expTs) {
      sendNotification({
        title: "Warranty Expiry",
        body: `${i.name} warranty expires on ${toDate(expTs).toLocaleDateString()}`,
      });
    }
  });
}

export async function InventoryView(container: HTMLElement) {
  const section = document.createElement("section");
  section.innerHTML = `
    <h2>Inventory</h2>
    <ul id="inventory-list"></ul>
    <form id="inventory-form">
      <input id="inv-name" type="text" placeholder="Item name" required />
      <input id="inv-purchase" type="date" required />
      <input id="inv-warranty" type="date" required />
      <input id="inv-doc" type="text" placeholder="Document path" required />
      <button type="submit">Add Item</button>
    </form>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const listEl = section.querySelector<HTMLUListElement>("#inventory-list");
  const form = section.querySelector<HTMLFormElement>("#inventory-form");
  const nameInput = section.querySelector<HTMLInputElement>("#inv-name");
  const purchaseInput = section.querySelector<HTMLInputElement>("#inv-purchase");
  const warrantyInput = section.querySelector<HTMLInputElement>("#inv-warranty");
  const docInput = section.querySelector<HTMLInputElement>("#inv-doc");

  let items: InventoryItem[] = await loadItems();
  if (listEl) renderItems(listEl, items);
  await scheduleWarrantyReminders(items);

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!nameInput || !purchaseInput || !warrantyInput || !docInput) return;
    const [py, pm, pd] = purchaseInput.value.split("-").map(Number);
    const purchaseLocalNoon = new Date(py, (pm ?? 1) - 1, pd ?? 1, 12, 0, 0, 0);
    const [wy, wm, wd] = warrantyInput.value.split("-").map(Number);
    const warrantyLocalNoon = new Date(wy, (wm ?? 1) - 1, wd ?? 1, 12, 0, 0, 0);
    const expTs = warrantyLocalNoon.getTime();
    const reminder = expTs - 24 * 60 * 60 * 1000;
    const now = nowMs();
    const item: InventoryItem = {
      id: newUuidV7(),
      name: nameInput.value,
      purchase_date: purchaseLocalNoon.getTime(),
      warranty_expiry: warrantyLocalNoon.getTime(),
      document: docInput.value,
      reminder,
      household_id: await defaultHouseholdId(),
      created_at: now,
      updated_at: now,
    };
    items.push(item);
    saveItems(items).then(() => {
      if (listEl) renderItems(listEl, items);
      scheduleWarrantyReminders([item]);
      form.reset();
    });
  });
}
