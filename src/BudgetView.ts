import { readTextFile, writeTextFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { BudgetCategory, Expense } from "./models";
import { newUuidV7 } from "./db/id";
import { nowMs, toDate } from "./db/time";
import { toMs } from "./db/normalize";
import { defaultHouseholdId } from "./db/household";

interface BudgetData {
  categories: BudgetCategory[];
  expenses: Expense[];
}

const STORE_DIR = "Arklowdun";
const FILE_NAME = "budget.json";
const CSV_FILE = "expenses.csv";

const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "GBP",
});

async function loadData(): Promise<BudgetData> {
  try {
    const p = await join(STORE_DIR, FILE_NAME);
    const json = await readTextFile(p, { baseDir: BaseDirectory.AppLocalData });
    const data = JSON.parse(json) as BudgetData | any;
    let changed = false;
    const hh = await defaultHouseholdId();
    const idMap = new Map<number, string>();
    data.categories = data.categories
      .map((c: any) => {
        if (typeof c.id === "number") {
          const id = newUuidV7();
          idMap.set(c.id, id);
          changed = true;
          c.id = id;
        }
        if ("monthlyBudget" in c) {
          c.monthly_budget = c.monthlyBudget;
          delete c.monthlyBudget;
          changed = true;
        }
        if (!c.created_at) {
          c.created_at = nowMs();
          changed = true;
        }
        if (!c.updated_at) {
          c.updated_at = c.created_at;
          changed = true;
        }
        if (!c.household_id) {
          c.household_id = hh;
          changed = true;
        }
        if (typeof c.position !== 'number') {
          c.position = 0;
          changed = true;
        }
        if ("deletedAt" in c) {
          c.deleted_at = c.deletedAt;
          delete c.deletedAt;
          changed = true;
        }
        return c;
      })
      .filter((c: any) => c.deleted_at == null);
    data.categories.sort((a: any, b: any) => a.position - b.position || a.created_at - b.created_at);
    data.expenses = data.expenses
      .map((e: any) => {
        let id = e.id;
        if (typeof id === "number") {
          id = newUuidV7();
          changed = true;
        }
        if ("categoryId" in e) {
          e.category_id = e.categoryId;
          delete e.categoryId;
          changed = true;
        }
        let catId = e.category_id;
        if (typeof catId === "number") {
          catId = idMap.get(catId) ?? String(catId);
          changed = true;
        }
        let date = e.date;
        const ms = toMs(date);
        if (ms !== undefined) {
          if (ms !== date) changed = true;
          date = ms;
        }
        if (!e.created_at) {
          e.created_at = nowMs();
          changed = true;
        }
        if (!e.updated_at) {
          e.updated_at = e.created_at;
          changed = true;
        }
        if (!e.household_id) {
          e.household_id = hh;
          changed = true;
        }
        if ("deletedAt" in e) {
          e.deleted_at = e.deletedAt;
          delete e.deletedAt;
          changed = true;
        }
        return { ...e, id, category_id: catId, date };
      })
      .filter((e: any) => e.deleted_at == null);
    if (changed) await saveData(data);
    return data as BudgetData;
  } catch {
    return { categories: [], expenses: [] };
  }
}

async function saveData(data: BudgetData): Promise<void> {
  await mkdir(STORE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
  const p = await join(STORE_DIR, FILE_NAME);
  await writeTextFile(p, JSON.stringify(data, null, 2), {
    baseDir: BaseDirectory.AppLocalData,
  });
}

function updateCategoryOptions(sel: HTMLSelectElement, cats: BudgetCategory[]) {
  sel.innerHTML = "";
  cats.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
}

function renderSummary(tbody: HTMLTableSectionElement, data: BudgetData) {
  const now = toDate(nowMs());
  const m = now.getMonth();
  const y = now.getFullYear();
  tbody.innerHTML = "";
  data.categories.forEach((c) => {
    const spent = data.expenses
      .filter((e) => {
        const d = toDate(e.date);
        return e.category_id === c.id && d.getMonth() === m && d.getFullYear() === y;
      })
      .reduce((s, e) => s + e.amount, 0);
    const remaining = c.monthly_budget - spent;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.name}</td>
      <td>${money.format(c.monthly_budget)}</td>
      <td>${money.format(spent)}</td>
      <td>${money.format(remaining)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function csvEscape(s: string) {
  const t = String(s ?? "");
  if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

async function exportCsv(data: BudgetData) {
  const lines = ["date,category,amount,description"];
  data.expenses.forEach((e) => {
    const cat = data.categories.find((c) => c.id === e.category_id);
    const name = cat ? cat.name : "";
    lines.push(
      [toDate(e.date).toISOString(), name, String(e.amount), e.description ?? ""]
        .map(csvEscape)
        .join(",")
    );
  });
  await mkdir(STORE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
  const p = await join(STORE_DIR, CSV_FILE);
  await writeTextFile(p, lines.join("\n"), {
    baseDir: BaseDirectory.AppLocalData,
  });
}

export async function BudgetView(container: HTMLElement) {
  const section = document.createElement("section");
  section.innerHTML = `
    <h2>Budget</h2>
    <form id="category-form">
      <h3>Add Category</h3>
      <input id="cat-name" type="text" placeholder="Category" required />
      <input id="cat-budget" type="number" step="0.01" placeholder="Monthly budget" required />
      <button type="submit">Add Category</button>
    </form>
    <form id="expense-form">
      <h3>Add Expense</h3>
      <select id="exp-category" required></select>
      <input id="exp-amount" type="number" step="0.01" placeholder="Amount" required />
      <input id="exp-date" type="date" required />
      <input id="exp-desc" type="text" placeholder="Description" />
      <button type="submit">Add Expense</button>
    </form>
    <h3>Monthly Summary</h3>
    <table id="budget-table">
      <thead>
        <tr><th>Category</th><th>Budget</th><th>Spent</th><th>Remaining</th></tr>
      </thead>
      <tbody></tbody>
    </table>
    <button id="export-csv">Export CSV</button>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const catForm = section.querySelector<HTMLFormElement>("#category-form");
  const catName = section.querySelector<HTMLInputElement>("#cat-name");
  const catBudget = section.querySelector<HTMLInputElement>("#cat-budget");

  const expForm = section.querySelector<HTMLFormElement>("#expense-form");
  const expCategory = section.querySelector<HTMLSelectElement>("#exp-category");
  const expAmount = section.querySelector<HTMLInputElement>("#exp-amount");
  const expDate = section.querySelector<HTMLInputElement>("#exp-date");
  const expDesc = section.querySelector<HTMLInputElement>("#exp-desc");

  const summaryBody = section.querySelector<HTMLTableSectionElement>("#budget-table tbody");
  const exportBtn = section.querySelector<HTMLButtonElement>("#export-csv");

  const data = await loadData();
  if (expCategory) updateCategoryOptions(expCategory, data.categories);
  if (summaryBody) renderSummary(summaryBody, data);

  catForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!catName || !catBudget || !expCategory || !summaryBody) return;
    const now = nowMs();
    const cat: BudgetCategory = {
      id: newUuidV7(),
      name: catName.value,
      monthly_budget: Number(catBudget.value),
      position: data.categories.length,
      household_id: await defaultHouseholdId(),
      created_at: now,
      updated_at: now,
    };
    data.categories.push(cat);
    saveData(data).then(() => {
      updateCategoryOptions(expCategory, data.categories);
      renderSummary(summaryBody, data);
      catForm.reset();
    });
  });

  expForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!expCategory || !expAmount || !expDate || !summaryBody) return;
    if (!expCategory.value) {
      alert("Please add a category first.");
      return;
    }
    const [y, m, d] = expDate.value.split("-").map(Number);
    const dateLocalNoon = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
    const nowExp = nowMs();
    const exp: Expense = {
      id: newUuidV7(),
      category_id: expCategory.value,
      amount: Number(expAmount.value),
      date: dateLocalNoon.getTime(),
      description: expDesc?.value || "",
      household_id: await defaultHouseholdId(),
      created_at: nowExp,
      updated_at: nowExp,
    };
    data.expenses.push(exp);
    saveData(data).then(() => {
      renderSummary(summaryBody, data);
      expForm.reset();
    });
  });

  exportBtn?.addEventListener("click", () => {
    exportCsv(data);
  });
}

