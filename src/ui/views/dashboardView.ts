import { DashboardView } from "../../DashboardView";
import { wrapLegacyView } from "./wrapLegacyView";

export const mountDashboardView = wrapLegacyView(DashboardView);
