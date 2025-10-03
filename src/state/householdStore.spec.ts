/* eslint-disable security/detect-object-injection -- test doubles index controlled listener maps */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { eventListeners, listenMock } = vi.hoisted(() => {
  interface HouseholdEvent {
    payload: { id: string };
  }

  const listeners: Record<string, (event: HouseholdEvent) => void> = {};

  const listenerMock = vi.fn(
    async (event: string, callback: (event: HouseholdEvent) => void) => {
      listeners[event] = callback;
      return () => {
        delete listeners[event];
      };
    },
  );

  return { eventListeners: listeners, listenMock: listenerMock };
});

type TestHousehold = {
  id: string;
  name: string;
  isDefault: boolean;
  tz: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  deletedAt: number | null;
  color: string | null;
};

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
const listHouseholdsMock = vi.fn<[boolean?], Promise<TestHousehold[]>>();
const createHouseholdMock = vi.fn<
  [string, string | null],
  Promise<TestHousehold>
>();
const updateHouseholdMock = vi.fn<
  [string, { name?: string; color?: string | null }],
  Promise<TestHousehold>
>();
const deleteHouseholdMock = vi.fn<
  [string],
  Promise<{ fallbackId: string | null }>
>();
const restoreHouseholdMock = vi.fn<[string], Promise<TestHousehold>>();
const emitMock = vi.fn<[string, { householdId: string }], void>();

  vi.mock("@tauri-apps/api/event", () => ({
    listen: listenMock,
  }));

vi.mock("../api/households", () => ({
  getActiveHouseholdId: getActiveHouseholdIdMock,
  setActiveHouseholdId: setActiveHouseholdIdMock,
  listHouseholds: listHouseholdsMock,
  createHousehold: createHouseholdMock,
  updateHousehold: updateHouseholdMock,
  deleteHousehold: deleteHouseholdMock,
  restoreHousehold: restoreHouseholdMock,
}));

vi.mock("../store/events", () => ({
  emit: emitMock,
}));

describe("householdStore", () => {
  beforeEach(() => {
    vi.resetModules();
    getActiveHouseholdIdMock.mockReset();
    setActiveHouseholdIdMock.mockReset();
    listHouseholdsMock.mockReset();
    createHouseholdMock.mockReset();
    updateHouseholdMock.mockReset();
    deleteHouseholdMock.mockReset();
    restoreHouseholdMock.mockReset();
    emitMock.mockReset();
    listenMock.mockClear();
    for (const key of Object.keys(eventListeners)) {
      delete eventListeners[key];
    }
  });

  function household(
    id: string,
    overrides: Partial<TestHousehold> = {},
  ): TestHousehold {
    return {
      id,
      name: id,
      isDefault: false,
      tz: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      color: null,
      ...overrides,
    };
  }

  it("caches the active household id", async () => {
    getActiveHouseholdIdMock.mockResolvedValue("hh-test");
    setActiveHouseholdIdMock.mockResolvedValue({ ok: true });
    listHouseholdsMock.mockResolvedValue([]);
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
    listHouseholdsMock.mockResolvedValue([]);
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
    listHouseholdsMock.mockResolvedValue([]);
    const store = await import("./householdStore");
    await store.ensureActiveHousehold();
    const result = await store.forceSetActiveHousehold("hh-deleted");
    expect(result).toEqual({ ok: false, code: "HOUSEHOLD_DELETED" });
    const still = await store.ensureActiveHousehold();
    expect(still).toBe("hh-active");
  });

  it("refreshes the list after create", async () => {
    const initial = [household("0", { isDefault: true })];
    const created = household("hh-created", { name: "Created" });
    listHouseholdsMock.mockResolvedValueOnce(initial);
    const store = await import("./householdStore");
    await store.refreshHouseholds();
    expect(store.getState().households).toEqual(initial);

    createHouseholdMock.mockResolvedValue(created);
    const after = [...initial, created];
    listHouseholdsMock.mockResolvedValueOnce(after);

    await store.createHousehold("Created", null);
    expect(createHouseholdMock).toHaveBeenCalledWith("Created", null);
    expect(listHouseholdsMock).toHaveBeenCalledTimes(2);
    expect(store.getState().households).toEqual(after);
  });

  it("updates the store after rename", async () => {
    const original = [
      household("0", { isDefault: true, name: "Default" }),
      household("hh-two", { name: "Original" }),
    ];
    listHouseholdsMock.mockResolvedValueOnce(original);
    const store = await import("./householdStore");
    await store.refreshHouseholds();

    const updated = household("hh-two", { name: "Renamed" });
    updateHouseholdMock.mockResolvedValue(updated);
    listHouseholdsMock.mockResolvedValueOnce([
      original[0],
      updated,
    ]);

    await store.updateHousehold("hh-two", { name: "Renamed" });
    expect(updateHouseholdMock).toHaveBeenCalledWith("hh-two", {
      name: "Renamed",
    });
    expect(store.getState().households).toEqual([original[0], updated]);
  });

  it("handles delete fallback", async () => {
    const initial = [
      household("0", { isDefault: true, name: "Default" }),
      household("hh-two", { name: "Secondary" }),
    ];
    listHouseholdsMock.mockResolvedValueOnce(initial);
    getActiveHouseholdIdMock.mockResolvedValue("hh-two");
    const store = await import("./householdStore");
    await store.ensureActiveHousehold();
    await store.refreshHouseholds();

    deleteHouseholdMock.mockResolvedValue({ fallbackId: "0" });
    const after = [
      { ...initial[0] },
      { ...initial[1], deletedAt: 10, updatedAt: 10 },
    ];
    listHouseholdsMock.mockResolvedValueOnce(after);

    await store.deleteHousehold("hh-two");
    expect(deleteHouseholdMock).toHaveBeenCalledWith("hh-two");
    expect(store.currentActiveHousehold()).toBe("0");
    expect(emitMock).toHaveBeenCalledWith("household:changed", {
      householdId: "0",
    });
    expect(store.getState().households).toEqual(after);
  });

  it("restores a deleted household", async () => {
    const deleted = household("hh-three", { deletedAt: 5 });
    const initial = [household("0", { isDefault: true }), deleted];
    listHouseholdsMock.mockResolvedValueOnce(initial);
    const store = await import("./householdStore");
    await store.refreshHouseholds();

    const restored = { ...deleted, deletedAt: null };
    restoreHouseholdMock.mockResolvedValue(restored);
    listHouseholdsMock.mockResolvedValueOnce([initial[0], restored]);

    await store.restoreHousehold("hh-three");
    expect(restoreHouseholdMock).toHaveBeenCalledWith("hh-three");
    expect(store.getState().households).toEqual([initial[0], restored]);
  });

  it("exposes selectors for deleted households", async () => {
    const deleted = household("hh-deleted", { deletedAt: 123 });
    const active = household("hh-active");
    listHouseholdsMock.mockResolvedValueOnce([active, deleted]);
    const store = await import("./householdStore");
    await store.refreshHouseholds();

    store.setShowDeleted(false);
    expect(store.selectors.deletedHouseholds(store.getState())).toEqual([]);

    store.setShowDeleted(true);
    expect(store.selectors.deletedHouseholds(store.getState())).toEqual([
      deleted,
    ]);
    expect(store.selectors.allHouseholds(store.getState())).toEqual([
      active,
      deleted,
    ]);
  });
});
