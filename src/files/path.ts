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
import { sanitizeRelativePath } from "./sanitize.ts";

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

export { sanitizeRelativePath };

export async function resolvePath(rootKey: string, relativePath: string): Promise<string> {
  const root = ROOTS[rootKey];
  if (!root) throw new Error(`Unknown root key: ${rootKey}`);
  const base = await root();
  return join(base, sanitizeRelativePath(relativePath));
}

