export interface SettingsPanelInstance {
  element: HTMLElement;
}

export function SettingsPanel(): SettingsPanelInstance {
  const element = document.createElement("section");
  element.className = "settings";
  return { element };
}

export default SettingsPanel;
