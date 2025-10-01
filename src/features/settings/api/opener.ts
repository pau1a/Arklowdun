import { revealPath } from "@lib/ipc/opener";

export async function openPath(path: string): Promise<boolean> {
  return revealPath(path);
}

