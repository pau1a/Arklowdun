import { strict as assert } from "node:assert";
import test from "node:test";
import * as pathMod from "../src/files/path.ts";
import * as safeFs from "../src/files/safe-fs.ts";
// Set up base mocks for path operations
pathMod.__setMocks({
  appDataDir: async () => "/app",
  join: (...parts: string[]) => parts.join("/"),
  lstat: async () => ({ isSymbolicLink: false }),
});

test("writeText happy path uses canonical path", async () => {
  let captured: any[] | undefined;
  safeFs.__setMocks({
    fs: {
      writeTextFile: (async (p: string, data: string) => {
        captured = [p, data];
      }) as any,
    },
  });
  await safeFs.writeText("x/test.txt", "attachments", "hi");
  assert.deepEqual(captured, ["/app/attachments/x/test.txt", "hi"]);
});

test("absolute path denied", async () => {
  let called = false;
  safeFs.__setMocks({
    fs: {
      readTextFile: (async () => {
        called = true;
        return "";
      }) as any,
    },
  });
  await assert.rejects(
    safeFs.readText("/Users/me/Desktop/foo.txt", "attachments"),
    pathMod.PathError,
  );
  assert.equal(called, false);
  const msg = safeFs.toUserMessage(new pathMod.PathError("OUTSIDE_ROOT", ""));
  assert.equal(msg, "That location isn’t allowed.");
});

test("toUserMessage maps maintenance error codes", () => {
  assert.equal(
    safeFs.toUserMessage({ code: "FILE_MISSING" }),
    "The source file is missing from the vault.",
  );
  assert.equal(
    safeFs.toUserMessage({ code: "REPAIR_UNSUPPORTED_ACTION" }),
    "Attachment repair failed. Review the manifest for details.",
  );
  assert.equal(
    safeFs.toUserMessage({ code: "SOMETHING", message: "Custom message" }),
    "Custom message",
  );
});

test("exists true when lstat resolves", async () => {
  safeFs.__setMocks({
    fs: {
      lstat: async () => ({}) as any,
    },
  });
  const ok = await safeFs.exists("foo.txt", "attachments");
  assert.equal(ok, true);
});

test("exists false when lstat ENOENT", async () => {
  safeFs.__setMocks({
    fs: {
      lstat: async () => {
        const err: any = new Error("nope");
        err.code = "ENOENT";
        throw err;
      },
    },
  });
  const ok = await safeFs.exists("foo.txt", "attachments");
  assert.equal(ok, false);
});

test("exists false when lstat message indicates missing", async () => {
  safeFs.__setMocks({
    fs: {
      lstat: async () => {
        throw new Error("No such file or directory");
      },
    },
  });
  const ok = await safeFs.exists("foo.txt", "attachments");
  assert.equal(ok, false);
});

test("mkdir passes recursive option", async () => {
  let args: any[] | undefined;
  safeFs.__setMocks({
    fs: {
      mkdir: (async (p: string, opts?: { recursive?: boolean }) => {
        args = [p, opts];
      }) as any,
    },
  });
  await safeFs.mkdir("newdir", "attachments", { recursive: true });
  assert.deepEqual(args, ["/app/attachments/newdir", { recursive: true }]);
});

test("remove passes recursive option", async () => {
  let args: any[] | undefined;
  safeFs.__setMocks({
    fs: {
      remove: (async (p: string, opts?: { recursive?: boolean }) => {
        args = [p, opts];
      }) as any,
    },
  });
  await safeFs.remove("dir", "attachments", { recursive: true });
  assert.deepEqual(args, ["/app/attachments/dir", { recursive: true }]);
});

test("sanitizers are invoked", async () => {
  let canonCalled = 0;
  let rejectCalled = 0;
  safeFs.__setMocks({
    canonicalizeAndVerify: async (p, r) => {
      canonCalled++;
      return pathMod.canonicalizeAndVerify(p, r);
    },
    rejectSymlinks: async (p, r) => {
      rejectCalled++;
      return pathMod.rejectSymlinks(p, r);
    },
    fs: {
      readDir: async () => [],
    },
  });
  await safeFs.readDir("x", "attachments");
  assert.equal(canonCalled, 1);
  assert.equal(rejectCalled, 1);
});
