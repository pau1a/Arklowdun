import { vehiclesRepo } from "./db/vehiclesRepo";
import { getHouseholdIdForCalls } from "./db/household";
import { fmt } from "./ui/fmt";
import { showError } from "./ui/errors";
import { VehicleDetailView } from "./VehicleDetail";
import { STR } from "./ui/strings";

export async function VehiclesView(container: HTMLElement) {
  const hh = await getHouseholdIdForCalls();
  const section = document.createElement("section");
  container.innerHTML = "";
  container.appendChild(section);

  async function renderList() {
      try {
        const vehicles = await vehiclesRepo.list(hh);
        section.innerHTML = `<ul id="veh-list"></ul>`;
        const listEl = section.querySelector<HTMLUListElement>("#veh-list");
        if (!vehicles.length) {
          const li = document.createElement("li");
          const { createEmptyState } = await import("./ui/EmptyState");
          li.appendChild(
            createEmptyState({
              title: STR.empty.vehiclesTitle,
              body: STR.empty.vehiclesDesc,
            }),
          );
          listEl?.appendChild(li);
          return;
        }
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
