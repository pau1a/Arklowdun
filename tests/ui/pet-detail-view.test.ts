import { strict as assert } from "node:assert";
import test, { mock } from "node:test";
import { JSDOM } from "jsdom";

const bootstrapDom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
(globalThis as any).window = bootstrapDom.window as unknown as typeof globalThis & Window;
(globalThis as any).document = bootstrapDom.window.document;
(globalThis as any).HTMLElement = bootstrapDom.window.HTMLElement;
(globalThis as any).Node = bootstrapDom.window.Node;

function resetDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  (globalThis as any).window = dom.window as unknown as typeof globalThis & Window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).Node = dom.window.Node;
  try {
    delete (globalThis as any).navigator;
  } catch {
    // ignore
  }
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
}

const waitForMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

test.beforeEach(() => {
  resetDom();
});

test.afterEach(() => {
  mock.restoreAll();
});

test("creating a medical record prepends the entry and focuses the date field", async () => {
  const householdModule = await import("../../src/db/household.ts");
  mock.method(householdModule, "getHouseholdIdForCalls", async () => "hh-test");

  const reposModule = await import("../../src/repos.ts");
  mock.method(reposModule.petMedicalRepo, "list", async () => [
    {
      id: "med-existing",
      pet_id: "pet-1",
      household_id: "hh-test",
      date: Date.UTC(2024, 0, 1),
      description: "Annual exam",
      reminder: null,
      document: null,
      relative_path: null,
      category: "pet_medical",
      created_at: Date.UTC(2024, 0, 1, 12),
      updated_at: Date.UTC(2024, 0, 1, 12),
      deleted_at: null,
      root_key: null,
    },
  ]);
  const createMock = mock.method(reposModule.petMedicalRepo, "create", async (_hh, data) => ({
    id: "med-new",
    pet_id: "pet-1",
    household_id: "hh-test",
    date: data.date ?? Date.UTC(2024, 4, 1),
    description: data.description ?? "",
    reminder: data.reminder ?? null,
    document: null,
    relative_path: data.relative_path ?? null,
    category: "pet_medical",
    created_at: Date.UTC(2024, 4, 1, 12),
    updated_at: Date.UTC(2024, 4, 1, 12),
    deleted_at: null,
    root_key: null,
  }));
  const updateMock = mock.method(reposModule.petsRepo, "update", async () => {});

  const toastModule = await import("../../src/ui/Toast.ts");
  const toastMock = mock.method(toastModule.toast, "show", () => {});

  const uiLogModule = await import("../../src/lib/uiLog.ts");
  const logMock = mock.method(uiLogModule, "logUI", () => {});

  const { PetDetailView } = await import("../../src/ui/pets/PetDetailView.ts");

  const container = document.createElement("div");
  let onChangeCalls = 0;
  await PetDetailView(
    container,
    {
      id: "pet-1",
      name: "Skye",
      type: "Dog",
      household_id: "hh-test",
      position: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    },
    () => {
      onChangeCalls += 1;
    },
    () => {},
  );

  const dateInput = container.querySelector<HTMLInputElement>("#pet-medical-date");
  const descInput = container.querySelector<HTMLTextAreaElement>("textarea[name=\"description\"]");
  const reminderInput = container.querySelector<HTMLInputElement>("input[name=\"reminder\"]");
  const documentInput = container.querySelector<HTMLInputElement>("input[name=\"document\"]");
  const form = container.querySelector<HTMLFormElement>(".pet-detail__form");
  assert.ok(dateInput && descInput && reminderInput && documentInput && form);

  dateInput.value = "2024-05-10";
  descInput.value = "Dental cleaning";
  reminderInput.value = "2024-05-15";
  documentInput.value = " ./records/dental.pdf ";

  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitForMicrotasks();
  await waitForMicrotasks();

  assert.equal(createMock.mock.calls.length, 1, "create call issued");
  const [, createPayload] = createMock.mock.calls[0].arguments as [string, any];
  assert.equal(createPayload.relative_path, "records/dental.pdf", "path sanitised before create");

  assert.equal(updateMock.mock.calls.length, 1, "pet update invoked to bump timestamp");
  assert.equal(onChangeCalls, 1, "parent onChange invoked");

  const firstRecord = container.querySelector<HTMLElement>(".pet-detail__record");
  assert.ok(firstRecord, "new record rendered");
  assert.match(firstRecord!.textContent ?? "", /Dental cleaning/);

  assert.equal(document.activeElement, dateInput, "date input regains focus after submit");
  assert.equal(toastMock.mock.calls.at(-1)?.arguments[0].kind, "success", "success toast shown");

  const createLog = logMock.mock.calls.find((call) => call.arguments[1] === "ui.pets.medical_create_success");
  assert.ok(createLog, "success log emitted");
});

test("deleting a record removes it and logs success", async () => {
  const householdModule = await import("../../src/db/household.ts");
  mock.method(householdModule, "getHouseholdIdForCalls", async () => "hh-test");

  const reposModule = await import("../../src/repos.ts");
  mock.method(reposModule.petMedicalRepo, "list", async () => [
    {
      id: "med-remove",
      pet_id: "pet-2",
      household_id: "hh-test",
      date: Date.UTC(2023, 6, 1),
      description: "Vaccination",
      reminder: null,
      document: null,
      relative_path: null,
      category: "pet_medical",
      created_at: Date.UTC(2023, 6, 1, 12),
      updated_at: Date.UTC(2023, 6, 1, 12),
      deleted_at: null,
      root_key: null,
    },
  ]);
  const deleteMock = mock.method(reposModule.petMedicalRepo, "delete", async () => {});
  const updateMock = mock.method(reposModule.petsRepo, "update", async () => {});

  const toastModule = await import("../../src/ui/Toast.ts");
  const toastMock = mock.method(toastModule.toast, "show", () => {});
  const uiLogModule = await import("../../src/lib/uiLog.ts");
  const logMock = mock.method(uiLogModule, "logUI", () => {});

  const { PetDetailView } = await import("../../src/ui/pets/PetDetailView.ts");

  const container = document.createElement("div");
  await PetDetailView(
    container,
    {
      id: "pet-2",
      name: "Echo",
      type: "Dog",
      household_id: "hh-test",
      position: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    },
    () => {},
    () => {},
  );

  const historyList = container.querySelector<HTMLDivElement>(".pet-detail__history-list");
  assert.ok(historyList);
  historyList.scrollTop = 42;

  const deleteBtn = container.querySelector<HTMLButtonElement>(".pet-detail__record-delete");
  assert.ok(deleteBtn);
  deleteBtn.click();
  await waitForMicrotasks();
  await waitForMicrotasks();

  assert.equal(deleteMock.mock.calls.length, 1, "delete invoked");
  assert.equal(updateMock.mock.calls.length, 1, "pet update invoked");
  assert.equal(container.querySelectorAll(".pet-detail__record").length, 0, "record removed from DOM");
  assert.equal(historyList.scrollTop, 42, "scroll position restored after delete");
  assert.equal(toastMock.mock.calls.at(-1)?.arguments[0].kind, "success", "success toast emitted");
  const deleteLog = logMock.mock.calls.find((call) => call.arguments[1] === "ui.pets.medical_delete_success");
  assert.ok(deleteLog, "delete success logged");
});

test("create failures surface mapped error toasts", async () => {
  const householdModule = await import("../../src/db/household.ts");
  mock.method(householdModule, "getHouseholdIdForCalls", async () => "hh-test");

  const reposModule = await import("../../src/repos.ts");
  mock.method(reposModule.petMedicalRepo, "list", async () => []);
  mock.method(reposModule.petMedicalRepo, "create", async () => {
    const error: any = new Error("invalid");
    error.code = "PATH_OUT_OF_VAULT";
    throw error;
  });
  mock.method(reposModule.petsRepo, "update", async () => {});

  const toastModule = await import("../../src/ui/Toast.ts");
  const toastMock = mock.method(toastModule.toast, "show", () => {});
  const uiLogModule = await import("../../src/lib/uiLog.ts");
  const logMock = mock.method(uiLogModule, "logUI", () => {});

  const { PetDetailView } = await import("../../src/ui/pets/PetDetailView.ts");
  const container = document.createElement("div");
  await PetDetailView(
    container,
    {
      id: "pet-3",
      name: "Nova",
      type: "Cat",
      household_id: "hh-test",
      position: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    },
    () => {},
    () => {},
  );

  const form = container.querySelector<HTMLFormElement>(".pet-detail__form");
  const dateInput = container.querySelector<HTMLInputElement>("#pet-medical-date");
  const descInput = container.querySelector<HTMLTextAreaElement>("textarea[name=\"description\"]");
  assert.ok(form && dateInput && descInput);
  dateInput.value = "2024-06-01";
  descInput.value = "Follow-up";

  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitForMicrotasks();
  await waitForMicrotasks();

  const lastToast = toastMock.mock.calls.at(-1)?.arguments[0];
  assert.ok(lastToast);
  assert.equal(lastToast.kind, "error");
  assert.match(lastToast.message, /vault/, "mapped message mentions vault path");

  const failLog = logMock.mock.calls.find((call) => call.arguments[1] === "ui.pets.medical_create_fail");
  assert.ok(failLog, "failure log emitted");
});

test("attachment actions delegate to helpers and emit logs", async () => {
  const householdModule = await import("../../src/db/household.ts");
  mock.method(householdModule, "getHouseholdIdForCalls", async () => "hh-test");

  const reposModule = await import("../../src/repos.ts");
  mock.method(reposModule.petMedicalRepo, "list", async () => [
    {
      id: "med-attach",
      pet_id: "pet-4",
      household_id: "hh-test",
      date: Date.UTC(2024, 2, 1),
      description: "X-ray",
      reminder: null,
      document: null,
      relative_path: "records/xray.pdf",
      category: "pet_medical",
      created_at: Date.UTC(2024, 2, 1, 12),
      updated_at: Date.UTC(2024, 2, 1, 12),
      deleted_at: null,
      root_key: null,
    },
  ]);
  mock.method(reposModule.petMedicalRepo, "create", async () => {
    throw new Error("unexpected create");
  });
  mock.method(reposModule.petsRepo, "update", async () => {});

  const attachmentsModule = await import("../../src/ui/attachments.ts");
  const openMock = mock.method(attachmentsModule, "openAttachment", async () => true);
  const revealMock = mock.method(attachmentsModule, "revealAttachment", async () => false);

  const uiLogModule = await import("../../src/lib/uiLog.ts");
  const logMock = mock.method(uiLogModule, "logUI", () => {});

  const { PetDetailView } = await import("../../src/ui/pets/PetDetailView.ts");

  const container = document.createElement("div");
  await PetDetailView(
    container,
    {
      id: "pet-4",
      name: "Indy",
      type: "Dog",
      household_id: "hh-test",
      position: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    },
    () => {},
    () => {},
  );

  const openBtn = container.querySelector<HTMLButtonElement>(".pet-detail__record-action");
  assert.ok(openBtn);
  openBtn.click();
  await waitForMicrotasks();

  const revealBtn = container.querySelectorAll<HTMLButtonElement>(".pet-detail__record-action")[1];
  assert.ok(revealBtn);
  revealBtn.click();
  await waitForMicrotasks();

  assert.equal(openMock.mock.calls.length, 1, "open helper invoked");
  assert.equal(revealMock.mock.calls.length, 1, "reveal helper invoked");

  const openLog = logMock.mock.calls.find((call) => call.arguments[1] === "ui.pets.attach_open");
  const revealLog = logMock.mock.calls.find((call) => call.arguments[1] === "ui.pets.attach_reveal");
  assert.ok(openLog, "open action logged");
  assert.ok(revealLog, "reveal action logged");
  assert.equal(openLog?.arguments[2]?.result, "ok", "open log captures success result");
  assert.equal(revealLog?.arguments[2]?.result, "error", "reveal log captures failure result");
});
