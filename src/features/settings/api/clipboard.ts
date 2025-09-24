import { writeText } from "@lib/ipc/clipboard";

export function copyText(value: string): Promise<void> {
  return writeText(value);
}
