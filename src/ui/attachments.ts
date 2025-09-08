import { call } from "../db/call";
import { showError } from "./errors";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { resolvePath } from "../files/path";

const isMac = navigator.platform.includes("Mac");
const isWin = navigator.platform.includes("Win");

export function revealLabel() {
  return isMac ? "Reveal in Finder" : isWin ? "Show in Explorer" : "Reveal";
}

export async function openAttachment(table: string, id: string) {
  try {
    await call("attachment_open", { table, id });
  } catch (e: any) {
    showError(e);
  }
}

export async function revealAttachment(
  table: string,
  id: string,
  rootKey?: string,
  relPath?: string,
) {
  try {
    await call("attachment_reveal", { table, id });
  } catch (e: any) {
    if (e?.code === "IO/UNSUPPORTED_REVEAL") {
      try {
        if (!rootKey || !relPath) throw new Error("Path unavailable");
        const abs = await resolvePath(rootKey, relPath);
        await writeText(abs);
        showError({
          code: "INFO",
          message: "Reveal not supported — absolute path copied to clipboard.",
        });
      } catch {
        showError(e);
      }
    } else {
      showError(e);
    }
  }
}
