// src/PetDetailView.ts
import { sanitizeRelativePath } from "./files/path";
import type { Pet, PetMedicalRecord } from "./models";
import { petMedicalRepo, petsRepo } from "./repos";
import { defaultHouseholdId } from "./db/household";
import { showError } from "./ui/errors";

export async function PetDetailView(
  container: HTMLElement,
  pet: Pet,
  onChange: () => Promise<void> | void,
  onBack: () => void
) {
  const hh = await defaultHouseholdId();

  async function loadMedical(): Promise<PetMedicalRecord[]> {
    // List all medical records for this pet, newest first
    const all = await petMedicalRepo.list({
      householdId: hh,
      orderBy: "date DESC, created_at DESC, id",
    });
    return all.filter((m) => m.pet_id === pet.id);
  }

  async function render() {
    const medical = await loadMedical();

    container.innerHTML = `
      <button id="back-btn">← Back</button>
      <h2>Pet: ${pet.name}</h2>
      <p>Type: ${pet.type}</p>

      <h3>Medical records</h3>
      <ul id="med-list">
        ${medical
          .map(
            (m) => `
          <li data-id="${m.id}">
            ${new Date(m.date).toLocaleDateString()} — ${m.description}
            ${m.reminder ? `(reminds ${new Date(m.reminder).toLocaleDateString()})` : ""}
            ${m.relative_path ? '<button class="open-doc">Open doc</button>' : ""}
            <button class="delete-med">Delete</button>
          </li>
        `
          )
          .join("")}
      </ul>

      <h4>Add medical record</h4>
      <form id="med-form">
        <input id="med-date" type="date" required />
        <input id="med-desc" type="text" placeholder="Description" required />
        <input id="med-doc" type="text" placeholder="Document path (optional)" />
        <label style="display:block;margin-top:.5rem;">
          Reminder (optional):
          <input id="med-rem" type="date" />
        </label>
        <button type="submit">Add</button>
      </form>
    `;

    const backBtn = container.querySelector<HTMLButtonElement>("#back-btn");
    backBtn?.addEventListener("click", () => onBack());

    // Open document handler (lazy import opener & resolver)
    container.querySelectorAll<HTMLButtonElement>("button.open-doc").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const li = btn.closest("li[data-id]");
        if (!li) return;
        const id = li.getAttribute("data-id")!;
        const m = medical.find((x) => x.id === id);
        if (!m) return;
        try {
          const { openPath } = await import("@tauri-apps/plugin-opener");
          const { resolvePath } = await import("./files/path");
          await openPath(await resolvePath(m.root_key, m.relative_path));
        } catch {
          showError("File location unavailable");
        }
      });
    });

    // Delete medical record
    container.querySelectorAll<HTMLButtonElement>("button.delete-med").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const li = btn.closest("li[data-id]");
        if (!li) return;
        const id = li.getAttribute("data-id")!;
        try {
          await petMedicalRepo.delete(hh, id);
          await onChange?.();
          await render();
        } catch (err) {
          console.error("pet_medical delete failed:", err);
          showError(err);
        }
      });
    });

    // Add medical record
    const form = container.querySelector<HTMLFormElement>("#med-form");
    const dateInput = container.querySelector<HTMLInputElement>("#med-date");
    const descInput = container.querySelector<HTMLInputElement>("#med-desc");
    const docInput = container.querySelector<HTMLInputElement>("#med-doc");
    const remInput = container.querySelector<HTMLInputElement>("#med-rem");

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!dateInput || !descInput) return;

      // Parse YYYY-MM-DD at local noon to avoid TZ shifts
      const [y, m, d] = dateInput.value.split("-").map(Number);
      const dateLocalNoon = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0).getTime();

      let reminderTs: number | undefined;
      if (remInput?.value) {
        const [ry, rm, rd] = remInput.value.split("-").map(Number);
        reminderTs = new Date(ry, (rm ?? 1) - 1, rd ?? 1, 12, 0, 0, 0).getTime();
      }

      // Only include file fields if user actually provided a path
      const rel = docInput?.value?.trim()
        ? sanitizeRelativePath(docInput.value.trim())
        : undefined;

      try {
        await petMedicalRepo.create(hh, {
          pet_id: pet.id,
          date: dateLocalNoon,
          description: descInput.value,
          ...(rel ? { root_key: "appData", relative_path: rel } : {}),
          reminder: reminderTs,
        });

        // Nudge pet.updated_at so lists/ordering stay fresh
        await petsRepo.update(hh, pet.id, { updated_at: Date.now() } as Partial<Pet>);

        await onChange?.();
        await render();
      } catch (err) {
        console.error("pet_medical create failed:", err);
        showError(err);
      }
    });
  }

  await render();
}
