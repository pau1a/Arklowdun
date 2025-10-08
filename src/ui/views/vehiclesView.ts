import { VehiclesView } from "../../VehiclesView";
import { wrapLegacyView } from "./wrapLegacyView";

export const mountVehiclesView = wrapLegacyView(VehiclesView);
