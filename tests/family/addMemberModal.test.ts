import assert from "node:assert/strict";
import test from "node:test";
import { performance as nodePerformance } from "node:perf_hooks";
import { JSDOM } from "jsdom";
import { mountAddMemberModal } from "../../src/features/family/modal/index.ts";
import { familyStore } from "../../src/features/family/family.store";
import type { FamilyMember } from "../../src/features/family/family.types";
import { toast } from "../../src/ui/Toast";
import { on, type FamilyMemberAddedPayload } from "../../src/store/events";

type UpsertFn = typeof familyStore.upsert;
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
  toast.show = originalToastShow;
});

const originalUpsert: UpsertFn = familyStore.upsert;
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
  const upsertCalls: Partial<FamilyMember>[] = [];
  familyStore.upsert = (async (payload: Partial<FamilyMember>) => {
    upsertCalls.push(payload);
    return createMember({ id: "mem-123", name: payload.name ?? "Member" });
  }) as UpsertFn;

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

  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0]?.name, "Dee");
  assert.equal(upsertCalls[0]?.position, 2);
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
  familyStore.upsert = (async () => {
    const error = { code: "DB_CONSTRAINT_UNIQUE", message: "duplicate" };
    throw error;
  }) as UpsertFn;

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
