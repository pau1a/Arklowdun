import { open } from "@lib/ipc/dialog";
import type { OpenDialogOptions } from "@lib/ipc/dialog";

export function openDirectoryDialog(
  options?: Omit<OpenDialogOptions, "directory" | "multiple">,
): Promise<string | string[] | null> {
  return open({
    directory: true,
    multiple: false,
    ...(options ?? {}),
  });
}
