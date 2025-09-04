// src/FamilyView.ts
import type { FamilyMember } from "./models";
import { familyRepo } from "./repos";
import { defaultHouseholdId } from "./db/household";
import { nowMs, toDate } from "./db/time";

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

  const householdId = await defaultHouseholdId();

  async function load(): Promise<FamilyMember[]> {
    // Order: position then created_at so it’s stable
    return await familyRepo.list({
      householdId,
      orderBy: "position, created_at, id",
    });
  }

  let members: FamilyMember[] = await load();

  async function refresh() {
    members = await load();
  }

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

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!nameInput || !bdayInput || !listEl) return;

      // Parse YYYY-MM-DD at local noon to avoid TZ shifts
      const [y, m, d] = bdayInput.value.split("-").map(Number);
      const bdayLocalNoon = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);

      // Create via repo; backend fills id/created_at/updated_at
      await familyRepo.create(householdId, {
        name: nameInput.value,
        birthday: bdayLocalNoon.getTime(),
        notes: "",
        position: members.length,
      } as Partial<FamilyMember>);

      await refresh();
      if (listEl) renderMembers(listEl, members);
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
      <div style="margin-top:.5rem;">
        <label>Birthday:
          <input id="profile-bday" type="date"
                 value="${member.birthday ? toDate(member.birthday).toISOString().slice(0,10) : ""}" />
        </label>
      </div>
      <div style="margin-top:.5rem;">
        <textarea id="profile-notes" placeholder="Notes" rows="6" style="width:100%">${member.notes ?? ""}</textarea>
      </div>
    `;

    const backBtn = section.querySelector<HTMLButtonElement>("#family-back");
    const bdayInput = section.querySelector<HTMLInputElement>("#profile-bday");
    const notesArea = section.querySelector<HTMLTextAreaElement>("#profile-notes");

    backBtn?.addEventListener("click", async () => {
      // Persist any pending changes before returning
      const patch: Partial<FamilyMember> = {};
      if (notesArea) patch.notes = notesArea.value;
      if (bdayInput && bdayInput.value) {
        const [y, m, d] = bdayInput.value.split("-").map(Number);
        patch.birthday = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0).getTime();
      }
      patch.updated_at = nowMs();

      try {
        await familyRepo.update(householdId, member.id, patch);
      } catch {
        // soft-fail; UI still navigates back
      }

      await refresh();
      showList();
    });

    notesArea?.addEventListener("input", async () => {
      try {
        await familyRepo.update(householdId, member.id, {
          notes: notesArea.value,
          updated_at: nowMs(),
        } as Partial<FamilyMember>);
      } catch {}
    });

    bdayInput?.addEventListener("change", async () => {
      const [y, m, d] = bdayInput.value.split("-").map(Number);
      const dt = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0).getTime();
      try {
        await familyRepo.update(householdId, member.id, {
          birthday: dt,
          updated_at: nowMs(),
        } as Partial<FamilyMember>);
      } catch {}
    });
  }

  showList();
}
