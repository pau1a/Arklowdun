import { readDir, toUserMessage, PathError } from "../files/safe-fs";
import type { RootKey } from "../files/safe-fs";
export type { RootKey, FsEntry } from "../files/safe-fs";

export { readDir, toUserMessage, PathError };

export const DEFAULT_FILES_ROOT: RootKey = "attachments";
