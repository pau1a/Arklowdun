import { ManageView } from "../../ManageView";
import { wrapLegacyView } from "./wrapLegacyView";

export const mountManageView = wrapLegacyView(ManageView);
