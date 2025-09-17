import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

process.env.TS_NODE_PROJECT ??= resolve('tsconfig.json');
process.env.TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION ??= 'node';

const loaderUrl = new URL('./test-loader.mjs', import.meta.url);
register(loaderUrl.href, pathToFileURL('./'));   // enable ts-node ESM via custom loader

const require = createRequire(import.meta.url);  // allow requiring CJS from ESM
require('tsconfig-paths/register');              // hook TS path aliases (@lib, @ui, …)
