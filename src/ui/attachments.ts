import { call } from "@lib/ipc/call";
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

export async function revealAttachment(table: string, id: string) {
  try {
    await call("attachment_reveal", { table, id });
  } catch (e: any) {
    if (e?.code === "IO/UNSUPPORTED_REVEAL") {
      presentFsError({
        code: "IO/GENERIC",
        message: "Reveal not supported on this platform.",
      });
    } else {
      presentFsError(e);
    }
  }
}
