import {
  appCacheDir,
  appConfigDir,
  appDataDir,
  appLocalDataDir,
  audioDir,
  cacheDir,
  configDir,
  dataDir,
  desktopDir,
  documentDir,
  downloadDir,
  fontDir,
  homeDir,
  join,
  localDataDir,
  pictureDir,
  publicDir,
  resourceDir,
  runtimeDir,
  tempDir,
  templateDir,
  videoDir,
} from "@tauri-apps/api/path";

const ROOTS: Record<string, () => Promise<string>> = {
  appCache: appCacheDir,
  appConfig: appConfigDir,
  appData: appDataDir,
  appLocalData: appLocalDataDir,
  audio: audioDir,
  cache: cacheDir,
  config: configDir,
  data: dataDir,
  desktop: desktopDir,
  document: documentDir,
  download: downloadDir,
  font: fontDir,
  home: homeDir,
  localData: localDataDir,
  picture: pictureDir,
  public: publicDir,
  resource: resourceDir,
  runtime: runtimeDir,
  temp: tempDir,
  template: templateDir,
  video: videoDir,
};

export function sanitizeRelativePath(p: string): string {
  // Normalize separators and drop any leading slashes or UNC prefixes
  // ("/" or "//server/share" -> "server/share").
  let norm = p.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts: string[] = [];
  for (const raw of norm.split("/")) {
    const seg = raw.trim();
    if (!seg || seg === ".") continue;
    // Drop Windows drive prefixes like "C:"
    if (parts.length === 0 && /^[A-Za-z]:$/.test(seg)) continue;
    if (seg === "..") {
      if (parts.length) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

export async function resolvePath(rootKey: string, relativePath: string): Promise<string> {
  const root = ROOTS[rootKey];
  if (!root) throw new Error(`Unknown root key: ${rootKey}`);
  const base = await root();
  return join(base, sanitizeRelativePath(relativePath));
}

