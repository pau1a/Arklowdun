import { ShoppingListView } from "../../ShoppingListView";
import { wrapLegacyView } from "./wrapLegacyView";

export const mountShoppingListView = wrapLegacyView(ShoppingListView);
