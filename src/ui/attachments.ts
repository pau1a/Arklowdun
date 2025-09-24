import { call } from "@lib/ipc/call";
import { canonicalizeAndVerify, rejectSymlinks, PathError, RootKey } from "../files/path";
import { presentFsError } from "@lib/ipc";

const isMac = navigator.platform.includes("Mac");
const isWin = navigator.platform.includes("Win");

export function revealLabel() {
  return isMac ? "Reveal in Finder" : isWin ? "Show in Explorer" : "Reveal";
}

export async function openAttachment(table: string, id: string) {
  try {
    await call("attachment_open", { table, id });
  } catch (e: any) {
    presentFsError(e);
  }
}

export async function revealAttachment(
  table: string,
  id: string,
  rootKey?: RootKey | string,
  relPath?: string,
) {
  const rk: RootKey | undefined =
    typeof rootKey === "string"
      ? (["appData", "attachments"].includes(rootKey)
          ? (rootKey as RootKey)
          : undefined)
      : rootKey;
  try {
    await call("attachment_reveal", { table, id });
  } catch (e: any) {
    if (e?.code === "IO/UNSUPPORTED_REVEAL") {
      try {
        if (!rk || !relPath) throw new Error("Path unavailable");
        const { realPath } = await canonicalizeAndVerify(relPath, rk);
        await rejectSymlinks(realPath, rk);
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
          presentFsError({
            code: "IO/GENERIC",
            message: "Reveal not supported; path copied to clipboard.",
          });
        } else {
          presentFsError({
            code: "IO/GENERIC",
            message: "Reveal not supported.",
          });
        }
      } catch (err: any) {
        if (err instanceof PathError) {
          presentFsError({ code: "NOT_ALLOWED", message: err.message });
        } else {
          presentFsError(err);
        }
      }
    } else {
      presentFsError(e);
    }
  }
}
