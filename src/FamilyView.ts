// src/FamilyView.ts
import { familyStore } from "./features/family/family.store";
import type { FamilyMember } from "./features/family/family.types";
import { getHouseholdIdForCalls } from "./db/household";
import { nowMs, toDate } from "./db/time";
import { logUI } from "./lib/uiLog";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";

type FamilyViewDeps = {
  getHouseholdId?: () => Promise<string>;
  log?: typeof logUI;
};

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

export async function FamilyView(container: HTMLElement, deps?: FamilyViewDeps) {
  runViewCleanups(container);

  const section = document.createElement("section");
  container.innerHTML = "";
  container.appendChild(section);

  const emitLog = deps?.log ?? logUI;
  const resolveHouseholdId = deps?.getHouseholdId ?? getHouseholdIdForCalls;
  const householdId = await resolveHouseholdId();
  await familyStore.load(householdId);

  let members: FamilyMember[] = familyStore.getAll();
  let activeList: HTMLUListElement | null = null;
  let unsubscribed = false;

  const unsubscribe = familyStore.subscribe((state) => {
    if (unsubscribed) return;
    if (state.hydratedHouseholdId !== householdId) return;
    members = familyStore.getAll();
    if (activeList) {
      renderMembers(activeList, members);
    }
  });

  registerViewCleanup(container, () => {
    unsubscribed = true;
    unsubscribe();
  });

  function showList() {
    section.innerHTML = `
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

    activeList = listEl ?? null;
    if (listEl) renderMembers(listEl, members);

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!nameInput || !bdayInput || !listEl) return;

      // Parse YYYY-MM-DD at local noon to avoid TZ shifts
      const [y, m, d] = bdayInput.value.split("-").map(Number);
      const bdayLocalNoon = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);

      const start = performance.now();
      emitLog("DEBUG", "ui.family.create.start", {
        household_id: householdId,
        name: nameInput.value,
      });

      try {
        const created = await familyStore.upsert({
          name: nameInput.value,
          birthday: bdayLocalNoon.getTime(),
          notes: "",
          position: members.length,
        });

        emitLog("INFO", "ui.family.create.success", {
          household_id: householdId,
          member_id: created.id,
          duration_ms: Math.round(performance.now() - start),
        });

        members = familyStore.getAll();
        if (listEl) renderMembers(listEl, members);
        form.reset();
      } catch (error) {
        emitLog("ERROR", "ui.family.create.error", {
          household_id: householdId,
          message: (error as Error)?.message ?? String(error),
        });
        throw error;
      }
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
    activeList = null;
    const current = familyStore.get(member.id) ?? member;
    section.innerHTML = `
      <h2>${current.name}</h2>
      <button id="family-back">Back</button>
      <div style="margin-top:.5rem;">
        <label>Birthday:
          <input id="profile-bday" type="date"
                 value="${
                   current.birthday ? toDate(current.birthday).toISOString().slice(0, 10) : ""
                 }" />
        </label>
      </div>
      <div style="margin-top:.5rem;">
        <textarea id="profile-notes" placeholder="Notes" rows="6" style="width:100%">${
          current.notes ?? ""
        }</textarea>
      </div>
    `;

    const backBtn = section.querySelector<HTMLButtonElement>("#family-back");
    const bdayInput = section.querySelector<HTMLInputElement>("#profile-bday");
    const notesArea = section.querySelector<HTMLTextAreaElement>("#profile-notes");

    backBtn?.addEventListener("click", async () => {
      // Persist any pending changes before returning
      const patch: Partial<FamilyMember> = { id: current.id };
      if (notesArea) patch.notes = notesArea.value;
      if (bdayInput && bdayInput.value) {
        const [y, m, d] = bdayInput.value.split("-").map(Number);
        patch.birthday = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0).getTime();
      }
      patch.updatedAt = nowMs();

      const start = performance.now();
      emitLog("DEBUG", "ui.family.drawer.save.start", { member_id: current.id });
      try {
        await familyStore.upsert(patch);
        emitLog("INFO", "ui.family.drawer.save", {
          member_id: current.id,
          duration_ms: Math.round(performance.now() - start),
        });
      } catch (error) {
        // soft-fail; UI still navigates back
        emitLog("ERROR", "ui.family.drawer.save.error", {
          member_id: current.id,
          message: (error as Error)?.message ?? String(error),
        });
      }

      showList();
    });

    notesArea?.addEventListener("input", async () => {
      const start = performance.now();
      emitLog("DEBUG", "ui.family.drawer.autosave.start", {
        member_id: current.id,
        field: "notes",
      });
      try {
        await familyStore.upsert({
          id: current.id,
          notes: notesArea.value,
          updatedAt: nowMs(),
        });
        emitLog("INFO", "ui.family.drawer.autosave.complete", {
          member_id: current.id,
          field: "notes",
          duration_ms: Math.round(performance.now() - start),
        });
      } catch (error) {
        emitLog("WARN", "ui.family.drawer.autosave.error", {
          member_id: current.id,
          field: "notes",
          message: (error as Error)?.message ?? String(error),
        });
      }
    });

    bdayInput?.addEventListener("change", async () => {
      const [y, m, d] = bdayInput.value.split("-").map(Number);
      const dt = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0).getTime();
      const start = performance.now();
      emitLog("DEBUG", "ui.family.drawer.autosave.start", {
        member_id: current.id,
        field: "birthday",
      });
      try {
        await familyStore.upsert({
          id: current.id,
          birthday: dt,
          updatedAt: nowMs(),
        });
        emitLog("INFO", "ui.family.drawer.autosave.complete", {
          member_id: current.id,
          field: "birthday",
          duration_ms: Math.round(performance.now() - start),
        });
      } catch (error) {
        emitLog("WARN", "ui.family.drawer.autosave.error", {
          member_id: current.id,
          field: "birthday",
          message: (error as Error)?.message ?? String(error),
        });
      }
    });
  }

  showList();
}
