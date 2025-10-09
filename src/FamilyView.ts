// src/FamilyView.ts
import type { FamilyMember } from "./models";
import { familyRepo } from "./repos";
import { getHouseholdIdForCalls } from "./db/household";
import { nowMs, toDate } from "./db/time";
import { logUI } from "./lib/uiLog";

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
  const section = document.createElement("section");
  container.innerHTML = "";
  container.appendChild(section);

  const emitLog = deps?.log ?? logUI;
  const resolveHouseholdId = deps?.getHouseholdId ?? getHouseholdIdForCalls;
  const householdId = await resolveHouseholdId();

  async function load(): Promise<FamilyMember[]> {
    const start = performance.now();
    emitLog("DEBUG", "ui.family.list.load.start", { household_id: householdId });
    try {
      // Order: position then created_at so it’s stable
      const members = await familyRepo.list({
        householdId,
        orderBy: "position, created_at, id",
      });
      emitLog("INFO", "ui.family.list.load.complete", {
        household_id: householdId,
        count: members.length,
        duration_ms: Math.round(performance.now() - start),
      });
      return members;
    } catch (error) {
      emitLog("ERROR", "ui.family.list.load.error", {
        household_id: householdId,
        message: (error as Error)?.message ?? String(error),
      });
      throw error;
    }
  }

  let members: FamilyMember[] = await load();

  async function refresh() {
    members = await load();
  }

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
        // Create via repo; backend fills id/created_at/updated_at
        const created = await familyRepo.create(householdId, {
          name: nameInput.value,
          birthday: bdayLocalNoon.getTime(),
          notes: "",
          position: members.length,
        } as Partial<FamilyMember>);

        emitLog("INFO", "ui.family.create.success", {
          household_id: householdId,
          member_id: created.id,
          duration_ms: Math.round(performance.now() - start),
        });

        await refresh();
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

      const start = performance.now();
      emitLog("DEBUG", "ui.family.drawer.save.start", { member_id: member.id });
      try {
        await familyRepo.update(householdId, member.id, patch);
        emitLog("INFO", "ui.family.drawer.save", {
          member_id: member.id,
          duration_ms: Math.round(performance.now() - start),
        });
      } catch (error) {
        // soft-fail; UI still navigates back
        emitLog("ERROR", "ui.family.drawer.save.error", {
          member_id: member.id,
          message: (error as Error)?.message ?? String(error),
        });
      }

      await refresh();
      showList();
    });

    notesArea?.addEventListener("input", async () => {
      const start = performance.now();
      emitLog("DEBUG", "ui.family.drawer.autosave.start", {
        member_id: member.id,
        field: "notes",
      });
      try {
        await familyRepo.update(householdId, member.id, {
          notes: notesArea.value,
          updated_at: nowMs(),
        } as Partial<FamilyMember>);
        emitLog("INFO", "ui.family.drawer.autosave.complete", {
          member_id: member.id,
          field: "notes",
          duration_ms: Math.round(performance.now() - start),
        });
      } catch (error) {
        emitLog("WARN", "ui.family.drawer.autosave.error", {
          member_id: member.id,
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
        member_id: member.id,
        field: "birthday",
      });
      try {
        await familyRepo.update(householdId, member.id, {
          birthday: dt,
          updated_at: nowMs(),
        } as Partial<FamilyMember>);
        emitLog("INFO", "ui.family.drawer.autosave.complete", {
          member_id: member.id,
          field: "birthday",
          duration_ms: Math.round(performance.now() - start),
        });
      } catch (error) {
        emitLog("WARN", "ui.family.drawer.autosave.error", {
          member_id: member.id,
          field: "birthday",
          message: (error as Error)?.message ?? String(error),
        });
      }
    });
  }

  showList();
}
