// src/BudgetView.ts
import type { BudgetCategory, Expense } from "./models";
import { defaultHouseholdId } from "./db/household";
import { toDate, nowMs } from "./db/time";
import { budgetCategoriesRepo, expensesRepo } from "./repos";
import { showError } from "./ui/errors";
import { STR } from "./ui/strings";

const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "GBP",
});

// Load everything we need
async function loadAll(householdId: string) {
  const [categories, expenses] = await Promise.all([
    budgetCategoriesRepo.list({ householdId, orderBy: "position, created_at, id" }),
    expensesRepo.list({ householdId, orderBy: "date DESC, created_at DESC, id" }),
  ]);
  return { categories, expenses };
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

function csvEscape(s: string) {
  const t = String(s ?? "");
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

async function renderSummary(
  tbody: HTMLTableSectionElement,
  cats: BudgetCategory[],
  exps: Expense[],
) {
  const now = toDate(nowMs());
  const m = now.getMonth();
  const y = now.getFullYear();

  tbody.innerHTML = "";
  if (cats.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    const { createEmptyState } = await import("./ui/emptyState");
    td.appendChild(
      createEmptyState({
        title: STR.empty.budgetTitle,
        description: STR.empty.budgetDesc,
        actionLabel: "Add category",
        onAction: () =>
          document.querySelector<HTMLInputElement>("#cat-name")?.focus(),
      }),
    );
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  cats.forEach((c) => {
    const spent = exps
      .filter((e) => {
        const d = toDate(e.date);
        return e.category_id === c.id && d.getMonth() === m && d.getFullYear() === y;
      })
      .reduce((s, e) => s + e.amount, 0);

    const remaining = (c.monthly_budget ?? 0) - spent;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.name}</td>
      <td>${money.format(c.monthly_budget ?? 0)}</td>
      <td>${money.format(spent)}</td>
      <td>${money.format(remaining)}</td>
    `;
    tbody.appendChild(tr);
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

    <button id="export-csv" type="button">Export CSV (download)</button>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const householdId = await defaultHouseholdId();

  const catForm = section.querySelector<HTMLFormElement>("#category-form")!;
  const catName = section.querySelector<HTMLInputElement>("#cat-name")!;
  const catBudget = section.querySelector<HTMLInputElement>("#cat-budget")!;

  const expForm = section.querySelector<HTMLFormElement>("#expense-form")!;
  const expCategory = section.querySelector<HTMLSelectElement>("#exp-category")!;
  const expAmount = section.querySelector<HTMLInputElement>("#exp-amount")!;
  const expDate = section.querySelector<HTMLInputElement>("#exp-date")!;
  const expDesc = section.querySelector<HTMLInputElement>("#exp-desc")!;

  const summaryBody = section.querySelector<HTMLTableSectionElement>("#budget-table tbody")!;
  const exportBtn = section.querySelector<HTMLButtonElement>("#export-csv")!;

  let categories: BudgetCategory[] = [];
  let expenses: Expense[] = [];

    async function reloadAndRender() {
      const data = await loadAll(householdId);
      categories = data.categories;
      expenses = data.expenses;
      updateCategoryOptions(expCategory, categories);
      await renderSummary(summaryBody, categories, expenses);
    }

  await reloadAndRender();

  // Add Category
  catForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = catName.value.trim();
    const monthly = Number(catBudget.value);
    if (!name) return;

    await budgetCategoriesRepo.create(householdId, {
      name,
      monthly_budget: monthly,
      position: categories.length,
    } as Partial<BudgetCategory>);

    catForm.reset();
    await reloadAndRender();
  });

  // Add Expense
  expForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!expCategory.value) {
      showError("Please add a category first.");
      return;
    }
    const amt = Number(expAmount.value);
    const [y, m, d] = expDate.value.split("-").map(Number);
    const dateLocalNoon = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0).getTime();

    await expensesRepo.create(householdId, {
      category_id: expCategory.value,
      amount: amt,
      date: dateLocalNoon,
      description: expDesc?.value || "",
    } as Partial<Expense>);

    expForm.reset();
    await reloadAndRender();
  });

  // Export CSV (downloads directly from current lists)
  exportBtn.addEventListener("click", async () => {
    // Make sure we have fresh data
    await reloadAndRender();

    const lines = ["date,category,amount,description"];
    expenses
      .slice() // already newest first by query, order doesn’t matter for CSV
      .reverse() // oldest first when exported
      .forEach((e) => {
        const cat = categories.find((c) => c.id === e.category_id);
        const name = cat ? cat.name : "";
        lines.push(
          [toDate(e.date).toISOString(), name, String(e.amount), e.description ?? ""]
            .map(csvEscape)
            .join(",")
        );
      });

    // Build a Blob and trigger a download
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const yyyyMm = new Date().toISOString().slice(0, 7);
    a.download = `expenses-${yyyyMm}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}
