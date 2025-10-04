import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const RUST_SOURCE = path.resolve("src-tauri", "src", "lib.rs");
const CONTRACTS_SOURCE = path.resolve("src", "lib", "ipc", "contracts", "index.ts");

function parseBackendCommands(): string[] {
  const source = readFileSync(RUST_SOURCE, "utf8");
  const commands = new Set<string>();

  const addBody = (body: string) => {
    const cleaned = body.replace(/\/\/.*$/gm, "");
    for (const token of cleaned.split(",")) {
      const name = token.trim();
      if (!name || name.startsWith("$")) continue;
      if (!/^[_a-zA-Z][_0-9a-zA-Z]*$/.test(name)) continue;
      commands.add(name);
    }
  };

  const handlerRegex = /tauri::generate_handler!\[(?<body>[\s\S]*?)\]/g;
  for (const match of source.matchAll(handlerRegex)) {
    addBody(match.groups?.body ?? "");
  }

  const appCommandsRegex = /app_commands!\[(?<body>[\s\S]*?)\]/g;
  for (const match of source.matchAll(appCommandsRegex)) {
    addBody(match.groups?.body ?? "");
  }

  return Array.from(commands).sort();
}

test("frontend IPC contracts cover all Tauri commands", () => {
  const backendCommands = parseBackendCommands();
  const frontendCommands = parseFrontendContracts();
  const missing = backendCommands.filter((cmd) => !frontendCommands.includes(cmd));
  assert.deepEqual(missing, [], `Missing contracts for: ${missing.join(", ")}`);
});

function parseFrontendContracts(): string[] {
  const source = readFileSync(CONTRACTS_SOURCE, "utf8");
  const contractsBlockMatch = source.match(/export const contracts = \{([\s\S]*?)\}\s+as const/);
  if (!contractsBlockMatch) {
    throw new Error("Unable to locate contracts map");
  }
  const block = contractsBlockMatch[1];
  const keyRegex = /\s*([a-zA-Z0-9_]+)\s*:/g;
  const keys = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = keyRegex.exec(block)) !== null) {
    keys.add(match[1]);
  }
  return Array.from(keys).sort();
}
