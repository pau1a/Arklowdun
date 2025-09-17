declare module "@tauri-apps/plugin-clipboard-manager" {
  export function writeText(text: string): Promise<void>;
}
