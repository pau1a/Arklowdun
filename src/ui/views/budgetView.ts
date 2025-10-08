import { BudgetView } from "../../BudgetView";
import { wrapLegacyView } from "./wrapLegacyView";

export const mountBudgetView = wrapLegacyView(BudgetView);
