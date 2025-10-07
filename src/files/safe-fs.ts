import {
  canonicalizeAndVerify as canonicalizeAndVerifyReal,
  rejectSymlinks as rejectSymlinksReal,
  PathError,
  type RootKey,
} from "./path";
export type { RootKey };
export { PathError };
/* eslint-disable no-restricted-imports */
import type * as fsTypes from "@tauri-apps/plugin-fs";
export type FsEntry = fsTypes.DirEntry;

interface FsImpl {
  readTextFile: typeof fsTypes.readTextFile;
  writeTextFile: typeof fsTypes.writeTextFile;
  readDir: typeof fsTypes.readDir;
  mkdir: typeof fsTypes.mkdir;
  remove: typeof fsTypes.remove;
  lstat: typeof fsTypes.lstat;
}

let fsImpl: FsImpl | null = null;

async function getFs(): Promise<FsImpl> {
  if (!fsImpl) {
    const mod = await import("@tauri-apps/plugin-fs");
    fsImpl = {
      readTextFile: mod.readTextFile,
      writeTextFile: mod.writeTextFile,
      readDir: mod.readDir,
      mkdir: mod.mkdir,
      remove: mod.remove,
      lstat: mod.lstat,
    };
  }
  return fsImpl;
}

let canonicalizeAndVerifyImpl = canonicalizeAndVerifyReal;
let rejectSymlinksImpl = rejectSymlinksReal;

/** @internal test hook */
export function __setMocks(mocks: {
  fs?: Partial<FsImpl>;
  canonicalizeAndVerify?: typeof canonicalizeAndVerifyReal;
  rejectSymlinks?: typeof rejectSymlinksReal;
}) {
  if (mocks.fs) fsImpl = { ...fsImpl, ...mocks.fs } as FsImpl;
  if (mocks.canonicalizeAndVerify) canonicalizeAndVerifyImpl = mocks.canonicalizeAndVerify;
  if (mocks.rejectSymlinks) rejectSymlinksImpl = mocks.rejectSymlinks;
}

const looksAbsolute = (p: string): boolean => {
  const norm = p.replace(/\\/g, "/");
  return /^(?:[A-Za-z]:|\\\\|\/)/.test(norm);
};

export async function readText(relPath: string, root: RootKey): Promise<string> {
  if (looksAbsolute(relPath)) {
    throw new PathError("OUTSIDE_ROOT", "Path outside allowlisted root");
  }
  const { realPath } = await canonicalizeAndVerifyImpl(relPath, root);
  await rejectSymlinksImpl(realPath, root);
  const fs = await getFs();
  return fs.readTextFile(realPath);
}

export async function writeText(
  relPath: string,
  root: RootKey,
  data: string,
): Promise<void> {
  if (looksAbsolute(relPath)) {
    throw new PathError("OUTSIDE_ROOT", "Path outside allowlisted root");
  }
  const { realPath } = await canonicalizeAndVerifyImpl(relPath, root);
  await rejectSymlinksImpl(realPath, root);
  const fs = await getFs();
  await fs.writeTextFile(realPath, data);
}

export async function readDir(
  relPath: string,
  root: RootKey,
): Promise<FsEntry[]> {
  if (looksAbsolute(relPath)) {
    throw new PathError("OUTSIDE_ROOT", "Path outside allowlisted root");
  }
  const { realPath } = await canonicalizeAndVerifyImpl(relPath, root);
  await rejectSymlinksImpl(realPath, root);
  const fs = await getFs();
  return fs.readDir(realPath);
}

export async function mkdir(
  relPath: string,
  root: RootKey,
  opts?: { recursive?: boolean },
): Promise<void> {
  if (looksAbsolute(relPath)) {
    throw new PathError("OUTSIDE_ROOT", "Path outside allowlisted root");
  }
  const { realPath } = await canonicalizeAndVerifyImpl(relPath, root);
  await rejectSymlinksImpl(realPath, root);
  const fs = await getFs();
  await fs.mkdir(realPath, { recursive: opts?.recursive });
}

export async function remove(
  relPath: string,
  root: RootKey,
  opts?: { recursive?: boolean },
): Promise<void> {
  if (looksAbsolute(relPath)) {
    throw new PathError("OUTSIDE_ROOT", "Path outside allowlisted root");
  }
  const { realPath } = await canonicalizeAndVerifyImpl(relPath, root);
  await rejectSymlinksImpl(realPath, root);
  const fs = await getFs();
  await fs.remove(realPath, { recursive: !!opts?.recursive });
}

export async function exists(relPath: string, root: RootKey): Promise<boolean> {
  if (looksAbsolute(relPath)) {
    throw new PathError("OUTSIDE_ROOT", "Path outside allowlisted root");
  }
  const { realPath } = await canonicalizeAndVerifyImpl(relPath, root);
  await rejectSymlinksImpl(realPath, root);
  try {
    const fs = await getFs();
    await fs.lstat(realPath);
    return true;
  } catch (e: any) {
    const msg = (e?.message || "").toLowerCase();
    if (e?.code === "ENOENT" || msg.includes("not found") || msg.includes("no such file")) {
      return false;
    }
    throw e;
  }
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  FILE_MISSING: "The source file is missing from the vault.",
  FILE_EXISTS: "A file already exists at the destination.",
  DIRECTORY_MOVE_UNSUPPORTED: "Moving directories is not supported yet.",
  COPY_VERIFICATION_FAILED:
    "The copied file could not be verified. Check the vault before retrying.",
  FILE_MOVE_IN_PROGRESS: "Another move for this attachment is already running.",
  FILE_MOVE_LOCK_FAILED: "Unable to coordinate the move. Please try again.",
  REPAIR_ACTIONS_REQUIRED: "Provide at least one repair action before applying.",
  REPAIR_TABLE_UNSUPPORTED:
    "One of the repair actions references an unsupported table.",
  REPAIR_ROW_MISSING: "The targeted attachment row no longer exists.",
  REPAIR_MANIFEST_MISSING:
    "The manifest entry could not be found. Run another scan to refresh it.",
  REPAIR_RELINK_CATEGORY_REQUIRED:
    "Relink actions must include the destination category.",
  REPAIR_RELINK_RELATIVE_REQUIRED:
    "Relink actions must include the new relative path.",
  REPAIR_RELINK_TARGET_MISSING:
    "The relink target file could not be found in the vault.",
  REPAIR_RELINK_TARGET_INVALID: "The relink target must be a file.",
} as const;

/** Map any PathError/AppError to a friendly UI string (for callers’ use). */
export function toUserMessage(e: unknown): string {
  if (e instanceof PathError) return "That location isn’t allowed.";

  const candidate = e as { code?: unknown; message?: unknown } | undefined;
  const code = typeof candidate?.code === "string" ? candidate.code : undefined;
  if (code) {
    if (Object.prototype.hasOwnProperty.call(ERROR_CODE_MESSAGES, code)) {
      return ERROR_CODE_MESSAGES[code];
    }
    if (code.startsWith("REPAIR_")) {
      return "Attachment repair failed. Review the manifest for details.";
    }
  }

  const message =
    typeof candidate?.message === "string" ? candidate.message.trim() : undefined;
  if (message) {
    return message;
  }

  if (e instanceof Error) return e.message;
  return String(e);
}
