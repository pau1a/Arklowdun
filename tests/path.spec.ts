import { strict as assert } from "node:assert";
import test from "node:test";
import {
  canonicalizeAndVerify,
  rejectSymlinks,
  PathError,
  __setMocks
} from "../src/files/path.ts";

let mockAppData = "/app";
const symlinks = new Set<string>();
let lstatMock = async (p: string) => ({ isSymbolicLink: symlinks.has(p) });

__setMocks({
  appDataDir: async () => mockAppData,
  join: (...parts: string[]) => parts.join("/"),
  lstat: lstatMock,
});

test.beforeEach(() => {
  mockAppData = "/app";
  symlinks.clear();
  lstatMock = async (p: string) => ({ isSymbolicLink: symlinks.has(p) });
  __setMocks({ lstat: lstatMock });
});

test("absolute outside base -> OUTSIDE_ROOT", async () => {
  await assert.rejects(
    canonicalizeAndVerify("/etc/passwd", "attachments"),
    (e: any) => e instanceof PathError && e.code === "OUTSIDE_ROOT",
  );
});

test("relative traversal rejected", async () => {
  await assert.rejects(
    canonicalizeAndVerify("../../etc/passwd", "attachments"),
    (e: any) => e instanceof PathError && e.code === "DOT_DOT_REJECTED",
  );
});

test("sub/../file normalized", async () => {
  const res = await canonicalizeAndVerify("sub/../file.txt", "attachments");
  assert.equal(res.realPath, "/app/attachments/file.txt");
});

test("UNC path rejected", async () => {
  await assert.rejects(
    canonicalizeAndVerify("\\\\server\\share\\foo", "attachments"),
    (e: any) => e instanceof PathError && e.code === "UNC_REJECTED",
  );
});

test("cross-volume rejected", async () => {
  mockAppData = "C:/Users/Alice/AppData";
  await assert.rejects(
    canonicalizeAndVerify("D:/foo", "attachments"),
    (e: any) => e instanceof PathError && e.code === "CROSS_VOLUME",
  );
});

test("separator normalization", async () => {
  const res = await canonicalizeAndVerify("sub\\\\nested\\\\file.txt", "attachments");
  assert.equal(res.realPath, "/app/attachments/sub/nested/file.txt");
});

test("symlink rejected", async () => {
  symlinks.add("/app/attachments/link");
  const { realPath } = await canonicalizeAndVerify("link/file.txt", "attachments");
  await assert.rejects(
    rejectSymlinks(realPath, "attachments"),
    (e: any) => e instanceof PathError && e.code === "SYMLINK",
  );
});

test("happy paths", async () => {
  let r = await canonicalizeAndVerify("file.jpg", "attachments");
  assert.equal(r.realPath, "/app/attachments/file.jpg");
  await rejectSymlinks(r.realPath, "attachments");

  r = await canonicalizeAndVerify("nested/dir/file.pdf", "attachments");
  assert.equal(r.realPath, "/app/attachments/nested/dir/file.pdf");
  await rejectSymlinks(r.realPath, "attachments");
});

test("absolute path inside base allowed", async () => {
  const r = await canonicalizeAndVerify("/app/attachments/img.png", "attachments");
  assert.equal(r.realPath, "/app/attachments/img.png");
});

test("nonexistent path does not trip symlink check", async () => {
  __setMocks({
    lstat: async (p: string) => {
      if (p.includes("newdir")) throw new Error("ENOENT");
      return { isSymbolicLink: symlinks.has(p) };
    },
  });
  const r = await canonicalizeAndVerify("newdir/newfile.txt", "attachments");
  await rejectSymlinks(r.realPath, "attachments");
});
