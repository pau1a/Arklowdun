import { readTextFile, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { newUuidV7 } from "./db/id";

interface ShoppingItem {
  id: string;
  text: string;
  completed: boolean;
  deleted_at?: number;
}

const FILE = "shopping-list.json";

async function loadItems(): Promise<ShoppingItem[]> {
  try {
    const content = await readTextFile(FILE, {
      baseDir: BaseDirectory.AppLocalData,
    });
    const items = JSON.parse(content) as ShoppingItem[] | any[];
    let changed = false;
    const fixed = items.map((i) => {
      let item: any = i;
      if (typeof item.id === "number") {
        item = { ...item, id: newUuidV7() };
        changed = true;
      }
      if ("deletedAt" in item) {
        item.deleted_at = (item as any).deletedAt;
        delete (item as any).deletedAt;
        changed = true;
      }
      return item;
    });
    if (changed) await saveItems(fixed);
    return fixed as ShoppingItem[];
  } catch {
    return [];
  }
}

async function saveItems(items: ShoppingItem[]): Promise<void> {
  await writeTextFile(FILE, JSON.stringify(items), {
    baseDir: BaseDirectory.AppLocalData,
  });
}

export async function ShoppingListView(container: HTMLElement) {
  const section = document.createElement("section");
  section.innerHTML = `
    <h2>Shopping List</h2>
    <form id="item-form">
      <input id="item-input" type="text" placeholder="New item" required />
      <button type="submit">Add</button>
    </form>
    <ul id="items"></ul>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const form = section.querySelector<HTMLFormElement>("#item-form");
  const input = section.querySelector<HTMLInputElement>("#item-input");
  const listEl = section.querySelector<HTMLUListElement>("#items");

  let items = await loadItems();

  const render = () => {
    if (!listEl) return;
    listEl.innerHTML = "";
    const liveItems = items.filter((i) => !i.deleted_at);
    if (liveItems.length === 0) {
      const empty = document.createElement("li");
      empty.className = "list empty";
      empty.textContent = "No items";
      listEl.appendChild(empty);
      return;
    }
    for (const item of liveItems) {
      const li = document.createElement("li");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = item.completed;
      cb.addEventListener("change", async () => {
        item.completed = cb.checked;
        await saveItems(items);
        render();
      });
      const span = document.createElement("span");
      span.textContent = item.text;
      if (item.completed) span.style.textDecoration = "line-through";
      const del = document.createElement("button");
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
        item.deleted_at = Date.now();
        await saveItems(items);
        render();
      });
      li.appendChild(cb);
      li.appendChild(span);
      li.appendChild(del);
      listEl.appendChild(li);
    }
  };

  render();

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    const id = newUuidV7();
    items.push({ id, text, completed: false });
    await saveItems(items);
    input.value = "";
    render();
  });
}

