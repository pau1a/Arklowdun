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
import type { Policy } from "./models";

let nextId = 1;

const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "GBP",
});

const MAX_TIMEOUT = 2_147_483_647;
function scheduleAt(ts: number, cb: () => void) {
  const delay = ts - Date.now();
  if (delay <= 0) return void cb();
  const chunk = Math.min(delay, MAX_TIMEOUT);
  setTimeout(() => scheduleAt(ts, cb), chunk);
}

// ----- storage -----
const STORE_DIR = "Arklowdun";
const FILE_NAME = "policies.json";
async function loadPolicies(): Promise<Policy[]> {
  try {
    const p = await join(STORE_DIR, FILE_NAME);
    const json = await readTextFile(p, { baseDir: BaseDirectory.AppLocalData });
    return JSON.parse(json) as Policy[];
  } catch {
    return [];
  }
}
async function savePolicies(policies: Policy[]): Promise<void> {
  await mkdir(STORE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
  const p = await join(STORE_DIR, FILE_NAME);
  await writeTextFile(p, JSON.stringify(policies, null, 2), { baseDir: BaseDirectory.AppLocalData });
}

function renderPolicies(listEl: HTMLUListElement, policies: Policy[]) {
  listEl.innerHTML = "";
  policies.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = `${money.format(p.amount)} renews ${new Date(p.dueDate).toLocaleDateString()} `;
    const btn = document.createElement("button");
    btn.textContent = "Open document";
    btn.addEventListener("click", () => opener.open(p.document));
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
  const now = Date.now();
  policies.forEach((p) => {
    const dueTs = Date.parse(p.dueDate);
    if (!p.reminder || isNaN(dueTs)) return;
    if (p.reminder > now) {
      scheduleAt(p.reminder, () => {
        sendNotification({
          title: "Policy Renewal",
          body: `${money.format(p.amount)} policy renews on ${new Date(dueTs).toLocaleDateString()}`,
        });
      });
    } else if (now < dueTs) {
      sendNotification({
        title: "Policy Renewal",
        body: `${money.format(p.amount)} policy renews on ${new Date(dueTs).toLocaleDateString()}`,
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

  let policies: Policy[] = await loadPolicies();
  if (listEl) renderPolicies(listEl, policies);
  await schedulePolicyReminders(policies);
  nextId = policies.reduce((m, p) => Math.max(m, p.id), 0) + 1;

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!amountInput || !dueInput || !docInput) return;
    const [y, m, d] = dueInput.value.split("-").map(Number);
    const dueLocalNoon = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
    const dueTs = dueLocalNoon.getTime();
    const reminder = dueTs - 24 * 60 * 60 * 1000; // 1 day before
    const policy: Policy = {
      id: nextId++,
      amount: parseFloat(amountInput.value),
      dueDate: dueLocalNoon.toISOString(),
      document: docInput.value,
      reminder,
    };
    policies.push(policy);
    savePolicies(policies).then(() => {
      if (listEl) renderPolicies(listEl, policies);
      schedulePolicyReminders([policy]);
      form.reset();
    });
  });
}
