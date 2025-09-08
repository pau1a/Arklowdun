import { vehiclesRepo } from "./db/vehiclesRepo";
import { defaultHouseholdId } from "./db/household";
import { fmt } from "./ui/fmt";
import { showError } from "./ui/errors";
import { VehicleDetailView } from "./VehicleDetail";

export async function VehiclesView(container: HTMLElement) {
  const hh = await defaultHouseholdId();
  const section = document.createElement("section");
  container.innerHTML = "";
  container.appendChild(section);

  async function renderList() {
    try {
      const vehicles = await vehiclesRepo.list(hh);
      section.innerHTML = `<h2>Vehicles</h2><ul id="veh-list"></ul>`;
      const listEl = section.querySelector<HTMLUListElement>("#veh-list");
      vehicles.forEach((v) => {
        const li = document.createElement("li");
        li.innerHTML = `
        <span class="veh-name">${v.name}</span>
        <span class="badge">MOT: ${fmt(v.next_mot_due)}</span>
        <span class="badge">Service: ${fmt(v.next_service_due)}</span>
        <button data-id="${v.id}">Open</button>`;
        listEl?.appendChild(li);
      });

      listEl?.addEventListener("click", async (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
        if (!btn) return;
        try {
          const vehicle = await vehiclesRepo.get(btn.dataset.id!, hh);
          if (!vehicle) {
            showError("Vehicle not found");
            return;
          }
          VehicleDetailView(section, vehicle, () => {
            renderList();
          });
        } catch (err) {
          showError(err);
        }
      });
    } catch (err) {
      showError(err);
    }
  }

  await renderList();
}

