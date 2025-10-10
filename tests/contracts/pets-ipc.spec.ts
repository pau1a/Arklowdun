import assert from "node:assert/strict";
import test from "node:test";
import { configureIpcAdapter } from "../../src/lib/ipc/provider";
import { ScenarioLoader, type ScenarioDefinition } from "../../src/lib/ipc/scenarioLoader";

const HOUSEHOLD_ID = "hh-main";

const pets = [
  {
    id: "pet-1",
    household_id: HOUSEHOLD_ID,
    name: "Skye",
    type: "Dog",
    position: 0,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
  },
];

const medicalRecords = [
  {
    id: "med-1",
    household_id: HOUSEHOLD_ID,
    pet_id: "pet-1",
    date: 2,
    description: "Initial check",
    document: null,
    reminder: null,
    created_at: 2,
    updated_at: 2,
    deleted_at: null,
    root_key: null,
    relative_path: null,
    category: "pet_medical" as const,
  },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const scenarioDefinition: ScenarioDefinition = {
  name: "pets-contracts",
  handlers: {
    household_get_active: () => HOUSEHOLD_ID,
    db_files_index_ready: (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, HOUSEHOLD_ID);
      return true;
    },
    db_has_vehicle_columns: () => true,
    db_has_pet_columns: () => true,
    pets_list: (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, HOUSEHOLD_ID);
      return pets.filter((pet) => pet.deleted_at == null).map(clone);
    },
    pets_create: (payload) => {
      assert.equal(payload.data.household_id, HOUSEHOLD_ID);
      const now = Date.now();
      const record = {
        id: `pet-${pets.length + 1}`,
        household_id: HOUSEHOLD_ID,
        name: payload.data.name,
        type: payload.data.type,
        position:
          typeof payload.data.position === "number" ? payload.data.position : pets.length,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      pets.push(record);
      return clone(record);
    },
    pets_update: (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, HOUSEHOLD_ID);
      const record = pets.find((pet) => pet.id === payload.id);
      assert.ok(record, "pet exists for update");
      Object.assign(record!, payload.data, { updated_at: Date.now() });
      return null;
    },
    pets_delete: (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, HOUSEHOLD_ID);
      const record = pets.find((pet) => pet.id === payload.id);
      assert.ok(record, "pet exists for delete");
      record!.deleted_at = Date.now();
      return null;
    },
    pets_restore: (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, HOUSEHOLD_ID);
      const record = pets.find((pet) => pet.id === payload.id);
      assert.ok(record, "pet exists for restore");
      record!.deleted_at = null;
      record!.position += 1_000_000;
      record!.updated_at = Date.now();
      return null;
    },
    pet_medical_list: (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, HOUSEHOLD_ID);
      return medicalRecords
        .filter((record) => record.deleted_at == null)
        .map(clone);
    },
    pet_medical_create: (payload) => {
      assert.equal(payload.data.household_id, HOUSEHOLD_ID);
      const now = Date.now();
      const record = {
        id: `med-${medicalRecords.length + 1}`,
        household_id: HOUSEHOLD_ID,
        pet_id: payload.data.pet_id,
        date: payload.data.date,
        description: payload.data.description,
        document: payload.data.document ?? null,
        reminder: payload.data.reminder ?? null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        root_key: payload.data.root_key ?? null,
        relative_path: payload.data.relative_path ?? null,
        category: "pet_medical" as const,
      };
      medicalRecords.push(record);
      return clone(record);
    },
    pet_medical_update: (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, HOUSEHOLD_ID);
      const record = medicalRecords.find((item) => item.id === payload.id);
      assert.ok(record, "medical record exists for update");
      Object.assign(record!, payload.data, { updated_at: Date.now() });
      return null;
    },
    pet_medical_delete: (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, HOUSEHOLD_ID);
      const record = medicalRecords.find((item) => item.id === payload.id);
      assert.ok(record, "medical record exists for delete");
      record!.deleted_at = Date.now();
      return null;
    },
    pet_medical_restore: (payload) => {
      assert.equal(payload.household_id ?? payload.householdId, HOUSEHOLD_ID);
      const record = medicalRecords.find((item) => item.id === payload.id);
      assert.ok(record, "medical record exists for restore");
      record!.deleted_at = null;
      record!.updated_at = Date.now();
      return null;
    },
  },
};

const loader = new ScenarioLoader(new Map([[scenarioDefinition.name, scenarioDefinition]]));

test("pets IPC contracts round-trip through repos", async () => {
  configureIpcAdapter("fake", { loader, scenarioName: scenarioDefinition.name });
  const { petsRepo, petMedicalRepo } = await import("../../src/repos.ts");

  const initialPets = await petsRepo.list({ householdId: HOUSEHOLD_ID });
  assert.equal(initialPets.length, 1);
  assert.equal(initialPets[0].name, "Skye");

  const createdPet = await petsRepo.create(HOUSEHOLD_ID, {
    name: "Nova",
    type: "Cat",
    position: 5,
  });
  assert.equal(createdPet.name, "Nova");
  assert.equal(createdPet.type, "Cat");

  await petsRepo.update(HOUSEHOLD_ID, createdPet.id, { name: "Nova Prime" });
  const updatedPet = pets.find((pet) => pet.id === createdPet.id);
  assert.equal(updatedPet?.name, "Nova Prime");

  await petsRepo.delete(HOUSEHOLD_ID, createdPet.id);
  assert.notEqual(updatedPet?.deleted_at, null);

  await petsRepo.restore(HOUSEHOLD_ID, createdPet.id);
  assert.equal(updatedPet?.deleted_at, null);

  const medicalList = await petMedicalRepo.list({ householdId: HOUSEHOLD_ID });
  assert.equal(medicalList.length, 1);
  assert.equal(medicalList[0].description, "Initial check");

  const createdMedical = await petMedicalRepo.create(HOUSEHOLD_ID, {
    pet_id: createdPet.id,
    date: Date.now(),
    description: "Booster shot",
  });
  assert.equal(createdMedical.category, "pet_medical");

  await petMedicalRepo.update(HOUSEHOLD_ID, createdMedical.id, {
    description: "Updated booster",
  });
  const updatedMedical = medicalRecords.find((entry) => entry.id === createdMedical.id);
  assert.equal(updatedMedical?.description, "Updated booster");

  await petMedicalRepo.delete(HOUSEHOLD_ID, createdMedical.id);
  assert.notEqual(updatedMedical?.deleted_at, null);

  await petMedicalRepo.restore(HOUSEHOLD_ID, createdMedical.id);
  assert.equal(updatedMedical?.deleted_at, null);
});
