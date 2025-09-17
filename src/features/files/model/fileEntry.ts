export type FileKind = "file" | "directory";

export interface FileEntry {
  id: string;
  name: string;
  path: string;
  kind: FileKind;
}
