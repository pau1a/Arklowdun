import { readTextFile, writeTextFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { BudgetCategory, Expense } from "./models";

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

let nextCatId = 1;
let nextExpId = 1;

async function loadData(): Promise<BudgetData> {
  try {
    const p = await join(STORE_DIR, FILE_NAME);
    const json = await readTextFile(p, { baseDir: BaseDirectory.AppLocalData });
    return JSON.parse(json) as BudgetData;
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
  const now = new Date();
  const m = now.getMonth();
  const y = now.getFullYear();
  tbody.innerHTML = "";
  data.categories.forEach((c) => {
    const spent = data.expenses
      .filter((e) => {
        const d = new Date(e.date);
        return e.categoryId === c.id && d.getMonth() === m && d.getFullYear() === y;
      })
      .reduce((s, e) => s + e.amount, 0);
    const remaining = c.monthlyBudget - spent;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.name}</td>
      <td>${money.format(c.monthlyBudget)}</td>
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
    const cat = data.categories.find((c) => c.id === e.categoryId);
    const name = cat ? cat.name : "";
    lines.push(
      [e.date, name, String(e.amount), e.description ?? ""]
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
  nextCatId = data.categories.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  nextExpId = data.expenses.reduce((m, e) => Math.max(m, e.id), 0) + 1;
  if (expCategory) updateCategoryOptions(expCategory, data.categories);
  if (summaryBody) renderSummary(summaryBody, data);

  catForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!catName || !catBudget || !expCategory || !summaryBody) return;
    const cat: BudgetCategory = {
      id: nextCatId++,
      name: catName.value,
      monthlyBudget: Number(catBudget.value),
    };
    data.categories.push(cat);
    saveData(data).then(() => {
      updateCategoryOptions(expCategory, data.categories);
      renderSummary(summaryBody, data);
      catForm.reset();
    });
  });

  expForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!expCategory || !expAmount || !expDate || !summaryBody) return;
    if (!expCategory.value) {
      alert("Please add a category first.");
      return;
    }
    const [y, m, d] = expDate.value.split("-").map(Number);
    const dateLocalNoon = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
    const exp: Expense = {
      id: nextExpId++,
      categoryId: Number(expCategory.value),
      amount: Number(expAmount.value),
      date: dateLocalNoon.toISOString(),
      description: expDesc?.value || "",
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

