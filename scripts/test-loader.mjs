import { resolve as tsResolve, load as tsLoad, getFormat as tsGetFormat, transformSource as tsTransformSource } from 'ts-node/esm';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

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

export async function resolve(specifier, context, defaultResolve) {
  let nextSpecifier = specifier;

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
        nextSpecifier = pathToFileURL(absolutePath).href;
      } else {
        nextSpecifier = candidate;
      }
    }
  }

  return tsResolve(nextSpecifier, context, defaultResolve);
}

export const load = tsLoad;
export const getFormat = tsGetFormat;
export const transformSource = tsTransformSource;
