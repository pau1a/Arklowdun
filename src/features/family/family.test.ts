import { beforeEach, describe, expect, it, vi } from "vitest";

import { familyRepo } from "../../repos";
import { AttachmentInputSchema, RenewalInputSchema, RenewalSchema } from "@lib/ipc/contracts";
import type { Note } from "@features/notes";

const { callMock } = vi.hoisted(() => ({
  callMock: vi.fn(),
}));

vi.mock("@lib/ipc/call", () => ({
  call: callMock,
}));

vi.mock("../../services/searchRepo", () => ({
  clearSearchCache: vi.fn(),
}));

describe("familyRepo adapters", () => {
  beforeEach(() => {
    callMock.mockReset();
  });

  it("lists attachments and normalises casing", async () => {
    callMock.mockResolvedValue([
      {
        id: "a2dd8b2f-1e11-4130-bc5a-3c7cdb0b9d6a",
        household_id: "hh-1",
        member_id: "mem-1",
        root_key: "appData",
        relative_path: "docs/passport.pdf",
        title: "Passport",
        mime_hint: "application/pdf",
        added_at: 1728000000000,
      },
    ]);

    const items = await familyRepo.attachments.list("mem-1");

    expect(callMock).toHaveBeenCalledWith("member_attachments_list", { memberId: "mem-1" });
    expect(items).toEqual([
      {
        id: "a2dd8b2f-1e11-4130-bc5a-3c7cdb0b9d6a",
        householdId: "hh-1",
        memberId: "mem-1",
        rootKey: "appData",
        relativePath: "docs/passport.pdf",
        title: "Passport",
        mimeHint: "application/pdf",
        addedAt: 1728000000000,
      },
    ]);
  });

  it("adds attachments after validating input", async () => {
    callMock.mockResolvedValue({
      id: "0d8882b0-3d02-4f86-9010-64b718a0a820",
      household_id: "hh-1",
      member_id: "mem-1",
      root_key: "appData",
      relative_path: "docs/id.png",
      title: null,
      mime_hint: null,
      added_at: 1728000000000,
    });

    const attachment = await familyRepo.attachments.add({
      householdId: "hh-1",
      memberId: "mem-1",
      rootKey: "appData",
      relativePath: "docs/id.png",
    });

    expect(callMock).toHaveBeenCalledWith("member_attachments_add", {
      householdId: "hh-1",
      memberId: "mem-1",
      rootKey: "appData",
      relativePath: "docs/id.png",
    });
    expect(attachment.relativePath).toBe("docs/id.png");
  });

  it("normalises renewal booleans", async () => {
    callMock.mockResolvedValue([
      {
        id: "7ad17807-a072-4bb6-87a1-3b7f789e88a9",
        household_id: "hh-1",
        member_id: "mem-1",
        kind: "passport",
        label: "UK Passport",
        expires_at: 1800000000000,
        remind_on_expiry: 1,
        remind_offset_days: 30,
        updated_at: 1700000000000,
      },
    ]);

    const renewals = await familyRepo.renewals.list("mem-1");

    expect(callMock).toHaveBeenCalledWith("member_renewals_list", { memberId: "mem-1" });
    expect(renewals[0].remindOnExpiry).toBe(true);
  });

  it("upserts renewals and returns parsed payload", async () => {
    callMock.mockResolvedValue({
      id: "5f28e18e-0c35-4a86-a2c6-3f5cbbf6e584",
      household_id: "hh-1",
      member_id: "mem-1",
      kind: "insurance",
      label: null,
      expires_at: 1810000000000,
      remind_on_expiry: 0,
      remind_offset_days: 14,
      updated_at: 1705000000000,
    });

    const renewal = await familyRepo.renewals.upsert({
      householdId: "hh-1",
      memberId: "mem-1",
      kind: "insurance",
      expiresAt: 1810000000000,
      remindOnExpiry: false,
      remindOffsetDays: 14,
    });

    expect(callMock).toHaveBeenCalledWith("member_renewals_upsert", {
      householdId: "hh-1",
      memberId: "mem-1",
      kind: "insurance",
      expiresAt: 1810000000000,
      remindOnExpiry: false,
      remindOffsetDays: 14,
    });
    expect(renewal.kind).toBe("insurance");
    expect(renewal.remindOnExpiry).toBe(false);
  });

  it("filters notes by member id", () => {
    const notes: (Note & { member_id?: string; memberId?: string })[] = [
      { id: "n1", household_id: "hh-1", text: "A", created_at: 1, updated_at: 1, member_id: "mem-1" } as any,
      { id: "n2", household_id: "hh-1", text: "B", created_at: 1, updated_at: 1, member_id: "mem-2" } as any,
      { id: "n3", household_id: "hh-1", text: "C", created_at: 1, updated_at: 1, member_id: null } as any,
    ];

    const filtered = familyRepo.notes.listByMember(notes as Note[], "mem-1");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("n1");
  });

  it("optionally includes household notes when toggled", () => {
    const notes: (Note & { member_id?: string | null })[] = [
      { id: "n1", household_id: "hh-1", text: "A", created_at: 1, updated_at: 1, member_id: "mem-1" } as any,
      { id: "n2", household_id: "hh-1", text: "B", created_at: 1, updated_at: 1, member_id: null } as any,
      { id: "n3", household_id: "hh-1", text: "C", created_at: 1, updated_at: 1, member_id: "mem-2" } as any,
    ];

    const filtered = familyRepo.notes.listByMember(notes as Note[], "mem-1", { includeHousehold: true });
    expect(filtered.map((note) => note.id)).toEqual(["n1", "n2"]);
  });

  it("returns household notes when member id is null", () => {
    const notes: (Note & { member_id?: string | null })[] = [
      { id: "n1", household_id: "hh-1", text: "A", created_at: 1, updated_at: 1, member_id: "mem-1" } as any,
      { id: "n2", household_id: "hh-1", text: "B", created_at: 1, updated_at: 1, member_id: null } as any,
    ];

    const filtered = familyRepo.notes.listByMember(notes as Note[], null);
    expect(filtered).toEqual([{ id: "n2", household_id: "hh-1", text: "B", created_at: 1, updated_at: 1, member_id: null } as any]);
  });
});

describe("schema guards", () => {
  it("rejects invalid attachment mime hints", () => {
    expect(() =>
      AttachmentInputSchema.parse({
        householdId: "hh-1",
        memberId: "mem-1",
        rootKey: "appData",
        relativePath: "docs/id.png",
        mimeHint: "not/mime/extra",
      }),
    ).toThrow();
  });

  it("rejects out of range renewal offsets", () => {
    expect(() =>
      RenewalInputSchema.parse({
        householdId: "hh-1",
        memberId: "mem-1",
        kind: "passport",
        expiresAt: 1800000000000,
        remindOnExpiry: true,
        remindOffsetDays: 999,
      }),
    ).toThrow();
  });

  it("parses renewal responses", () => {
    const parsed = RenewalSchema.parse({
      id: "5f28e18e-0c35-4a86-a2c6-3f5cbbf6e584",
      household_id: "hh-1",
      member_id: "mem-1",
      kind: "pension",
      label: null,
      expires_at: 1900000000000,
      remind_on_expiry: true,
      remind_offset_days: 90,
      updated_at: 1700000000000,
    });

    expect(parsed).toEqual({
      id: "5f28e18e-0c35-4a86-a2c6-3f5cbbf6e584",
      householdId: "hh-1",
      memberId: "mem-1",
      kind: "pension",
      label: undefined,
      expiresAt: 1900000000000,
      remindOnExpiry: true,
      remindOffsetDays: 90,
      updatedAt: 1700000000000,
    });
  });
});
