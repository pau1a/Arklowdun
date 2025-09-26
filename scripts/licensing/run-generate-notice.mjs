#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptArgs = process.argv.slice(2);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tsxExecutable = join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx"
);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: projectRoot,
      env: process.env,
      shell: false
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Process terminated with signal ${signal}`));
      } else {
        resolve(code ?? 0);
      }
    });
  });
}

async function main() {
  const pipelineExit = await run(tsxExecutable, [
    "scripts/licensing/pipeline.ts"
  ]);
  if (pipelineExit !== 0) {
    console.error(
      `Licensing inventory generation completed with exit code ${pipelineExit}. Continuing to render NOTICE artifacts.`
    );
  }

  const generatorExit = await run(tsxExecutable, [
    "scripts/licensing/generate-notices.ts",
    ...scriptArgs
  ]);

  if (pipelineExit !== 0) {
    process.exit(pipelineExit);
  }
  process.exit(generatorExit);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
