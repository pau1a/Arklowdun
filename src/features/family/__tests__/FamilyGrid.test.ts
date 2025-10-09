import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { performance as nodePerformance } from "node:perf_hooks";

vi.mock("@lib/uiLog", () => ({
  logUI: vi.fn(),
}));

import type { FamilyMember } from "../family.types";
import { createFamilyGrid } from "../FamilyGrid";

const { logUI } = await import("@lib/uiLog");

function buildMember(index: number): FamilyMember {
  return {
    id: `member-${index}`,
    householdId: "house-1",
    name: `Member ${index}`,
    nickname: index % 2 === 0 ? `Nick ${index}` : undefined,
    relationship: index % 3 === 0 ? "Sibling" : undefined,
    birthday: Date.UTC(1990, index % 12, (index % 27) + 1),
    notes: "",
    position: index,
    createdAt: index,
    keyholder: false,
    status: "active",
  } as FamilyMember;
}

describe("FamilyGrid", () => {
  let dom: JSDOM | null = null;
  let debugSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();

    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    if (!("performance" in globalThis)) {
      (globalThis as typeof globalThis & { performance: typeof nodePerformance }).performance =
        nodePerformance;
    }

    dom = new JSDOM("<!doctype html><html><body></body></html>", {
      pretendToBeVisual: true,
    });

    const { window } = dom;
    const raf =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (cb: FrameRequestCallback) => window.setTimeout(() => cb(nodePerformance.now()), 16);
    const caf =
      typeof window.cancelAnimationFrame === "function"
        ? window.cancelAnimationFrame.bind(window)
        : (id: number) => window.clearTimeout(id);
    Object.assign(globalThis, {
      window,
      document: window.document,
      navigator: window.navigator,
      HTMLElement: window.HTMLElement,
      Node: window.Node,
      KeyboardEvent: window.KeyboardEvent,
      requestAnimationFrame: raf,
      cancelAnimationFrame: caf,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (dom) {
      dom.window.close();
      dom = null;
    }
    debugSpy?.mockRestore();
    debugSpy = null;
    if (typeof document !== "undefined") {
      document.body.innerHTML = "";
    }
    delete (globalThis as Partial<typeof globalThis>).window;
    delete (globalThis as Partial<typeof globalThis>).document;
    delete (globalThis as Partial<typeof globalThis>).navigator;
    delete (globalThis as Partial<typeof globalThis>).HTMLElement;
    delete (globalThis as Partial<typeof globalThis>).Node;
    delete (globalThis as Partial<typeof globalThis>).KeyboardEvent;
    delete (globalThis as Partial<typeof globalThis>).requestAnimationFrame;
    delete (globalThis as Partial<typeof globalThis>).cancelAnimationFrame;
  });

  it("renders within the performance budget for 200 cards", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const members = Array.from({ length: 200 }, (_, index) => buildMember(index));

    const baselineHost = document.createElement("div");
    document.body.appendChild(baselineHost);
    const baselineStart = performance.now();
    const baselineFragment = document.createDocumentFragment();
    for (let index = 0; index < 200; index += 1) {
      const button = document.createElement("button");
      button.textContent = `Baseline ${index}`;
      baselineFragment.appendChild(button);
    }
    baselineHost.appendChild(baselineFragment);
    const baselineDuration = performance.now() - baselineStart;
    baselineHost.remove();

    const start = performance.now();
    const grid = createFamilyGrid(host, { members, householdId: "house-1" });
    const duration = performance.now() - start;
    const normalisedDuration = Math.max(0, duration - baselineDuration);

    // Allow a buffer for the JSDOM test environment overhead.
    expect(normalisedDuration).toBeLessThanOrEqual(240);
    expect(grid.element.querySelectorAll(".family-card")).toHaveLength(200);
    expect(logUI).toHaveBeenCalledWith("INFO", "ui.family.grid.render", {
      count: 200,
      household_id: "house-1",
    });
  });

  it("supports keyboard activation", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const members = [buildMember(1), buildMember(2)];
    const onSelect = vi.fn();
    createFamilyGrid(host, { members, onSelect, householdId: "house-1" });

    const cards = host.querySelectorAll<HTMLButtonElement>(".family-card");
    expect(cards).toHaveLength(2);

    cards[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
    let [selectedMember, context] = onSelect.mock.calls[0];
    expect(selectedMember.id).toBe("member-1");
    expect(context.scrollTop).toBe(0);

    cards[1].dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
    );

    expect(onSelect).toHaveBeenCalledTimes(2);
    [selectedMember, context] = onSelect.mock.calls[1];
    expect(selectedMember.id).toBe("member-2");
    expect(context.scrollTop).toBe(0);
  });

  it("marks the grid as a list for assistive technology", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const members = Array.from({ length: 200 }, (_, index) => buildMember(index));

    createFamilyGrid(host, { members, householdId: "house-1" });

    const list = host.querySelector('[role="list"]');
    expect(list).toBeTruthy();

    const listItems = host.querySelectorAll('[role="listitem"]');
    expect(listItems).toHaveLength(200);
  });

  it("restores scroll position after selection", async () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.appendChild(host);

    const members = Array.from({ length: 10 }, (_, index) => buildMember(index));
    const onSelect = vi.fn((_, ctx) => {
      expect(ctx.scrollTop).toBe(120);
      ctx.restoreScroll();
    });

    const grid = createFamilyGrid(host, { members, onSelect, householdId: "house-1" });
    grid.setScrollPosition(120);

    const firstCard = host.querySelector<HTMLButtonElement>(".family-card");
    expect(firstCard).not.toBeNull();
    firstCard!.click();

    await vi.runAllTimersAsync();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(grid.getScrollPosition()).toBe(120);
  });

  it("restores focus to the active member after updates", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const members = [buildMember(0), buildMember(1), buildMember(2)];
    const grid = createFamilyGrid(host, { members, householdId: "house-1" });

    const firstCard = host.querySelector<HTMLButtonElement>(".family-card");
    expect(firstCard).not.toBeNull();
    firstCard!.focus();

    expect(document.activeElement).toBe(firstCard);

    const updatedMembers = members.map((member) => ({ ...member }));
    grid.update(updatedMembers);

    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    const activeElement = document.activeElement as HTMLButtonElement | null;
    expect(activeElement?.dataset.memberId).toBe("member-0");
  });
});

