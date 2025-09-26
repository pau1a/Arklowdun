import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve
} from "node:path";

interface AssetManifest {
  assets: AssetEntry[];
}

interface AssetEntry {
  id: string;
  name: string;
  category: string;
  attribution: { statements: string[] };
  artifacts?: AssetArtifact[];
  consumers?: AssetConsumer[];
}

interface AssetArtifact {
  path: string;
  type?: string;
}

interface AssetConsumer {
  file: string;
  type?: string;
  specifier?: string;
}

async function main() {
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const manifestPath = join(
    projectRoot,
    "assets",
    "licensing",
    "attribution.json"
  );
  const manifest = await loadManifest(manifestPath);

  const issues: string[] = [];

  const manifestArtifacts = new Map<string, AssetEntry>();
  for (const asset of manifest.assets) {
    for (const artifact of asset.artifacts ?? []) {
      manifestArtifacts.set(normalizePath(artifact.path), asset);
    }
  }

  const manifestImportConsumers = new Map<string, AssetEntry>();
  const consumerFiles = new Set<string>();
  for (const asset of manifest.assets) {
    for (const consumer of asset.consumers ?? []) {
      consumerFiles.add(normalizePath(consumer.file));
      if (consumer.type === "import" && consumer.specifier) {
        const key = `${normalizePath(consumer.file)}::${consumer.specifier}`;
        manifestImportConsumers.set(key, asset);
      }
    }
  }

  const fontDir = join(projectRoot, "src", "assets", "fonts");
  const actualFontFiles = await collectFiles(fontDir, projectRoot, isFontFile);
  for (const fontFile of actualFontFiles) {
    if (!manifestArtifacts.has(fontFile)) {
      issues.push(
        `Missing manifest entry for font asset ${fontFile}. Update assets/licensing/attribution.json.`
      );
    }
  }

  const iconRoots = [
    join(projectRoot, "src", "assets", "icons"),
    join(projectRoot, "src", "assets", "vendor"),
  ];

  for (const iconDir of iconRoots) {
    const iconFiles = await collectFiles(iconDir, projectRoot, isIconFile);
    for (const iconFile of iconFiles) {
      if (!manifestArtifacts.has(iconFile)) {
        issues.push(
          `Missing manifest entry for icon asset ${iconFile}. Update assets/licensing/attribution.json.`
        );
      }
    }
  }

  for (const [artifactPath, asset] of manifestArtifacts) {
    const abs = join(projectRoot, artifactPath);
    if (!(await exists(abs))) {
      issues.push(
        `Manifest lists ${artifactPath} for ${asset.name}, but the file was not found.`
      );
    }
  }

  for (const filePath of consumerFiles) {
    const abs = join(projectRoot, filePath);
    if (!(await exists(abs))) {
      issues.push(`Manifest references ${filePath}, but the file was not found.`);
    }
  }

  const sourceImportMap = await scanSourceImports(join(projectRoot, "src"), projectRoot);
  for (const [filePath, specs] of sourceImportMap) {
    for (const specifier of specs) {
      const key = `${filePath}::${specifier}`;
      if (!manifestImportConsumers.has(key)) {
        issues.push(
          `Import of ${specifier} in ${filePath} is missing from the attribution manifest.`
        );
      }
    }
  }

  const stylesheetFontReferences = await scanStylesheetFontReferences(
    join(projectRoot, "src"),
    projectRoot
  );

  for (const [filePath, assetPaths] of stylesheetFontReferences) {
    for (const assetPath of assetPaths) {
      if (!manifestArtifacts.has(assetPath)) {
        issues.push(
          `Stylesheet ${filePath} references ${assetPath}, but the attribution manifest is missing this asset.`
        );
      }
    }
  }

  const iconReferences = await scanIconAssetReferences(
    join(projectRoot, "src"),
    projectRoot
  );

  for (const [filePath, assetPaths] of iconReferences) {
    for (const assetPath of assetPaths) {
      if (!manifestArtifacts.has(assetPath)) {
        issues.push(
          `Source file ${filePath} references icon asset ${assetPath}, but the attribution manifest is missing this asset.`
        );
      }
    }
  }

  for (const [key, asset] of manifestImportConsumers) {
    const [file, specifier] = key.split("::");
    const specs = sourceImportMap.get(file);
    if (!specs) {
      issues.push(
        `Manifest lists ${specifier} in ${file} for ${asset.name}, but the import was not found.`
      );
      continue;
    }
    if (!specs.has(specifier)) {
      issues.push(
        `Manifest lists ${specifier} in ${file} for ${asset.name}, but the import was not found.`
      );
    }
  }

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(issue);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Asset attribution manifest is in sync with bundled assets.");
}

async function loadManifest(path: string): Promise<AssetManifest> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as AssetManifest;
  if (!parsed || !Array.isArray(parsed.assets)) {
    throw new Error(`Invalid attribution manifest at ${path}`);
  }
  return parsed;
}

async function collectFiles(
  dir: string,
  projectRoot: string,
  predicate: (name: string) => boolean
): Promise<string[]> {
  const relativePaths: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await collectFiles(entryPath, projectRoot, predicate);
        relativePaths.push(...nested);
      } else if (predicate(entry.name)) {
        relativePaths.push(normalizePath(relative(projectRoot, entryPath)));
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  return relativePaths;
}

async function scanSourceImports(
  directory: string,
  projectRoot: string
): Promise<Map<string, Set<string>>> {
  const imports = new Map<string, Set<string>>();
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await scanSourceImports(entryPath, projectRoot);
      for (const [file, specs] of nested) {
        const existing = imports.get(file);
        if (existing) {
          specs.forEach((spec) => existing.add(spec));
        } else {
          imports.set(file, new Set(specs));
        }
      }
    } else if (isCodeFile(entry.name)) {
      const relativePath = normalizePath(relative(projectRoot, entryPath));
      const content = await readFile(entryPath, "utf8");
      const specs = findRelevantSpecifiers(content);
      if (specs.size > 0) {
        imports.set(relativePath, specs);
      }
    }
  }
  return imports;
}

async function scanStylesheetFontReferences(
  directory: string,
  projectRoot: string
): Promise<Map<string, Set<string>>> {
  const references = new Map<string, Set<string>>();
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return references;
    }
    throw error;
  }

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await scanStylesheetFontReferences(entryPath, projectRoot);
      for (const [file, assets] of nested) {
        const existing = references.get(file);
        if (existing) {
          assets.forEach((asset) => existing.add(asset));
        } else {
          references.set(file, new Set(assets));
        }
      }
    } else if (isStylesheetFile(entry.name)) {
      const relativePath = normalizePath(relative(projectRoot, entryPath));
      const content = await readFile(entryPath, "utf8");
      const assets = extractFontUrlsFromStylesheet(content, entryPath, projectRoot);
      if (assets.size > 0) {
        references.set(relativePath, assets);
      }
    }
  }

  return references;
}

function findRelevantSpecifiers(source: string): Set<string> {
  const results = new Set<string>();
  const importRegex = /import\s+(?:[^"']+from\s+)?["']([^"']+)["']/g;
  const bareImportRegex = /import\s*["']([^"']+)["']/g;
  const requireRegex = /require\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicImportRegex = /import\(\s*["']([^"']+)["']\s*\)/g;

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    const spec = match[1];
    if (shouldTrackSpecifier(spec)) {
      results.add(spec);
    }
  }
  while ((match = bareImportRegex.exec(source)) !== null) {
    const spec = match[1];
    if (shouldTrackSpecifier(spec)) {
      results.add(spec);
    }
  }
  while ((match = requireRegex.exec(source)) !== null) {
    const spec = match[1];
    if (shouldTrackSpecifier(spec)) {
      results.add(spec);
    }
  }
  while ((match = dynamicImportRegex.exec(source)) !== null) {
    const spec = match[1];
    if (shouldTrackSpecifier(spec)) {
      results.add(spec);
    }
  }
  return results;
}

function shouldTrackSpecifier(spec: string): boolean {
  if (!spec) {
    return false;
  }
  if (spec.startsWith(".")) {
    const ext = extname(spec).toLowerCase();
    return fontExtensionRegex.test(ext) || iconExtensionRegex.test(ext);
  }
  const lowered = spec.toLowerCase();
  if (fontExtensionRegex.test(lowered)) {
    return true;
  }
  if (iconExtensionRegex.test(lowered)) {
    return true;
  }
  return lowered.includes("font") || lowered.includes("icon");
}

function isFontFile(name: string): boolean {
  return fontExtensionRegex.test(name.toLowerCase());
}

function isIconFile(name: string): boolean {
  return iconExtensionRegex.test(name.toLowerCase());
}

function isCodeFile(name: string): boolean {
  const ext = extname(name).toLowerCase();
  return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext);
}

function isStylesheetFile(name: string): boolean {
  const ext = extname(name).toLowerCase();
  return [".css", ".scss", ".sass"].includes(ext);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function normalizePath(path: string): string {
  return normalize(path).split("\\").join("/");
}

function extractFontUrlsFromStylesheet(
  source: string,
  filePath: string,
  projectRoot: string
): Set<string> {
  const results = new Set<string>();
  const urlRegex = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\)"']+))\s*\)/g;

  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(source)) !== null) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!raw) {
      continue;
    }
    const cleaned = stripUrlParameters(raw);
    if (!cleaned) {
      continue;
    }
    const lowered = cleaned.toLowerCase();
    if (!fontExtensionRegex.test(lowered)) {
      continue;
    }

    const resolved = resolveStylesheetUrl(cleaned, filePath, projectRoot);
    if (!resolved) {
      continue;
    }

    results.add(resolved);
  }

  return results;
}

function stripUrlParameters(url: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("data:")) return undefined;
  if (/^[a-z]+:\/\//i.test(url)) return undefined;
  const cleaned = url.split(/[?#]/)[0]?.trim();
  return cleaned ? cleaned : undefined;
}

function resolveStylesheetUrl(
  url: string,
  filePath: string,
  projectRoot: string
): string | undefined {
  const normalizedUrl = url.replace(/^\.\//, "");
  const fileDir = dirname(filePath);
  let absolute: string;

  if (normalizedUrl.startsWith("/")) {
    const withoutLeadingSlash = normalizedUrl.replace(/^\/+/, "");
    absolute = join(projectRoot, withoutLeadingSlash);
  } else {
    absolute = resolve(fileDir, normalizedUrl);
  }

  const relativePath = normalizePath(relative(projectRoot, absolute));
  if (relativePath.startsWith("..")) {
    return undefined;
  }
  return relativePath;
}

async function scanIconAssetReferences(
  directory: string,
  projectRoot: string
): Promise<Map<string, Set<string>>> {
  const references = new Map<string, Set<string>>();
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return references;
    }
    throw error;
  }

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await scanIconAssetReferences(entryPath, projectRoot);
      for (const [file, assets] of nested) {
        const existing = references.get(file);
        if (existing) {
          assets.forEach((asset) => existing.add(asset));
        } else {
          references.set(file, new Set(assets));
        }
      }
      continue;
    }

    if (!isCodeFile(entry.name)) {
      continue;
    }

    const relativePath = normalizePath(relative(projectRoot, entryPath));
    const content = await readFile(entryPath, "utf8");
    const assets = new Set<string>();

    extractImportLikeIconSpecifiers(content).forEach((specifier) => {
      const resolved = resolveImportAsset(specifier, entryPath, projectRoot);
      if (resolved) {
        assets.add(resolved);
      }
    });

    extractNewUrlIconSpecifiers(content).forEach((specifier) => {
      const resolved = resolveImportAsset(specifier, entryPath, projectRoot);
      if (resolved) {
        assets.add(resolved);
      }
    });

    if (assets.size > 0) {
      references.set(relativePath, assets);
    }
  }

  return references;
}

function extractImportLikeIconSpecifiers(source: string): Set<string> {
  const results = new Set<string>();
  const importRegex = /import\s+(?:[^"']+from\s+)?["']([^"']+\.(?:svg|ico))(\?[^"']*)?["']/gi;
  const bareImportRegex = /import\s*["']([^"']+\.(?:svg|ico))(\?[^"']*)?["']/gi;
  const requireRegex = /require\(\s*["']([^"']+\.(?:svg|ico))(\?[^"']*)?["']\s*\)/gi;

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    if (match[1]) {
      results.add(match[1]);
    }
  }
  while ((match = bareImportRegex.exec(source)) !== null) {
    if (match[1]) {
      results.add(match[1]);
    }
  }
  while ((match = requireRegex.exec(source)) !== null) {
    if (match[1]) {
      results.add(match[1]);
    }
  }
  return results;
}

function extractNewUrlIconSpecifiers(source: string): Set<string> {
  const results = new Set<string>();
  const newUrlRegex = /new\s+URL\(\s*["'`]([^"'`]+\.(?:svg|ico))(?:\?[^"'`]*)?["'`]\s*,\s*import\.meta\.url\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = newUrlRegex.exec(source)) !== null) {
    const value = match[1];
    if (value) {
      results.add(value);
    }
  }
  return results;
}

function resolveImportAsset(
  specifier: string,
  filePath: string,
  projectRoot: string
): string | undefined {
  if (!specifier) {
    return undefined;
  }

  if (/^[a-z]+:/i.test(specifier) || specifier.startsWith("data:")) {
    return undefined;
  }

  if (specifier.startsWith("/")) {
    const abs = join(projectRoot, specifier.replace(/^\/+/, ""));
    return normalizeAssetPath(abs, projectRoot);
  }

  if (specifier.startsWith(".")) {
    const abs = resolve(dirname(filePath), specifier);
    return normalizeAssetPath(abs, projectRoot);
  }

  // Non-relative specifiers point at packages, which are already covered by import tracking.
  return undefined;
}

function normalizeAssetPath(absPath: string, projectRoot: string): string | undefined {
  const relativePath = normalizePath(relative(projectRoot, absPath));
  if (relativePath.startsWith("..")) {
    return undefined;
  }
  if (!iconExtensionRegex.test(relativePath)) {
    return undefined;
  }
  if (
    !relativePath.startsWith("src/assets/icons/") &&
    !relativePath.startsWith("src/assets/vendor/")
  ) {
    return undefined;
  }
  return relativePath;
}

const fontExtensionRegex = /\.(woff2?|ttf|otf|eot|svg)$/i;
const iconExtensionRegex = /\.(svg|ico)$/i;

void main();
