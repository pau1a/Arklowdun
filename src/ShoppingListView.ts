// src/ShoppingListView.ts
import { defaultHouseholdId } from "./db/household";
import { shoppingRepo } from "./repos";
import type { ShoppingItem } from "./models";
import { showError } from "./ui/errors";
import { STR } from "./ui/strings";

export async function ShoppingListView(container: HTMLElement) {
  const section = document.createElement("section");
  section.innerHTML = `
    <form id="item-form">
      <input id="item-input" type="text" placeholder="New item" required />
      <button type="submit">Add</button>
    </form>
    <ul id="items"></ul>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const form = section.querySelector<HTMLFormElement>("#item-form")!;
  const input = section.querySelector<HTMLInputElement>("#item-input")!;
  const listEl = section.querySelector<HTMLUListElement>("#items")!;

  const hh = await defaultHouseholdId();
  let items: ShoppingItem[] = await shoppingRepo.list({
    householdId: hh,
    orderBy: "position, created_at, id",
  });

  async function render() {
    listEl.innerHTML = "";
    const live = items.filter((i) => !i.deleted_at);
    if (live.length === 0) {
      const wrap = document.createElement("li");
      wrap.className = "list empty";
      const { createEmptyState } = await import("./ui/EmptyState");
      wrap.appendChild(
        createEmptyState({
          title: STR.empty.shoppingTitle,
          body: STR.empty.shoppingDesc,
          cta: {
            kind: "button",
            label: "Add item",
            onClick: () => {
              document
                .querySelector<HTMLFormElement>("#item-form")
                ?.dispatchEvent(new Event("submit"));
            },
          },
        }),
      );
      listEl.appendChild(wrap);
      return;
    }
    for (const item of live) {
      const li = document.createElement("li");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!item.completed;
      cb.addEventListener("change", async () => {
          try {
            item.completed = cb.checked;
            await shoppingRepo.update(
              hh,
              item.id,
              { completed: item.completed } as Partial<ShoppingItem>,
            );
            await render();
        } catch (err) {
          showError(err);
          cb.checked = !cb.checked;
        }
      });

      const span = document.createElement("span");
      span.textContent = item.text;
      if (item.completed) span.style.textDecoration = "line-through";

      const del = document.createElement("button");
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
          try {
            await shoppingRepo.delete(hh, item.id);
            items = items.filter((i) => i.id !== item.id);
            await render();
        } catch (err) {
          showError(err);
        }
      });

      li.appendChild(cb);
      li.appendChild(span);
      li.appendChild(del);
      listEl.appendChild(li);
    }
  }

    await render();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    try {
      const created = await shoppingRepo.create(hh, {
        text,
        completed: false,
        position: items.length,
      } as Partial<ShoppingItem>);
        items.push(created);
        input.value = "";
        await render();
    } catch (err) {
      showError(err);
    }
  });
}
