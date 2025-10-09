import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import { performance as nodePerformance } from "node:perf_hooks";

import { createRenewalsTab } from "../TabRenewals";
import type { FamilyMember, MemberRenewal } from "../../family.types";
import { familyStore } from "../../family.store";
import { toast } from "@ui/Toast";

function alignNoon(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(12, 0, 0, 0);
  return date.getTime();
}

let originalSetTimeout: any;
let originalClearTimeout: any;

function buildMember(): FamilyMember {
  return {
    id: "member-1",
    householdId: "house-1",
    name: "Test Member",
    position: 1,
    status: "active",
  } as FamilyMember;
}

function buildRenewal(id: string, expiresOffsetDays: number, overrides: Partial<MemberRenewal> = {}): MemberRenewal {
  const base = Date.now() + expiresOffsetDays * 24 * 60 * 60 * 1000;
  return {
    id,
    householdId: "house-1",
    memberId: "member-1",
    kind: "passport",
    label: undefined,
    expiresAt: alignNoon(base),
    remindOnExpiry: false,
    remindOffsetDays: 30,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("Family drawer renewals tab", () => {
  let dom: JSDOM | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.clearAllMocks();
    familyStore.__resetForTests();

    if (!("performance" in globalThis)) {
      (globalThis as any).performance = nodePerformance as unknown as Performance;
    }

    dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
    const { window } = dom;
    Object.assign(globalThis as any, {
      window,
      document: window.document,
      navigator: window.navigator,
      HTMLElement: window.HTMLElement,
      Node: window.Node,
    });

    originalSetTimeout = window.setTimeout;
    originalClearTimeout = window.clearTimeout;
    window.setTimeout = setTimeout as unknown as typeof window.setTimeout;
    window.clearTimeout = clearTimeout as unknown as typeof window.clearTimeout;

    vi.spyOn(familyStore.renewals, "list").mockResolvedValue([]);
  });

  afterEach(() => {
    window.setTimeout = originalSetTimeout;
    window.clearTimeout = originalClearTimeout;
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (dom) {
      dom.window.close();
      dom = null;
    }
    if (typeof document !== "undefined") {
      document.body.innerHTML = "";
    }
  });

  it("sorts renewals by expiry date", () => {
    const tab = createRenewalsTab();
    document.body.appendChild(tab.element);

    const member = buildMember();
    tab.setMember(member);
    tab.updateRenewals([
      buildRenewal("renewal-b", 40),
      buildRenewal("renewal-a", 10),
      buildRenewal("renewal-c", 10, { id: "renewal-c", expiresAt: alignNoon(Date.now() + 10 * 24 * 60 * 60 * 1000), updatedAt: Date.now() + 5 }),
    ]);

    const ids = Array.from(tab.element.querySelectorAll<HTMLTableRowElement>("tbody tr"))
      .map((row) => row.dataset.renewalId);

    expect(ids).toEqual(["renewal-a", "renewal-c", "renewal-b"]);
  });

  it("clamps the reminder offset and reports the status", () => {
    const tab = createRenewalsTab();
    document.body.appendChild(tab.element);

    const member = buildMember();
    tab.setMember(member);
    tab.updateRenewals([buildRenewal("renewal-a", 20)]);

    const offsetInput = tab.element.querySelector<HTMLInputElement>("tbody tr input[type=number]");
    expect(offsetInput).toBeTruthy();
    if (!offsetInput) return;

    offsetInput.value = "999";
    const changeEvent = new window.Event("change", { bubbles: true });
    offsetInput.dispatchEvent(changeEvent);

    expect(offsetInput.value).toBe("365");
    const liveRegion = tab.element.querySelector<HTMLDivElement>(".family-renewals__live");
    expect(liveRegion?.textContent).toContain("0 and 365");
  });

  it("autosaves edits and shows a success toast", async () => {
    const tab = createRenewalsTab();
    document.body.appendChild(tab.element);

    const member = buildMember();
    const renewal = buildRenewal("renewal-a", 45);
    tab.setMember(member);
    await Promise.resolve();
    tab.updateRenewals([renewal]);
    expect(tab.element.querySelectorAll("tbody tr")).toHaveLength(1);

    const toastSpy = vi.spyOn(toast, "show");
    const upsertSpy = vi
      .spyOn(familyStore.renewals, "upsert")
      .mockResolvedValue({ ...renewal, label: "Updated", updatedAt: renewal.updatedAt + 1 });

    const labelInput = tab.element.querySelector<HTMLInputElement>("tbody tr input[type=text]");
    expect(labelInput).toBeTruthy();
    if (!labelInput) return;

    const timersBefore = vi.getTimerCount();
    labelInput.value = "Updated";
    const inputEvent = new window.Event("input", { bubbles: true });
    labelInput.dispatchEvent(inputEvent);
    expect(vi.getTimerCount()).toBeGreaterThan(timersBefore);

    await tab.flushPending();

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledWith(
      member.id,
      expect.objectContaining({ label: "Updated", remindOnExpiry: renewal.remindOnExpiry }),
    );

    expect(toastSpy).toHaveBeenCalledWith({ kind: "success", message: "Saved." });
    upsertSpy.mockRestore();
    toastSpy.mockRestore();
  });
});

