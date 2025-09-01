import { open as openDialog } from "@tauri-apps/plugin-dialog";
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
import type { PropertyDocument } from "./models";
import { newUuidV7 } from "./db/id";

const MAX_TIMEOUT = 2_147_483_647;
function scheduleAt(ts: number, cb: () => void) {
  const delay = ts - Date.now();
  if (delay <= 0) return void cb();
  const chunk = Math.min(delay, MAX_TIMEOUT);
  setTimeout(() => scheduleAt(ts, cb), chunk);
}

// ----- storage -----
const STORE_DIR = "Arklowdun";
const FILE_NAME = "property_documents.json";
async function loadDocuments(): Promise<PropertyDocument[]> {
  try {
    const p = await join(STORE_DIR, FILE_NAME);
    const json = await readTextFile(p, { baseDir: BaseDirectory.AppLocalData });
    return JSON.parse(json) as PropertyDocument[];
  } catch {
    return [];
  }
}
async function saveDocuments(docs: PropertyDocument[]): Promise<void> {
  await mkdir(STORE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
  const p = await join(STORE_DIR, FILE_NAME);
  await writeTextFile(p, JSON.stringify(docs, null, 2), {
    baseDir: BaseDirectory.AppLocalData,
  });
}

function renderDocuments(listEl: HTMLUListElement, docs: PropertyDocument[]) {
  listEl.innerHTML = "";
  docs.forEach((d) => {
    const li = document.createElement("li");
    li.textContent = `${d.description} renews ${new Date(d.renewalDate).toLocaleDateString()} `;
    const btn = document.createElement("button");
    btn.textContent = "Open document";
    btn.addEventListener("click", () => opener.open(d.document));
    li.appendChild(btn);
    listEl.appendChild(li);
  });
}

async function scheduleDocReminders(docs: PropertyDocument[]) {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return;
  const now = Date.now();
  docs.forEach((d) => {
    const dueTs = Date.parse(d.renewalDate);
    if (!d.reminder || isNaN(dueTs)) return;
    if (d.reminder > now) {
      scheduleAt(d.reminder, () => {
        sendNotification({
          title: "Property Renewal",
          body: `${d.description} renews on ${new Date(dueTs).toLocaleDateString()}`,
        });
      });
    } else if (now < dueTs) {
      sendNotification({
        title: "Property Renewal",
        body: `${d.description} renews on ${new Date(dueTs).toLocaleDateString()}`,
      });
    }
  });
}

export async function PropertyView(container: HTMLElement) {
  const section = document.createElement("section");
  section.innerHTML = `
    <h2>Property Documents</h2>
    <ul id="property-list"></ul>
    <form id="property-form">
      <input id="prop-desc" type="text" placeholder="Description" required />
      <input id="prop-due" type="date" required />
      <input id="prop-doc" type="text" placeholder="Document path" required />
      <button id="prop-choose" type="button">Choose File</button>
      <button type="submit">Add Document</button>
    </form>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const listEl = section.querySelector<HTMLUListElement>("#property-list");
  const form = section.querySelector<HTMLFormElement>("#property-form");
  const descInput = section.querySelector<HTMLInputElement>("#prop-desc");
  const dueInput = section.querySelector<HTMLInputElement>("#prop-due");
  const docInput = section.querySelector<HTMLInputElement>("#prop-doc");
  const chooseBtn = section.querySelector<HTMLButtonElement>("#prop-choose");

  let docs: PropertyDocument[] = await loadDocuments();
  let migrated = false;
  docs.forEach((d) => {
    if (typeof d.id === "number") {
      d.id = newUuidV7();
      migrated = true;
    }
  });
  if (migrated) await saveDocuments(docs);
  if (listEl) renderDocuments(listEl, docs);
  await scheduleDocReminders(docs);

  chooseBtn?.addEventListener("click", async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [
        {
          name: "Documents",
          extensions: ["pdf", "doc", "docx", "png", "jpg", "jpeg"],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (!docInput) return;
    if (typeof selected === "string") {
      docInput.value = selected;
    } else if (Array.isArray(selected) && selected[0]) {
      docInput.value = selected[0];
    }
  });

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!descInput || !dueInput || !docInput) return;
    const [y, m, d] = dueInput.value.split("-").map(Number);
    const dueLocalNoon = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
    const dueTs = dueLocalNoon.getTime();
    const reminder = dueTs - 24 * 60 * 60 * 1000; // 1 day before
    const doc: PropertyDocument = {
      id: newUuidV7(),
      description: descInput.value,
      renewalDate: dueLocalNoon.toISOString(),
      document: docInput.value,
      reminder,
    };
    docs.push(doc);
    saveDocuments(docs).then(() => {
      if (listEl) renderDocuments(listEl, docs);
      scheduleDocReminders([doc]);
      form.reset();
    });
  });
}

