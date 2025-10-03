/* eslint-disable security/detect-object-injection -- test doubles index controlled listener maps */
import { beforeEach, describe, expect, it, vi } from "vitest";

const eventListeners: Record<
  string,
  (event: { payload: { id: string } }) => void
> = {};

const listenMock = vi.fn(
  async (
    event: string,
    callback: (event: { payload: { id: string } }) => void,
  ) => {
    eventListeners[event] = callback;
    return () => {
      delete eventListeners[event];
    };
  },
);

const getActiveHouseholdIdMock = vi.fn<[], Promise<string>>();
const setActiveHouseholdIdMock = vi.fn<
  [string],
  Promise<
    | { ok: true }
    | {
        ok: false;
        code:
          | "HOUSEHOLD_NOT_FOUND"
          | "HOUSEHOLD_DELETED"
          | "HOUSEHOLD_ALREADY_ACTIVE";
      }
  >
>();
const emitMock = vi.fn<[string, { householdId: string }], void>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("../api/households", () => ({
  getActiveHouseholdId: getActiveHouseholdIdMock,
  setActiveHouseholdId: setActiveHouseholdIdMock,
}));

vi.mock("../store/events", () => ({
  emit: emitMock,
}));

describe("householdStore", () => {
  beforeEach(() => {
    vi.resetModules();
    getActiveHouseholdIdMock.mockReset();
    setActiveHouseholdIdMock.mockReset();
    emitMock.mockReset();
    listenMock.mockClear();
    for (const key of Object.keys(eventListeners)) {
      delete eventListeners[key];
    }
  });

  it("caches the active household id", async () => {
    getActiveHouseholdIdMock.mockResolvedValue("hh-test");
    setActiveHouseholdIdMock.mockResolvedValue({ ok: true });
    const store = await import("./householdStore");
    const first = await store.ensureActiveHousehold();
    const second = await store.ensureActiveHousehold();
    expect(first).toBe("hh-test");
    expect(second).toBe("hh-test");
    expect(getActiveHouseholdIdMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledTimes(1);
  });

  it("updates cache when the native event arrives", async () => {
    getActiveHouseholdIdMock.mockResolvedValue("hh-one");
    setActiveHouseholdIdMock.mockResolvedValue({ ok: true });
    const store = await import("./householdStore");
    await store.ensureActiveHousehold();
    const listener = eventListeners["household:changed"];
    expect(listener).toBeDefined();
    listener?.({ payload: { id: "hh-two" } });
    expect(emitMock).toHaveBeenCalledWith("household:changed", {
      householdId: "hh-two",
    });
    const next = await store.ensureActiveHousehold();
    expect(next).toBe("hh-two");
    expect(getActiveHouseholdIdMock).toHaveBeenCalledTimes(1);
  });

  it("keeps existing cache when the native set fails", async () => {
    getActiveHouseholdIdMock.mockResolvedValue("hh-active");
    setActiveHouseholdIdMock.mockResolvedValue({
      ok: false,
      code: "HOUSEHOLD_DELETED",
    });
    const store = await import("./householdStore");
    await store.ensureActiveHousehold();
    const result = await store.forceSetActiveHousehold("hh-deleted");
    expect(result).toEqual({ ok: false, code: "HOUSEHOLD_DELETED" });
    const still = await store.ensureActiveHousehold();
    expect(still).toBe("hh-active");
  });
});
