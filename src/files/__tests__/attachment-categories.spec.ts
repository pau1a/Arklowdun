import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ATTACHMENT_CATEGORIES,
  isAttachmentCategory,
} from "../attachment-categories";

describe("attachment categories", () => {
  it("flags supported categories", () => {
    for (const value of ATTACHMENT_CATEGORIES) {
      expect(isAttachmentCategory(value)).toBe(true);
    }
  });

  it("rejects unknown categories", () => {
    expect(isAttachmentCategory("unknown")).toBe(false);
  });

  it("stays in sync with the generated backend binding", () => {
    const bindingPath = fileURLToPath(
      new URL("../../bindings/AttachmentCategory.ts", import.meta.url),
    );
    const binding = readFileSync(bindingPath, "utf8");
    const match = binding.match(
      /export type AttachmentCategory =([^;]+);/s,
    );

    expect(match).not.toBeNull();

    const parsed = match![1]
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.replace(/^"|"$/g, ""));

    expect(parsed).toEqual([...ATTACHMENT_CATEGORIES]);
  });
});
