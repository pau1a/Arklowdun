import { SettingsView } from "../../SettingsView";
import { wrapLegacyView } from "./wrapLegacyView";

export const mountSettingsView = wrapLegacyView(SettingsView);
