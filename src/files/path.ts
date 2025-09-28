export { sanitizeRelativePath } from "./sanitize";

let appDataDirImpl: (() => Promise<string>) | undefined;
let lstatImpl: ((path: string) => Promise<any>) | undefined;
type JoinFn = (...parts: string[]) => string | Promise<string>;
const defaultJoin: JoinFn = (...parts: string[]) => parts.join("/");
let joinImpl: JoinFn = defaultJoin;

async function ensureLoaded() {
  if (!appDataDirImpl || joinImpl === defaultJoin) {
    try {
      const pathMod = await import("@tauri-apps/api/path");
      appDataDirImpl = appDataDirImpl ?? pathMod.appDataDir;
      if (joinImpl === defaultJoin) joinImpl = pathMod.join as JoinFn;
    } catch {
      appDataDirImpl = appDataDirImpl ?? (async () => {
        throw new Error("appDataDir unavailable");
      });
    }
  }
  if (!lstatImpl) {
    try {
      /* eslint-disable no-restricted-imports */
      const fsmod = await import("@tauri-apps/plugin-fs");
      lstatImpl = fsmod.lstat;
    } catch {
      lstatImpl = async () => ({ isSymbolicLink: false });
    }
  }
}

export type RootKey = "appData" | "attachments";

export interface CanonResult {
  input: string;
  rootKey: RootKey;
  base: string;
  realPath: string;
}

export class PathError extends Error {
  code:
    | "OUTSIDE_ROOT"
    | "DOT_DOT_REJECTED"
    | "UNC_REJECTED"
    | "CROSS_VOLUME"
    | "SYMLINK"
    | "INVALID";
  details?: unknown;
  constructor(code: PathError["code"], message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/** @internal test hook */
export function __setMocks(mocks: {
  appDataDir?: () => Promise<string>;
  join?: JoinFn;
  lstat?: (path: string) => Promise<any>;
}) {
  if (mocks.appDataDir) appDataDirImpl = mocks.appDataDir;
  if (mocks.join) joinImpl = mocks.join;
  if (mocks.lstat) lstatImpl = mocks.lstat;
}

const norm = (s: string): string => {
  const replaced = s.replace(/\\/g, "/").replace(/\/+/g, "/");
  let prefix = "";
  let rest = replaced;
  if (rest.startsWith("//")) {
    prefix = "//";
    rest = rest.slice(2);
  } else {
    const drive = rest.match(/^[A-Za-z]:/);
    if (drive) {
      prefix = drive[0];
      rest = rest.slice(drive[0].length);
      if (rest.startsWith("/")) rest = rest.slice(1);
    } else if (rest.startsWith("/")) {
      prefix = "/";
      rest = rest.slice(1);
    }
  }
  const parts = rest.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") stack.pop();
      else stack.push("..");
    } else {
      stack.push(part);
    }
  }
  const joined = stack.join("/");
  return prefix + joined;
};

const driveOf = (p: string): string | null => {
  const m = p.match(/^[A-Za-z]:/);
  return m ? m[0].toLowerCase() : null;
};

async function getBase(rootKey: RootKey): Promise<string> {
  await ensureLoaded();
  let base = norm(await (appDataDirImpl as () => Promise<string>)());
  if (rootKey === "attachments") {
    base = norm(await joinImpl(base, "attachments"));
  }
  if (!base.endsWith("/")) base += "/";
  return base;
}

export async function canonicalizeAndVerify(
  path: string,
  rootKey: RootKey,
): Promise<CanonResult> {
  const raw = path;
  if (/^\\\\/.test(raw) || /^\/\/[^/]/.test(raw.replace(/\\/g, "/"))) {
    throw new PathError("UNC_REJECTED", "UNC paths not allowed");
  }
  const inputNorm = norm(path);
  if (inputNorm.split("/").includes("..")) {
    throw new PathError("DOT_DOT_REJECTED", "Parent traversal not allowed");
  }

  const base = await getBase(rootKey);
  let candidate = inputNorm;

  const isAbs = /^([A-Za-z]:|\/)/.test(candidate);
  if (isAbs) {
    const baseDrive = driveOf(base);
    const pathDrive = driveOf(candidate);
    if (pathDrive && baseDrive && pathDrive !== baseDrive) {
      throw new PathError("CROSS_VOLUME", "Cross-volume path not allowed");
    }
  } else {
    candidate = norm(await joinImpl(base, candidate));
  }

  if (!candidate.startsWith(base)) {
    throw new PathError("OUTSIDE_ROOT", "Path outside allowlisted root");
  }

  return { input: path, rootKey, base, realPath: candidate };
}

export async function rejectSymlinks(
  realPath: string,
  rootKey: RootKey,
): Promise<void> {
  await ensureLoaded();
  const base = await getBase(rootKey);
  const pathNorm = norm(realPath);
  if (!pathNorm.startsWith(base)) {
    throw new PathError("OUTSIDE_ROOT", "Path outside allowlisted root");
  }
  const rel = pathNorm.slice(base.length).split("/").filter(Boolean);
  let current = base.slice(0, -1);
  for (const seg of rel) {
    current = norm(await joinImpl(current, seg));
    try {
      const info: any = await (lstatImpl as (path: string) => Promise<any>)(current);
      const isSymlink = !!(
        info?.isSymbolicLink ||
        info?.is_symlink ||
        info?.fileType === "symlink" ||
        info?.kind === "symlink" ||
        (typeof info?.isSymbolicLink === "function" && info.isSymbolicLink())
      );
      if (isSymlink) {
        throw new PathError("SYMLINK", "Symlink not allowed", { path: current });
      }
    } catch (e) {
      if (e instanceof PathError) throw e;
      break;
    }
  }
}
