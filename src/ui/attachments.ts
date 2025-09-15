import { call } from "../db/call";
import { showError } from "./errors";
import { canonicalizeAndVerify, rejectSymlinks, PathError, RootKey } from "../files/path";

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
  rootKey?: RootKey,
  relPath?: string,
) {
  try {
    await call("attachment_reveal", { table, id });
  } catch (e: any) {
    if (e?.code === "IO/UNSUPPORTED_REVEAL") {
      try {
        if (!rootKey || !relPath) throw new Error("Path unavailable");
        const { realPath } = await canonicalizeAndVerify(relPath, rootKey);
        await rejectSymlinks(realPath, rootKey);
        // Try web clipboard first; if it fails, fall back to showing the path.
        let copied = false;
        try {
          // navigator.clipboard can throw or be unavailable depending on permissions
          // in some environments.
          // optional chaining guards against missing APIs
          await navigator?.clipboard?.writeText?.(realPath);
          copied = true;
        } catch {
          copied = false;
        }
        if (copied) {
          showError({
            code: "INFO",
            message: "Reveal not supported — absolute path copied to clipboard.",
          });
        } else {
          showError(`Reveal not supported — path: ${realPath}`);
        }
      } catch (err: any) {
        if (err instanceof PathError) {
          showError({ code: "INFO", message: "That location isn't allowed" });
        } else {
          showError(err);
        }
      }
    } else {
      showError(e);
    }
  }
}
