import { call } from "@lib/ipc/call";
import { presentFsError } from "@lib/ipc";

const isMac = navigator.platform.includes("Mac");
const isWin = navigator.platform.includes("Win");

export function revealLabel() {
  return isMac ? "Reveal in Finder" : isWin ? "Show in Explorer" : "Reveal";
}

export async function openAttachment(table: string, id: string): Promise<boolean> {
  try {
    await call("attachment_open", { table, id });
    return true;
  } catch (e: any) {
    presentFsError(e);
    return false;
  }
}

export async function revealAttachment(table: string, id: string): Promise<boolean> {
  try {
    await call("attachment_reveal", { table, id });
    return true;
  } catch (e: any) {
    if (e?.code === "IO/UNSUPPORTED_REVEAL") {
      presentFsError({
        code: "IO/GENERIC",
        message: "Reveal not supported on this platform.",
      });
    } else {
      presentFsError(e);
    }
    return false;
  }
}
