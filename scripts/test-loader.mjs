import { resolve as tsResolve, load as tsLoad, getFormat as tsGetFormat, transformSource as tsTransformSource } from 'ts-node/esm';
import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { loadConfig, createMatchPath } = require('tsconfig-paths');

let matchPath;
const configResult = loadConfig();

if (configResult.resultType === 'failed') {
  console.warn(`${configResult.message}. tsconfig-paths will be skipped`);
} else {
  matchPath = createMatchPath(
    configResult.absoluteBaseUrl,
    configResult.paths,
    configResult.mainFields,
    configResult.addMatchAll
  );
}

const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const STUB_MODULES = new Map([
  ['@tauri-apps/api/event', new URL('../tests/stubs/tauri-event.ts', import.meta.url)],
  ['@tauri-apps/api/core', new URL('../tests/stubs/tauri-core.ts', import.meta.url)],
  ['@tauri-apps/api/path', new URL('../tests/stubs/tauri-path.ts', import.meta.url)],
  ['@tauri-apps/plugin-fs', new URL('../tests/stubs/tauri-fs.ts', import.meta.url)],
]);

export async function resolve(specifier, context, defaultResolve) {
  let nextSpecifier = specifier;

  const stub = STUB_MODULES.get(specifier);
  if (stub) {
    return { url: stub.href, format: 'module', shortCircuit: true };
  }

  if (matchPath) {
    const mapped = matchPath(specifier, undefined, existsSync, extensions);
    if (mapped) {
      let candidate = mapped;

      if (!existsSync(candidate)) {
        const resolved = extensions.find((ext) => existsSync(`${candidate}${ext}`));
        if (resolved) {
          candidate = `${candidate}${resolved}`;
        }
      }

      const absolutePath = resolvePath(candidate);
      if (existsSync(absolutePath)) {
        try {
          const stats = statSync(absolutePath);
          if (stats.isDirectory()) {
            const indexMatch = extensions
              .map((ext) => resolvePath(absolutePath, `index${ext}`))
              .find((file) => existsSync(file));
            if (indexMatch) {
              nextSpecifier = pathToFileURL(indexMatch).href;
            } else {
              nextSpecifier = pathToFileURL(absolutePath).href;
            }
          } else {
            nextSpecifier = pathToFileURL(absolutePath).href;
          }
        } catch {
          nextSpecifier = pathToFileURL(absolutePath).href;
        }
      } else {
        nextSpecifier = candidate;
      }
    }
  }

  try {
    return await tsResolve(nextSpecifier, context, defaultResolve);
  } catch (error) {
    if (specifier.startsWith('.') && context.parentURL) {
      const parentPath = fileURLToPath(context.parentURL);
      const candidateBase = resolvePath(dirname(parentPath), specifier);
      const resolvedExt = extensions.find((ext) => existsSync(`${candidateBase}${ext}`));
      if (resolvedExt) {
        const candidateUrl = pathToFileURL(`${candidateBase}${resolvedExt}`).href;
        return tsResolve(candidateUrl, context, defaultResolve);
      }
    }
    throw error;
  }
}

export const load = tsLoad;
export const getFormat = tsGetFormat;
export const transformSource = tsTransformSource;
