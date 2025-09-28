// Small helpers to subscribe to window focus/blur without importing in UI/components
export type UnlistenFn = () => void;

export async function onWindowFocus(cb: () => void): Promise<UnlistenFn> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen("tauri://focus", cb);
  return unlisten;
}

export async function onWindowBlur(cb: () => void): Promise<UnlistenFn> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen("tauri://blur", cb);
  return unlisten;
}

