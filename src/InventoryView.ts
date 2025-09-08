// src/InventoryView.ts
import { sanitizeRelativePath } from "./files/path";
import { isPermissionGranted, requestPermission, sendNotification } from "./notification";
import type { InventoryItem } from "./models";
import { defaultHouseholdId } from "./db/household";
import { nowMs, toDate } from "./db/time";
import { inventoryRepo } from "./repos";
import { STR } from "./ui/strings";
import { openAttachment, revealAttachment, revealLabel } from "./ui/attachments";

const MAX_TIMEOUT = 2_147_483_647; // ~24.8 days
function scheduleAt(ts: number, cb: () => void) {
  const delay = ts - nowMs();
  if (delay <= 0) return void cb();
  const chunk = Math.min(delay, MAX_TIMEOUT);
  setTimeout(() => scheduleAt(ts, cb), chunk);
}

async function renderInventory(listEl: HTMLUListElement, items: InventoryItem[]) {
  listEl.innerHTML = "";
  if (items.length === 0) {
    const li = document.createElement("li");
    const { createEmptyState } = await import("./ui/emptyState");
    li.appendChild(
      createEmptyState({
        title: STR.empty.inventoryTitle,
        description: STR.empty.inventoryDesc,
        actionLabel: "Add item",
        onAction: () =>
          document
            .querySelector<HTMLAnchorElement>("#nav-inventory")
            ?.click(),
        icon: "📦",
      }),
    );
    listEl.appendChild(li);
    return;
  }
  items.forEach((it) => {
    const li = document.createElement("li");
    const pd = toDate(it.purchase_date).toLocaleDateString();
    const wx = it.warranty_expiry
      ? toDate(it.warranty_expiry).toLocaleDateString()
      : "—";
    li.textContent = `${it.name} (purchased ${pd}, warranty expires ${wx}) `;
    if (it.relative_path) {
      const openBtn = document.createElement("button");
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", () =>
        openAttachment("inventory_items", String(it.id)),
      );
      li.appendChild(openBtn);

      const revealBtn = document.createElement("button");
      revealBtn.textContent = revealLabel();
      revealBtn.addEventListener("click", () =>
        revealAttachment("inventory_items", String(it.id), it.root_key, it.relative_path!),
      );
      li.appendChild(revealBtn);
    }
    listEl.appendChild(li);
  });
}

async function scheduleInventoryReminders(items: InventoryItem[]) {
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) return;

  const now = nowMs();
  items.forEach((it) => {
    const dueTs = it.warranty_expiry;
    if (!it.reminder || !dueTs) return;

    if (it.reminder > now) {
      scheduleAt(it.reminder, () => {
        sendNotification({
          title: "Warranty Reminder",
          body: `${it.name} warranty expires on ${toDate(dueTs).toLocaleDateString()}`,
        });
      });
    } else if (now < dueTs) {
      // catch-up if app was closed at reminder time
      sendNotification({
        title: "Warranty Reminder",
        body: `${it.name} warranty expires on ${toDate(dueTs).toLocaleDateString()}`,
      });
    }
  });
}

export async function InventoryView(container: HTMLElement) {
  const section = document.createElement("section");
  section.innerHTML = `
    <h2>Inventory</h2>
    <ul id="inv-list"></ul>
    <form id="inv-form" style="margin-top:1rem;">
      <input id="inv-name" type="text" placeholder="Item name" required />
      <label>Purchased: <input id="inv-purchase" type="date" required /></label>
      <label>Warranty expires: <input id="inv-warranty" type="date" /></label>
      <input id="inv-doc" type="text" placeholder="Document path (receipt/manual)" />
      <button type="submit">Add Item</button>
    </form>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const listEl = section.querySelector<HTMLUListElement>("#inv-list")!;
  const form = section.querySelector<HTMLFormElement>("#inv-form")!;
  const nameInput = section.querySelector<HTMLInputElement>("#inv-name")!;
  const purchaseInput = section.querySelector<HTMLInputElement>("#inv-purchase")!;
  const warrantyInput = section.querySelector<HTMLInputElement>("#inv-warranty")!;
  const docInput = section.querySelector<HTMLInputElement>("#inv-doc")!;

  const hh = await defaultHouseholdId();
  let items: InventoryItem[] = await inventoryRepo.list({ householdId: hh });
  await renderInventory(listEl, items);
  await scheduleInventoryReminders(items);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // parse YYYY-MM-DD at local noon
    const [py, pm, pd] = purchaseInput.value.split("-").map(Number);
    const purchaseTs = new Date(py, (pm ?? 1) - 1, pd ?? 1, 12, 0, 0, 0).getTime();

    let warrantyTs: number | undefined = undefined;
    if (warrantyInput.value) {
      const [wy, wm, wd] = warrantyInput.value.split("-").map(Number);
      warrantyTs = new Date(wy, (wm ?? 1) - 1, wd ?? 1, 12, 0, 0, 0).getTime();
    }

    const reminder = warrantyTs ? warrantyTs - 7 * 24 * 60 * 60 * 1000 : undefined;

    const created = await inventoryRepo.create(hh, {
      name: nameInput.value,
      purchase_date: purchaseTs,
      warranty_expiry: warrantyTs,
      root_key: "appData",
      relative_path: sanitizeRelativePath(docInput.value || ""),
      reminder,
      position: items.length,
    });

    items.push(created);
    await renderInventory(listEl, items);
    await scheduleInventoryReminders([created]);
    form.reset();
  });
}
