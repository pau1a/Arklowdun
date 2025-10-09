import assert from "node:assert/strict";
import test from "node:test";
import { performance as nodePerformance } from "node:perf_hooks";
import { JSDOM } from "jsdom";
import { mountAddMemberModal } from "../../src/features/family/modal/index.ts";
import { familyStore } from "../../src/features/family/family.store";
import type { FamilyMember } from "../../src/features/family/family.types";
import { familyRepo } from "../../src/repos.ts";
import { toast } from "../../src/ui/Toast";
import { on, type FamilyMemberAddedPayload } from "../../src/store/events";

type UpsertFn = typeof familyStore.upsert;
type OptimisticCreateFn = typeof familyStore.optimisticCreate;
type CommitCreatedFn = typeof familyStore.commitCreated;
type RepoCreateFn = typeof familyRepo.create;
type ToastShowFn = typeof toast.show;
test.beforeEach(() => {
  (globalThis as any).performance = nodePerformance;
  const dom = new JSDOM("<!doctype html><html><body><div id=\"modal-root\"></div></body></html>");
  (globalThis as any).window = dom.window as unknown as typeof globalThis & Window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
  if (typeof window.requestAnimationFrame !== "function") {
    window.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(callback, 0);
  }
  (window as typeof window & { __TAURI__?: { invoke?: () => Promise<unknown> } }).__TAURI__ = {
    invoke: () => Promise.resolve(),
  };
});

test.afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).HTMLInputElement;
  familyStore.upsert = originalUpsert;
  familyStore.optimisticCreate = originalOptimisticCreate;
  familyStore.commitCreated = originalCommitCreated;
  familyRepo.create = originalRepoCreate;
  toast.show = originalToastShow;
});

const originalUpsert: UpsertFn = familyStore.upsert;
const originalOptimisticCreate: OptimisticCreateFn = familyStore.optimisticCreate;
const originalCommitCreated: CommitCreatedFn = familyStore.commitCreated;
const originalRepoCreate: RepoCreateFn = familyRepo.create;
const originalToastShow: ToastShowFn = toast.show;

function createMember(partial: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: "mem-1",
    householdId: "house-1",
    name: "Member",
    ...partial,
  } as FamilyMember;
}

test("advances to optional details when basic info is valid", () => {
  const modal = mountAddMemberModal({ householdId: "house-1", getMemberCount: () => 0 });
  modal.open();

  const nickname = document.getElementById("family-add-member-nickname") as HTMLInputElement;
  nickname.value = "Chris";
  nickname.dispatchEvent(new window.Event("input", { bubbles: true }));

  const form = document.querySelector(".add-member-modal__form") as HTMLFormElement;
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  const progress = document.querySelector(".add-member-modal__progress");
  assert.equal(progress?.textContent, "Step 2 of 2");

  const optionalStep = document
    .getElementById("family-add-member-phone")
    ?.closest<HTMLElement>(".add-member-modal__step");
  assert.equal(optionalStep?.hidden, false);
});

test("shows an inline error when no nickname is provided", () => {
  const modal = mountAddMemberModal({ householdId: "house-1", getMemberCount: () => 0 });
  modal.open();

  const form = document.querySelector(".add-member-modal__form") as HTMLFormElement;
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  const error = document.getElementById("family-add-member-identity-error");
  assert.ok(error?.textContent?.includes("Enter a nickname"));
  const basicStep = document
    .getElementById("family-add-member-nickname")
    ?.closest<HTMLElement>(".add-member-modal__step");
  assert.equal(basicStep?.hidden, false);
});

test("emits success feedback and event on create", async () => {
  const optimisticCalls: Partial<FamilyMember>[] = [];
  let rollbackCalled = false;
  familyStore.optimisticCreate = ((payload: Partial<FamilyMember>) => {
    optimisticCalls.push(payload);
    return {
      memberId: "mem-temp",
      rollback() {
        rollbackCalled = true;
      },
    };
  }) as OptimisticCreateFn;

  const commitCalls: { tempId: string | null | undefined; raw: unknown }[] = [];
  familyStore.commitCreated = ((tempId, raw) => {
    commitCalls.push({ tempId, raw });
    return createMember({ id: "mem-123", name: (raw as any)?.name ?? "Member" });
  }) as CommitCreatedFn;

  const repoCalls: { householdId: string; data: unknown }[] = [];
  familyRepo.create = (async (householdId, data) => {
    repoCalls.push({ householdId, data });
    return {
      id: "mem-123",
      name: (data as any)?.name ?? "Member",
      birthday: 0,
      notes: (data as any)?.notes ?? "",
      documents: [],
      household_id: householdId,
      position: (data as any)?.position ?? 0,
      created_at: 1,
      updated_at: 1,
      deleted_at: undefined,
    } as any;
  }) as RepoCreateFn;

  const toastCalls: Parameters<ToastShowFn>[0][] = [];
  toast.show = ((options) => {
    toastCalls.push(options);
  }) as ToastShowFn;

  const eventCalls: FamilyMemberAddedPayload[] = [];
  const unsubscribe = on("family:memberAdded", (payload) => {
    eventCalls.push(payload);
  });

  const modal = mountAddMemberModal({ householdId: "house-1", getMemberCount: () => 2 });
  modal.open();

  const nickname = document.getElementById("family-add-member-nickname") as HTMLInputElement;
  nickname.value = "Dee";
  nickname.dispatchEvent(new window.Event("input", { bubbles: true }));

  const form = document.querySelector(".add-member-modal__form") as HTMLFormElement;
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  await Promise.resolve();

  assert.equal(optimisticCalls.length, 1);
  assert.equal(optimisticCalls[0]?.name, "Dee");
  assert.equal(optimisticCalls[0]?.position, 2);
  assert.equal(repoCalls.length, 1);
  assert.deepEqual(repoCalls[0], {
    householdId: "house-1",
    data: {
      name: "Dee",
      notes: null,
      position: 2,
      household_id: "house-1",
    },
  });
  assert.equal(commitCalls.length, 1);
  assert.equal(commitCalls[0]?.tempId, "mem-temp");
  assert.equal((commitCalls[0]?.raw as any)?.name, "Dee");
  assert.equal(rollbackCalled, false);
  assert.deepEqual(toastCalls[toastCalls.length - 1], {
    kind: "success",
    message: "Member added",
  });
  assert.ok(!toastCalls.some((call) => call.message.includes("Could not save")));
  assert.deepEqual(eventCalls[eventCalls.length - 1], {
    memberId: "mem-123",
    householdId: "house-1",
  });
  assert.equal(document.querySelector(".add-member-modal"), null);
  unsubscribe();
});

test("surfaces duplicate position errors with a friendly toast", async () => {
  let rollbackCalls = 0;
  familyStore.optimisticCreate = ((payload: Partial<FamilyMember>) => {
    return {
      memberId: "mem-temp",
      rollback() {
        rollbackCalls += 1;
      },
    };
  }) as OptimisticCreateFn;

  familyStore.commitCreated = ((tempId) => {
    throw new Error(`should not commit ${String(tempId)}`);
  }) as CommitCreatedFn;

  familyRepo.create = (async () => {
    const error = { code: "DB_CONSTRAINT_UNIQUE", message: "duplicate" };
    throw error;
  }) as RepoCreateFn;

  const toastCalls: Parameters<ToastShowFn>[0][] = [];
  toast.show = ((options) => {
    toastCalls.push(options);
  }) as ToastShowFn;

  const modal = mountAddMemberModal({ householdId: "house-1", getMemberCount: () => 1 });
  modal.open();

  const nickname = document.getElementById("family-add-member-nickname") as HTMLInputElement;
  nickname.value = "Sky";
  nickname.dispatchEvent(new window.Event("input", { bubbles: true }));

  const form = document.querySelector(".add-member-modal__form") as HTMLFormElement;
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  await Promise.resolve();

  const duplicateToasts = toastCalls.filter((toastCall) =>
    toastCall.message === "Could not save — please try again",
  );
  assert.equal(duplicateToasts.length, 1);
  assert.deepEqual(duplicateToasts[0], {
    kind: "info",
    message: "Could not save — please try again",
  });
  assert.equal(rollbackCalls, 1);
});

test("restores focus to the trigger when the modal closes", () => {
  const modal = mountAddMemberModal({ householdId: "house-1", getMemberCount: () => 0 });

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.textContent = "Add";
  document.body.appendChild(trigger);
  trigger.focus();

  modal.open();

  const nickname = document.getElementById("family-add-member-nickname") as HTMLInputElement;
  nickname.value = "Jamie";
  nickname.dispatchEvent(new window.Event("input", { bubbles: true }));

  modal.close();

  assert.strictEqual(document.activeElement, trigger);
  trigger.remove();
});
