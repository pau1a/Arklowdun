import { sanitizeRelativePath } from "./files/path";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "./notification";
import type { Bill } from "./models";
import { nowMs, toDate } from "./db/time";
import { defaultHouseholdId } from "./db/household";
import { billsRepo } from "./repos";
import { STR } from "./ui/strings";
import { openAttachment, revealAttachment, revealLabel } from "./ui/attachments";

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

async function renderBills(listEl: HTMLUListElement, bills: Bill[]) {
  listEl.innerHTML = "";
  if (bills.length === 0) {
    const li = document.createElement("li");
    const { createEmptyState } = await import("./ui/EmptyState");
    li.appendChild(
      createEmptyState({
        title: STR.empty.billsTitle,
        body: STR.empty.billsDesc,
        cta: {
          kind: "button",
          label: "Add bill",
          onClick: () => {
            document
              .querySelector<HTMLInputElement>("#bill-amount")
              ?.focus();
          },
        },
      }),
    );
    listEl.appendChild(li);
    return;
  }
  bills.forEach((b) => {
    const li = document.createElement("li");
    li.textContent = `${money.format(b.amount / 100)} due ${toDate(b.due_date).toLocaleDateString()} `;
    if (b.relative_path) {
      const openBtn = document.createElement("button");
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", () =>
        openAttachment("bills", String(b.id)),
      );
      li.appendChild(openBtn);

      const revealBtn = document.createElement("button");
      revealBtn.textContent = revealLabel();
      revealBtn.addEventListener("click", () =>
        revealAttachment("bills", String(b.id), b.root_key, b.relative_path),
      );
      li.appendChild(revealBtn);
    }

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
          body: `${money.format(b.amount / 100)} due on ${toDate(dueTs).toLocaleDateString()}`,
        });
      });
    } else if (now < dueTs) {
      // catch-up if the app was closed at reminder time
      sendNotification({
        title: "Bill Due",
        body: `${money.format(b.amount / 100)} due on ${toDate(dueTs).toLocaleDateString()}`,
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

  const hh = await defaultHouseholdId();
  let bills: Bill[] = await billsRepo.list({ householdId: hh });
  if (listEl) await renderBills(listEl, bills);
  await scheduleBillReminders(bills);

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!amountInput || !dueInput || !docInput) return;
    // parse YYYY-MM-DD safely: store due at local noon to avoid UTC date shifts
    const [y, m, d] = dueInput.value.split("-").map(Number);
    const dueLocalNoon = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
    const dueTs = dueLocalNoon.getTime();
    const reminder = dueTs - 24 * 60 * 60 * 1000; // 1 day before
    const bill = await billsRepo.create(hh, {
      amount: Math.round(parseFloat(amountInput.value) * 100),
      due_date: dueTs,
      root_key: "appData",
      relative_path: sanitizeRelativePath(docInput.value),
      reminder,
      position: bills.length,
    });
      bills.push(bill);
      if (listEl) await renderBills(listEl, bills);
      scheduleBillReminders([bill]);
    form.reset();
  });
}
