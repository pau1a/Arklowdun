import type { Vehicle } from "./bindings/Vehicle";
import { fmt } from "./ui/fmt";

export function VehicleDetailView(
  container: HTMLElement,
  vehicle: Vehicle,
  onBack: () => void,
) {
  container.innerHTML = `
    <button id="back">Back</button>
    <h2>${vehicle.name}</h2>
    <p>Make: ${vehicle.make ?? ""}</p>
    <p>Model: ${vehicle.model ?? ""}</p>
    <p>Reg: ${vehicle.reg ?? ""}</p>
    <p>VIN: ${vehicle.vin ?? ""}</p>
    <p>MOT: ${fmt(vehicle.next_mot_due)}</p>
    <p>Service: ${fmt(vehicle.next_service_due)}</p>
    <div>
      <button id="edit">Edit</button>
      <button id="delete">Delete</button>
    </div>
  `;

  container.querySelector<HTMLButtonElement>("#back")?.addEventListener("click", onBack);
}

