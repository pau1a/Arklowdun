import {
  RootKey,
  canonicalizeAndVerify as canonicalizeAndVerifyReal,
  rejectSymlinks as rejectSymlinksReal,
  PathError,
} from "./path.ts";
export type { RootKey };
export { PathError };
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
  if (mocks.fs) fsImpl = { ...(fsImpl ?? ({} as FsImpl)), ...mocks.fs } as FsImpl;
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

export async function removeFile(relPath: string, root: RootKey): Promise<void> {
  if (looksAbsolute(relPath)) {
    throw new PathError("OUTSIDE_ROOT", "Path outside allowlisted root");
  }
  const { realPath } = await canonicalizeAndVerifyImpl(relPath, root);
  await rejectSymlinksImpl(realPath, root);
  const fs = await getFs();
  await fs.remove(realPath);
}

export async function exists(relPath: string, root: RootKey): Promise<boolean> {
  if (looksAbsolute(relPath)) {
    throw new PathError("OUTSIDE_ROOT", "Path outside allowlisted root");
  }
  const { realPath } = await canonicalizeAndVerifyImpl(relPath, root);
  await rejectSymlinksImpl(realPath, root);
  const fs = await getFs();
  try {
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

/** Map any PathError to a friendly UI string (for callers’ use). */
export function toUserMessage(e: unknown): string {
  if (e instanceof PathError) return "That location isn’t allowed.";
  if (e instanceof Error) return e.message;
  return String(e);
}
