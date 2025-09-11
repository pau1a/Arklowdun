import { strict as assert } from "node:assert";
import test from "node:test";
import { highlight, escapeHtml } from "../src/utils/highlight.ts";

const MARK = /<mark class="search-hit">/g;

test("handles HTML reserved characters", () => {
  assert.equal(highlight("1 < 2", "<"), "1 <mark class=\"search-hit\">&lt;</mark> 2");
  assert.equal(highlight("1 > 2", ">"), "1 <mark class=\"search-hit\">&gt;</mark> 2");
  assert.equal(highlight("a & b", "&"), "a <mark class=\"search-hit\">&amp;</mark> b");
  assert.equal(
    highlight('He said "hi"', '"'),
    'He said <mark class="search-hit">&quot;</mark>hi<mark class="search-hit">&quot;</mark>'
  );
  assert.equal(highlight("it's ok", "'"), "it<mark class=\"search-hit\">&#39;</mark>s ok");
});

test("handles regex metacharacters", () => {
  const meta = '.*+?^${}()|[]\\';
  const res = highlight(`X${meta}Y`, meta);
  assert.equal(res, `X<mark class=\"search-hit\">${escapeHtml(meta)}</mark>Y`);
});

test("handles SQL wildcard characters", () => {
  assert.equal(highlight("100% match", "%"), "100<mark class=\"search-hit\">%</mark> match");
  assert.equal(highlight("file_name", "_"), "file<mark class=\"search-hit\">_</mark>name");
});

test("does not double escape already-escaped text", () => {
  const res = highlight("Fish &amp; Chips", "Fish");
  assert.equal(res, "<mark class=\"search-hit\">Fish</mark> &amp; Chips");
});

test("does not match inside existing entities", () => {
  const res = highlight("Fish &amp; Chips", "&");
  assert.equal(res, "Fish &amp; Chips");
});

test("enforces max hits", () => {
  const res = highlight("a a a a", "a", 2);
  const count = (res.match(MARK) || []).length;
  assert.equal(count, 2);
});

test("max hits zero yields no highlights", () => {
  const res = highlight("a a a a", "a", 0);
  const count = (res.match(MARK) || []).length;
  assert.equal(count, 0);
});

test("counts overlapping hits and respects limit", () => {
  let res = highlight("aaaa", "aa");
  let count = (res.match(MARK) || []).length;
  assert.equal(count, 2);
  res = highlight("aaaa", "aa", 1);
  count = (res.match(MARK) || []).length;
  assert.equal(count, 1);
});

test("preserves numeric entities", () => {
  assert.equal(escapeHtml("&#x3C;"), "&#x3C;");
  assert.equal(escapeHtml("&#60;"), "&#60;");
});

test("is ASCII-centric for case folding", () => {
  assert.equal(highlight("İstanbul", "i"), "İstanbul");
  assert.equal(highlight("straße", "SS"), "straße");
});
