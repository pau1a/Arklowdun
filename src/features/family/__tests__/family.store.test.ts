import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listMock,
  createMock,
  updateMock,
  attachmentsListMock,
  attachmentsAddMock,
  attachmentsRemoveMock,
  renewalsListMock,
  renewalsUpsertMock,
  renewalsDeleteMock,
  logSpy,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  attachmentsListMock: vi.fn(),
  attachmentsAddMock: vi.fn(),
  attachmentsRemoveMock: vi.fn(),
  renewalsListMock: vi.fn(),
  renewalsUpsertMock: vi.fn(),
  renewalsDeleteMock: vi.fn(),
  logSpy: vi.fn(),
}));

vi.mock("@lib/uiLog", () => ({
  logUI: logSpy,
}));

import { familyStore } from "../family.store";
import { familyRepo } from "../../../repos.ts";

const FileCtor: typeof File =
  typeof File === "undefined"
    ? class {
        name: string;
        type: string;
        constructor(_parts: unknown[], name: string, options?: { type?: string }) {
          this.name = name;
          this.type = options?.type ?? "";
        }
      } as unknown as typeof File
    : File;

function baseMember(position = 0) {
  return {
    id: `mem-${position + 1}`,
    household_id: "hh-1",
    name: `Member ${position + 1}`,
    notes: "",
    position,
    created_at: position + 1,
    updated_at: position + 1,
    keyholder: 0,
    status: "active",
  } as Record<string, unknown>;
}

describe("familyStore", () => {
  beforeEach(() => {
    listMock.mockReset();
    createMock.mockReset();
    updateMock.mockReset();
    attachmentsListMock.mockReset();
    attachmentsAddMock.mockReset();
    attachmentsRemoveMock.mockReset();
    renewalsListMock.mockReset();
    renewalsUpsertMock.mockReset();
    renewalsDeleteMock.mockReset();
    logSpy.mockReset();
    familyStore.__resetForTests();
    listMock.mockResolvedValue([baseMember(0)]);
    attachmentsListMock.mockResolvedValue([]);
    renewalsListMock.mockResolvedValue([]);
    familyRepo.list = listMock as any;
    familyRepo.create = createMock as any;
    familyRepo.update = updateMock as any;
    familyRepo.attachments.list = attachmentsListMock as any;
    familyRepo.attachments.add = attachmentsAddMock as any;
    familyRepo.attachments.remove = attachmentsRemoveMock as any;
    familyRepo.renewals.list = renewalsListMock as any;
    familyRepo.renewals.upsert = renewalsUpsertMock as any;
    familyRepo.renewals.delete = renewalsDeleteMock as any;
  });

  it("hydrates and caches members per household", async () => {
    await familyStore.load("hh-1");
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(familyStore.getAll()).toHaveLength(1);

    await familyStore.load("hh-1");
    expect(listMock).toHaveBeenCalledTimes(1);

    await familyStore.load("hh-1", true);
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(
      "INFO",
      "ui.family.load",
      expect.objectContaining({ household_id: "hh-1" }),
    );
  });

  it("returns members via getAll and get", async () => {
    await familyStore.load("hh-1");
    const all = familyStore.getAll();
    expect(all[0].name).toBe("Member 1");
    expect(familyStore.get("mem-1")?.id).toBe("mem-1");
  });

  it("supports subscriptions", async () => {
    const listener = vi.fn();
    const unsubscribe = familyStore.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    await familyStore.load("hh-1");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("upserts new members with optimistic reconciliation", async () => {
    await familyStore.load("hh-1");
    createMock.mockResolvedValue({
      id: "mem-2",
      household_id: "hh-1",
      name: "Ada",
      notes: "",
      position: 1,
      created_at: 200,
      updated_at: 200,
      keyholder: 1,
      status: "active",
    });

    const created = await familyStore.upsert({ name: "Ada", position: 1 });
    expect(createMock).toHaveBeenCalledWith("hh-1", expect.any(Object));
    expect(created.id).toBe("mem-2");
    expect(familyStore.get("mem-2")?.name).toBe("Ada");
    expect(logSpy).toHaveBeenCalledWith(
      "INFO",
      "ui.family.optimisticInsert",
      expect.objectContaining({ member_id: expect.any(String) }),
    );
  });

  it("updates existing members", async () => {
    await familyStore.load("hh-1");
    updateMock.mockResolvedValue(undefined);
    const updated = await familyStore.upsert({ id: "mem-1", notes: "Updated" });
    expect(updateMock).toHaveBeenCalledWith(
      "hh-1",
      "mem-1",
      expect.objectContaining({ notes: "Updated" }),
    );
    expect(updated.notes).toBe("Updated");
  });

  it("rolls back failed optimistic creates", async () => {
    await familyStore.load("hh-1");
    createMock.mockRejectedValue(new Error("boom"));

    await expect(familyStore.upsert({ name: "Err" })).rejects.toThrow("boom");
    expect(familyStore.getAll()).toHaveLength(1);
    expect(logSpy).toHaveBeenCalledWith(
      "WARN",
      "ui.family.rollback",
      expect.objectContaining({ member_id: expect.any(String) }),
    );
  });

  it("loads attachments lazily and caches results", async () => {
    await familyStore.load("hh-1");
    attachmentsListMock.mockResolvedValue([
      {
        id: "att-1",
        householdId: "hh-1",
        memberId: "mem-1",
        rootKey: "appData",
        relativePath: "docs/passport.pdf",
        title: "Passport",
        mimeHint: "application/pdf",
        addedAt: 1,
      },
    ]);

    const first = await familyStore.attachments.load("mem-1");
    expect(first).toHaveLength(1);
    await familyStore.attachments.load("mem-1");
    expect(attachmentsListMock).toHaveBeenCalledTimes(1);
  });

  it("adds attachments optimistically and reconciles", async () => {
    await familyStore.load("hh-1");
    attachmentsAddMock.mockResolvedValue({
      id: "att-2",
      householdId: "hh-1",
      memberId: "mem-1",
      rootKey: "appData",
      relativePath: "passport.pdf",
      title: "passport.pdf",
      mimeHint: "application/pdf",
      addedAt: 2,
    });

    const file = new FileCtor(["passport"], "passport.pdf", { type: "application/pdf" });
    const attachment = await familyStore.attachments.add("mem-1", file);
    expect(attachmentsAddMock).toHaveBeenCalledWith({
      householdId: "hh-1",
      memberId: "mem-1",
      rootKey: "appData",
      relativePath: "passport.pdf",
      title: "passport.pdf",
      mimeHint: "application/pdf",
    });
    expect(attachment.id).toBe("att-2");
    expect(await familyStore.attachments.load("mem-1")).toHaveLength(1);
  });

  it("rolls back attachment failures", async () => {
    await familyStore.load("hh-1");
    attachmentsAddMock.mockRejectedValue(new Error("attach"));
    const file = new FileCtor(["bad"], "bad.pdf", { type: "application/pdf" });
    await expect(familyStore.attachments.add("mem-1", file)).rejects.toThrow("attach");
    const cached = await familyStore.attachments.load("mem-1");
    expect(cached).toHaveLength(0);
  });

  it("lists and upserts renewals", async () => {
    await familyStore.load("hh-1");
    renewalsListMock.mockResolvedValue([
      {
        id: "ren-1",
        householdId: "hh-1",
        memberId: "mem-1",
        kind: "passport",
        label: "Passport",
        expiresAt: 123,
        remindOnExpiry: true,
        remindOffsetDays: 30,
        updatedAt: 100,
      },
    ]);

    const renewals = await familyStore.renewals.list("mem-1");
    expect(renewals).toHaveLength(1);

    renewalsUpsertMock.mockResolvedValue({
      id: "ren-2",
      householdId: "hh-1",
      memberId: "mem-1",
      kind: "passport",
      label: "Passport",
      expiresAt: 999,
      remindOnExpiry: true,
      remindOffsetDays: 10,
      updatedAt: 101,
    });

    const saved = await familyStore.renewals.upsert("mem-1", {
      kind: "passport",
      expiresAt: 999,
      remindOnExpiry: true,
      remindOffsetDays: 10,
    });
    expect(saved.id).toBe("ren-2");
    expect(renewalsUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "mem-1",
        householdId: "hh-1",
        kind: "passport",
      }),
    );
  });

  it("rolls back failed renewal deletes", async () => {
    await familyStore.load("hh-1");
    renewalsDeleteMock.mockRejectedValue(new Error("delete"));
    await expect(familyStore.renewals.delete("mem-1", "ren-x")).rejects.toThrow("delete");
    expect(logSpy).toHaveBeenCalledWith(
      "WARN",
      "ui.family.rollback",
      expect.objectContaining({ renewal_id: "ren-x" }),
    );
  });
});
