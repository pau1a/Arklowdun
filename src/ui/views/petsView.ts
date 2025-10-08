import { PetsView } from "../../PetsView";
import { wrapLegacyView } from "./wrapLegacyView";

export const mountPetsView = wrapLegacyView(PetsView);
