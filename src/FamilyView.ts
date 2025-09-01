import { readTextFile, writeTextFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { FamilyMember } from "./models";
import { newUuidV7 } from "./db/id";

// ----- storage -----
const STORE_DIR = "Arklowdun";
const FILE_NAME = "family.json";
async function loadMembers(): Promise<FamilyMember[]> {
  try {
    const p = await join(STORE_DIR, FILE_NAME);
    const json = await readTextFile(p, { baseDir: BaseDirectory.AppLocalData });
    return JSON.parse(json) as FamilyMember[];
  } catch {
    return [];
  }
}
async function saveMembers(members: FamilyMember[]): Promise<void> {
  await mkdir(STORE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
  const p = await join(STORE_DIR, FILE_NAME);
  await writeTextFile(p, JSON.stringify(members, null, 2), {
    baseDir: BaseDirectory.AppLocalData,
  });
}

function renderMembers(listEl: HTMLUListElement, members: FamilyMember[]) {
  listEl.innerHTML = "";
  members.forEach((m) => {
    const li = document.createElement("li");
    li.textContent = `${m.name} `;
    const btn = document.createElement("button");
    btn.textContent = "Open";
    btn.dataset.id = m.id;
    li.appendChild(btn);
    listEl.appendChild(li);
  });
}

export async function FamilyView(container: HTMLElement) {
  const section = document.createElement("section");
  container.innerHTML = "";
  container.appendChild(section);

  let members: FamilyMember[] = await loadMembers();
  let migrated = false;
  members.forEach((m) => {
    if (typeof m.id === "number") {
      m.id = newUuidV7();
      migrated = true;
    }
  });
  if (migrated) await saveMembers(members);

  function showList() {
    section.innerHTML = `
      <h2>Family Members</h2>
      <ul id="family-list"></ul>
      <form id="family-form">
        <input id="family-name" type="text" placeholder="Name" required />
        <input id="family-bday" type="date" required />
        <button type="submit">Add Member</button>
      </form>
    `;
    const listEl = section.querySelector<HTMLUListElement>("#family-list");
    const form = section.querySelector<HTMLFormElement>("#family-form");
    const nameInput = section.querySelector<HTMLInputElement>("#family-name");
    const bdayInput = section.querySelector<HTMLInputElement>("#family-bday");

    if (listEl) renderMembers(listEl, members);

    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!nameInput || !bdayInput || !listEl) return;
      const [y, m, d] = bdayInput.value.split("-").map(Number);
      const bday = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
      const member: FamilyMember = {
        id: newUuidV7(),
        name: nameInput.value,
        birthday: bday.toISOString(),
        notes: "",
        documents: [],
      };
      members.push(member);
      saveMembers(members).then(() => {
        renderMembers(listEl, members);
      });
      form.reset();
    });

    listEl?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
      if (!btn) return;
      const id = btn.dataset.id!;
      const member = members.find((m) => m.id === id);
      if (member) showProfile(member);
    });
  }

  function showProfile(member: FamilyMember) {
    section.innerHTML = `
      <h2>${member.name}</h2>
      <button id="family-back">Back</button>
      <div>
        <label>Birthday: <input id="profile-bday" type="date" value="${member.birthday ? new Date(member.birthday).toISOString().slice(0,10) : ""}" /></label>
      </div>
      <div>
        <textarea id="profile-notes" placeholder="Notes">${member.notes ?? ""}</textarea>
      </div>
      <div>
        <h3>Documents</h3>
        <ul id="doc-list"></ul>
        <input id="doc-input" type="text" placeholder="Document path" />
        <button id="doc-add">Add Document</button>
      </div>
    `;
    const backBtn = section.querySelector<HTMLButtonElement>("#family-back");
    const bdayInput = section.querySelector<HTMLInputElement>("#profile-bday");
    const notesArea = section.querySelector<HTMLTextAreaElement>("#profile-notes");
    const docList = section.querySelector<HTMLUListElement>("#doc-list");
    const docInput = section.querySelector<HTMLInputElement>("#doc-input");
    const docAddBtn = section.querySelector<HTMLButtonElement>("#doc-add");

    function renderDocs() {
      if (!docList) return;
      docList.innerHTML = "";
      member.documents.forEach((d, idx) => {
        const li = document.createElement("li");
        li.textContent = d + " ";
        const rm = document.createElement("button");
        rm.textContent = "Remove";
        rm.dataset.idx = String(idx);
        li.appendChild(rm);
        docList.appendChild(li);
      });
    }
    renderDocs();

    backBtn?.addEventListener("click", () => {
      if (notesArea) member.notes = notesArea.value;
      if (bdayInput && bdayInput.value) {
        const [y, m, d] = bdayInput.value.split("-").map(Number);
        const dt = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
        member.birthday = dt.toISOString();
      }
      saveMembers(members).then(() => showList());
    });

    notesArea?.addEventListener("change", () => {
      member.notes = notesArea.value;
      saveMembers(members);
    });

    bdayInput?.addEventListener("change", () => {
      const [y, m, d] = bdayInput.value.split("-").map(Number);
      const dt = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
      member.birthday = dt.toISOString();
      saveMembers(members);
    });

    docAddBtn?.addEventListener("click", () => {
      if (!docInput || !docInput.value) return;
      member.documents.push(docInput.value);
      docInput.value = "";
      saveMembers(members).then(renderDocs);
    });

    docList?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-idx]");
      if (!btn) return;
      const idx = Number(btn.dataset.idx);
      member.documents.splice(idx, 1);
      saveMembers(members).then(renderDocs);
    });
  }

  showList();
}
