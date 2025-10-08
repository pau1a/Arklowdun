import { strict as assert } from "node:assert";
import test from "node:test";
import { webcrypto } from "node:crypto";

import { exportLogsJsonl } from "../src/features/logs/exportLogsJsonl.ts";
import type { LogEntry } from "../src/features/logs/logs.types.ts";

if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto as unknown as Crypto;
}

test("exportLogsJsonl writes JSONL with meta and checksum", async () => {
  const entries: LogEntry[] = [
    {
      tsUtc: "2025-10-07T18:26:12Z",
      tsEpochMs: Date.parse("2025-10-07T18:26:12Z"),
      level: "info",
      event: "fs_guard",
      message: "Guard activated",
      raw: {
        ts: "2025-10-07T18:26:12Z",
        level: "info",
        event: "fs_guard",
        message: "Guard activated",
      },
    },
    {
      tsUtc: "2025-10-07T18:25:12Z",
      tsEpochMs: Date.parse("2025-10-07T18:25:12Z"),
      level: "warn",
      event: "vault",
      message: "Vault warning",
      raw: {
        ts: "2025-10-07T18:25:12Z",
        level: "warn",
        event: "vault",
        message: "Vault warning",
      },
    },
  ];

  let capturedPath: string | null = null;
  let capturedContents: string | null = null;

  const result = await exportLogsJsonl({
    entries,
    filters: { severity: "info", categories: ["fs_guard", "vault"] },
    deps: {
      saveDialog: async () => "/tmp/arklowdun.jsonl",
      writeTextFile: async (path, contents) => {
        capturedPath = path;
        capturedContents = contents;
      },
      getDesktopDir: async () => "/Users/example/Desktop",
      joinPath: async (...parts: string[]) => parts.join("/"),
      getAppVersion: async () => "0.70.2",
      getSchemaVersion: async () => 26,
      getOsDescription: async () => "macOS 14.6.1 arm64",
      now: () => new Date("2025-10-07T18:27:12Z"),
    },
  });

  assert.ok(result);
  assert.equal(result?.filePath, "/tmp/arklowdun.jsonl");
  assert.equal(result?.fileName, "arklowdun-tail_0.70.2_2025-10-07T18-27Z_sev-info_cats-fs_guard,vault.jsonl");
  assert.equal(result?.recordCount, 2);
  assert.equal(result?.exportedAtUtc, "2025-10-07T18:27:12.000Z");
  assert.equal(capturedPath, "/tmp/arklowdun.jsonl");
  assert.ok(capturedContents);
  assert.ok(capturedContents?.endsWith("\n"));

  const lines = capturedContents?.trim().split("\n") ?? [];
  assert.equal(lines.length, 4);

  const meta = JSON.parse(lines[0]!);
  assert.deepEqual(meta, {
    _meta: {
      app_version: "0.70.2",
      schema_version: 26,
      os: "macOS 14.6.1 arm64",
      exported_at_utc: "2025-10-07T18:27:12.000Z",
      filters: {
        severity: ">=info",
        categories: ["fs_guard", "vault"],
      },
      record_count: 2,
    },
  });

  assert.deepEqual(JSON.parse(lines[1]!), entries[0]!.raw);
  assert.deepEqual(JSON.parse(lines[2]!), entries[1]!.raw);

  const checksumLine = JSON.parse(lines[3]!);
  assert.equal(checksumLine._checksum.record_count, 2);
  assert.equal(checksumLine._checksum.sha256, result?.checksum);

  const payloadText = lines.slice(1, 3).join("\n");
  const digestBuffer = await webcrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payloadText),
  );
  const digestHex = Array.from(new Uint8Array(digestBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  assert.equal(digestHex, result?.checksum);
});

test("exportLogsJsonl caps output at 200 entries", async () => {
  const entries: LogEntry[] = Array.from({ length: 205 }, (_, index) => ({
    tsUtc: `2025-10-07T18:${(index + 1).toString().padStart(2, "0")}:12Z`,
    tsEpochMs: Date.parse(`2025-10-07T18:${(index + 1).toString().padStart(2, "0")}:12Z`),
    level: "info",
    event: `event-${index}`,
    message: `Message ${index}`,
    raw: { index },
  }));

  let contents: string | null = null;

  const result = await exportLogsJsonl({
    entries,
    filters: { severity: "info", categories: [] },
    deps: {
      saveDialog: async () => "/tmp/capped.jsonl",
      writeTextFile: async (_path, text) => {
        contents = text;
      },
      getDesktopDir: async () => null,
      joinPath: async (...parts: string[]) => parts.join("/"),
      getAppVersion: async () => "0.70.2",
      getSchemaVersion: async () => 26,
      getOsDescription: async () => "macOS 14.6.1 arm64",
      now: () => new Date("2025-10-07T18:27:12Z"),
    },
  });

  assert.ok(result);
  assert.equal(result?.recordCount, 200);
  assert.ok(contents);

  const lines = contents?.trim().split("\n") ?? [];
  assert.equal(lines.length, 202);

  const firstPayload = JSON.parse(lines[1]!);
  const lastPayload = JSON.parse(lines[200]!);
  assert.deepEqual(firstPayload, { index: 5 });
  assert.deepEqual(lastPayload, { index: 204 });
});

test("exportLogsJsonl returns null when dialog is cancelled", async () => {
  const entries: LogEntry[] = [
    {
      tsUtc: "2025-10-07T18:26:12Z",
      tsEpochMs: Date.parse("2025-10-07T18:26:12Z"),
      level: "info",
      event: "fs_guard",
      raw: { ts: "2025-10-07T18:26:12Z" },
    },
  ];

  let writeCalled = false;

  const result = await exportLogsJsonl({
    entries,
    filters: { severity: "info", categories: [] },
    deps: {
      saveDialog: async () => null,
      writeTextFile: async () => {
        writeCalled = true;
      },
      getDesktopDir: async () => null,
      joinPath: async (...parts: string[]) => parts.join("/"),
      getAppVersion: async () => "0.70.2",
      getSchemaVersion: async () => 26,
      getOsDescription: async () => "macOS 14.6.1 arm64",
      now: () => new Date("2025-10-07T18:27:12Z"),
    },
  });

  assert.equal(result, null);
  assert.equal(writeCalled, false);
});
