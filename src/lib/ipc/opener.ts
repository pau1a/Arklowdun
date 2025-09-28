// Wrapper around @tauri-apps/plugin-opener for use outside components/UI
export async function revealPath(path: string): Promise<boolean> {
  try {
    const mod = await import("@tauri-apps/plugin-opener");
    const open = (mod as any)?.open as undefined | ((p: string) => Promise<void>);
    if (typeof open === "function") {
      await open(path);
      return true;
    }
  } catch {
    // fall through to false
  }
  return false;
}

