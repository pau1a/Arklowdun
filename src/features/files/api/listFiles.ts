import { DEFAULT_FILES_ROOT, readDir, toUserMessage } from "@lib/filesystem";
import type { RootKey } from "@lib/filesystem";
import type { FileEntry } from "@features/files/model/fileEntry";

const joinPath = (directory: string, name: string): string =>
  directory === "." ? name : `${directory}/${name}`;

export interface ListFilesParams {
  directory?: string;
  root?: RootKey;
}

export async function listFiles(
  params: ListFilesParams = {},
): Promise<FileEntry[]> {
  const directory = params.directory ?? ".";
  const root = params.root ?? DEFAULT_FILES_ROOT;
  const rawEntries = await readDir(directory, root);

  return rawEntries
    .map((entry): FileEntry => ({
      id: joinPath(directory, entry.name ?? ""),
      name: entry.name ?? "(unknown)",
      path: joinPath(directory, entry.name ?? ""),
      kind: entry.isDirectory ? "directory" : "file",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function toFilesListError(error: unknown): string {
  return toUserMessage(error);
}
