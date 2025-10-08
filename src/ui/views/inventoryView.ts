import { InventoryView } from "../../InventoryView";
import { wrapLegacyView } from "./wrapLegacyView";

export const mountInventoryView = wrapLegacyView(InventoryView);
