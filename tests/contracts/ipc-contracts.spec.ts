import assert from "node:assert/strict";
import test from "node:test";
import { TauriAdapter } from "../../src/lib/ipc/adapters/tauri";
import { TestAdapter } from "../../src/lib/ipc/adapters/test";
import { ScenarioLoader, type ScenarioDefinition } from "../../src/lib/ipc/scenarioLoader";
import { getContract } from "../../src/lib/ipc/port";

const householdResponse = {
  id: "h1",
  name: "Primary",
  is_default: 1,
  tz: "UTC",
  created_at: 1,
  updated_at: 2,
  deleted_at: null,
  color: "#AABBCC",
};

const eventResponse = {
  id: "evt-1",
  household_id: "h1",
  title: "Sync",
  start_at_utc: 0,
  end_at_utc: null,
  created_at: 0,
  updated_at: 0,
};

const notesResponse = {
  id: "note-1",
  household_id: "h1",
  position: 0,
  created_at: 0,
  updated_at: 0,
  text: "remember",
  color: "#FFD700",
  x: 0,
  y: 0,
};

const vehiclesResponse = {
  id: "veh-1",
  household_id: "h1",
  name: "Car",
  created_at: 0,
  updated_at: 0,
  position: 0,
};

const petResponse = {
  id: "pet-1",
  household_id: "h1",
  name: "Skye",
  type: "Dog",
  created_at: 0,
  updated_at: 0,
  deleted_at: null,
  position: 0,
};

const petMedicalResponse = {
  id: "med-1",
  household_id: "h1",
  pet_id: "pet-1",
  date: 0,
  description: "Booster",
  document: null,
  reminder: null,
  created_at: 0,
  updated_at: 0,
  deleted_at: null,
  root_key: null,
  relative_path: null,
  category: "pet_medical",
};

const eventsRangeResponse = {
  items: [eventResponse],
  truncated: false,
  limit: 100,
};

const scenarioDefinition: ScenarioDefinition = {
  name: "contract-parity",
  handlers: {
    household_create: async (payload) => {
      assert.equal(payload.args.color, "#AABBCC");
      return householdResponse;
    },
    household_update: async (payload) => {
      assert.equal(payload.args.id, "h1");
      assert.equal(payload.args.color, "#112233");
      return { ...householdResponse, color: "#112233" };
    },
    household_list: async () => [householdResponse],
    events_list_range: async (payload) => {
      assert.equal(payload.householdId, "h1");
      assert.equal(payload.start, 0);
      assert.equal(payload.end, 1);
      return eventsRangeResponse;
    },
    event_create: async () => eventResponse,
    notes_create: async (payload) => {
      assert.equal(payload.data.household_id, "h1");
      return notesResponse;
    },
    vehicles_create: async (payload) => {
      assert.equal(payload.data.household_id, "h1");
      return vehiclesResponse;
    },
    pets_list: async (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, "h1");
      return [petResponse];
    },
    pets_create: async (payload) => {
      assert.equal(payload.data.household_id, "h1");
      return petResponse;
    },
    pets_update: async (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, "h1");
      assert.equal(payload.id, "pet-1");
      return null;
    },
    pets_delete: async (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, "h1");
      assert.equal(payload.id, "pet-1");
      return null;
    },
    pets_restore: async (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, "h1");
      assert.equal(payload.id, "pet-1");
      return null;
    },
    pet_medical_list: async (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, "h1");
      return [petMedicalResponse];
    },
    pet_medical_create: async (payload) => {
      assert.equal(payload.data.household_id, "h1");
      assert.equal(payload.data.category, "pet_medical");
      return petMedicalResponse;
    },
    pet_medical_update: async (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, "h1");
      assert.equal(payload.id, "med-1");
      return null;
    },
    pet_medical_delete: async (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, "h1");
      assert.equal(payload.id, "med-1");
      return null;
    },
    pet_medical_restore: async (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, "h1");
      assert.equal(payload.id, "med-1");
      return null;
    },
  },
};

const loader = new ScenarioLoader(
  new Map([["contract-parity", scenarioDefinition]]),
);

const tauriResponses = new Map<
  string,
  {
    request: Record<string, unknown>;
    response: unknown;
  }
>();

function registerCommand(
  command: string,
  request: unknown,
  response: unknown,
): void {
  try {
    const contract = getContract(command as never);
    const parsedRequest = contract.request.parse(request ?? {});
    const parsedResponse = contract.response.parse(response);
    tauriResponses.set(command, {
      request: parsedRequest as Record<string, unknown>,
      response: parsedResponse,
    });
  } catch (error) {
    console.error(`Failed to register ${command}`, error);
    throw error;
  }
}

registerCommand("household_create", { args: { name: "Primary", color: "#aabbcc" } }, householdResponse);
registerCommand("household_update", { args: { id: "h1", color: "#112233" } }, { ...householdResponse, color: "#112233" });
registerCommand("household_list", { includeDeleted: false }, [householdResponse]);
registerCommand("events_list_range", { householdId: "h1", start: 0, end: 1 }, eventsRangeResponse);
registerCommand("event_create", { data: { household_id: "h1", title: "Sync", start_at_utc: 0 } }, eventResponse);
registerCommand(
  "notes_create",
  {
    data: {
      household_id: "h1",
      text: "remember",
      color: "#ffd700",
      x: 0,
      y: 0,
    },
  },
  notesResponse,
);
registerCommand(
  "vehicles_create",
  { data: { household_id: "h1", name: "Car" } },
  vehiclesResponse,
);
registerCommand(
  "pets_list",
  { householdId: "h1", orderBy: "position, created_at, id" },
  [petResponse],
);
registerCommand(
  "pets_create",
  { data: { household_id: "h1", name: "Skye", type: "Dog", position: 0 } },
  petResponse,
);
registerCommand(
  "pets_update",
  { id: "pet-1", householdId: "h1", data: { name: "Skye" } },
  null,
);
registerCommand("pets_delete", { id: "pet-1", householdId: "h1" }, null);
registerCommand("pets_restore", { id: "pet-1", householdId: "h1" }, null);
registerCommand(
  "pet_medical_list",
  { householdId: "h1", orderBy: "date DESC, created_at DESC, id" },
  [petMedicalResponse],
);
registerCommand(
  "pet_medical_create",
  {
    data: {
      household_id: "h1",
      pet_id: "pet-1",
      date: 0,
      description: "Booster",
      category: "pet_medical",
    },
  },
  petMedicalResponse,
);
registerCommand(
  "pet_medical_update",
  {
    id: "med-1",
    householdId: "h1",
    data: { description: "Booster" },
  },
  null,
);
registerCommand("pet_medical_delete", { id: "med-1", householdId: "h1" }, null);
registerCommand("pet_medical_restore", { id: "med-1", householdId: "h1" }, null);

const windowStub = {
  __TAURI__: {
    invoke: async (command: string, args?: Record<string, unknown>) => {
      const shape = tauriResponses.get(command);
      if (!shape) {
        throw new Error(`Unhandled command ${command}`);
      }
      assert.deepEqual(args ?? {}, shape.request, `${command} payload`);
      return shape.response;
    },
  },
};

(globalThis as unknown as { window: typeof windowStub }).window = windowStub;

const tauriAdapter = new TauriAdapter();
const testAdapter = new TestAdapter({ loader, scenarioName: "contract-parity" });

const parityCases: Array<{
  command: string;
  request: unknown;
}> = Array.from(tauriResponses.entries()).map(([command, { request }]) => ({
  command,
  request,
}));

test("test and tauri adapters honour identical contracts", async () => {
  for (const { command, request } of parityCases) {
    try {
      const testResult = await testAdapter.invoke(command as never, request as never);
      const tauriResult = await tauriAdapter.invoke(command as never, request as never);
      assert.deepEqual(testResult, tauriResult, `${command} response`);
    } catch (error) {
      console.error(`command ${command} failed`, error);
      throw error;
    }
  }
});
