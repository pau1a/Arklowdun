// Window helpers for UI without direct dependency on Tauri window API in components
import { getCurrentWindow } from "@tauri-apps/api/window";

export function getWindow() {
  return getCurrentWindow();
}

