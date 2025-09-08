import { openPath } from "@tauri-apps/plugin-opener";
import { resolvePath, sanitizeRelativePath } from "./files/path";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "./notification";
import type { Policy } from "./models";
import { nowMs, toDate } from "./db/time";
import { defaultHouseholdId } from "./db/household";
import { policiesRepo } from "./repos";
import { showError } from "./ui/errors";

const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "GBP",
});

const MAX_TIMEOUT = 2_147_483_647;
function scheduleAt(ts: number, cb: () => void) {
  const delay = ts - nowMs();
  if (delay <= 0) return void cb();
  const chunk = Math.min(delay, MAX_TIMEOUT);
  setTimeout(() => scheduleAt(ts, cb), chunk);
}

function renderPolicies(listEl: HTMLUListElement, policies: Policy[]) {
  listEl.innerHTML = "";
  policies.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = `${money.format(p.amount / 100)} renews ${toDate(p.due_date).toLocaleDateString()} `;
    const btn = document.createElement("button");
    btn.textContent = "Open document";
    btn.addEventListener("click", async () => {
      try {
        await openPath(await resolvePath(p.root_key, p.relative_path));
      } catch {
        showError(`File location unavailable (root: ${p.root_key})`);
      }
    });
    li.appendChild(btn);
    listEl.appendChild(li);
  });
}

async function schedulePolicyReminders(policies: Policy[]) {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return;
  const now = nowMs();
  policies.forEach((p) => {
    const dueTs = p.due_date;
    if (!p.reminder) return;
    if (p.reminder > now) {
      scheduleAt(p.reminder, () => {
        sendNotification({
          title: "Policy Renewal",
          body: `${money.format(p.amount / 100)} policy renews on ${toDate(dueTs).toLocaleDateString()}`,
        });
      });
    } else if (now < dueTs) {
      sendNotification({
        title: "Policy Renewal",
        body: `${money.format(p.amount / 100)} policy renews on ${toDate(dueTs).toLocaleDateString()}`,
      });
    }
  });
}

export async function InsuranceView(container: HTMLElement) {
  const section = document.createElement("section");
  section.innerHTML = `
    <h2>Insurance</h2>
    <ul id="policy-list"></ul>
    <form id="policy-form">
      <input id="policy-amount" type="number" step="0.01" placeholder="Amount" required />
      <input id="policy-due" type="date" required />
      <input id="policy-doc" type="text" placeholder="Document path" required />
      <button type="submit">Add Policy</button>
    </form>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const listEl = section.querySelector<HTMLUListElement>("#policy-list");
  const form = section.querySelector<HTMLFormElement>("#policy-form");
  const amountInput = section.querySelector<HTMLInputElement>("#policy-amount");
  const dueInput = section.querySelector<HTMLInputElement>("#policy-due");
  const docInput = section.querySelector<HTMLInputElement>("#policy-doc");

  const hh = await defaultHouseholdId();
  let policies: Policy[] = await policiesRepo.list({ householdId: hh });
  if (listEl) renderPolicies(listEl, policies);
  await schedulePolicyReminders(policies);

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!amountInput || !dueInput || !docInput) return;
    const [y, m, d] = dueInput.value.split("-").map(Number);
    const dueLocalNoon = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
    const dueTs = dueLocalNoon.getTime();
    const reminder = dueTs - 24 * 60 * 60 * 1000; // 1 day before
    const policy = await policiesRepo.create(hh, {
      amount: Math.round(parseFloat(amountInput.value) * 100),
      due_date: dueTs,
      root_key: "appData",
      relative_path: sanitizeRelativePath(docInput.value),
      reminder,
      position: policies.length,
    });
    policies.push(policy);
    if (listEl) renderPolicies(listEl, policies);
    schedulePolicyReminders([policy]);
    form.reset();
  });
}
