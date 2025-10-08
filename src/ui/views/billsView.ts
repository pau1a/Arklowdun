import { BillsView } from "../../BillsView";
import { wrapLegacyView } from "./wrapLegacyView";

export const mountBillsView = wrapLegacyView(BillsView);
