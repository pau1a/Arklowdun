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

function makeMethodConfigurable<T extends object>(module: T, key: keyof T & string): void {
  const descriptor = Object.getOwnPropertyDescriptor(module, key);
  if (descriptor && !descriptor.configurable) {
    Object.defineProperty(module, key, { ...descriptor, configurable: true });
  }
}

test.beforeEach(() => {
  resetDom();
  (globalThis as any).__ARKLOWDUN_SKIP_ATTACHMENT_PROBE__ = true;
});

test.afterEach(() => {
  mock.restoreAll();
});

async function flushAsyncTasks(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await waitForMicrotasks();
  }
}

test("creating a medical record prepends the entry and focuses the date field", async () => {
  const householdModule = await import("../../src/db/household.ts");
  makeMethodConfigurable(householdModule, "getHouseholdIdForCalls");
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
  documentInput.value = " vet/records/dental.pdf ";

  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitForMicrotasks();
  await waitForMicrotasks();

  assert.equal(createMock.mock.calls.length, 1, "create call issued");
  const [, createPayload] = createMock.mock.calls[0].arguments as [string, any];
  assert.equal(createPayload.relative_path, "vet/records/dental.pdf", "path sanitised before create");

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

test("invalid attachment path shows inline error and never calls IPC", async () => {
  const householdModule = await import("../../src/db/household.ts");
  makeMethodConfigurable(householdModule, "getHouseholdIdForCalls");
  mock.method(householdModule, "getHouseholdIdForCalls", async () => "hh-test");

  const reposModule = await import("../../src/repos.ts");
  mock.method(reposModule.petMedicalRepo, "list", async () => []);
  const createMock = mock.method(reposModule.petMedicalRepo, "create", async () => {
    throw new Error("should not be called");
  });

  const toastModule = await import("../../src/ui/Toast.ts");
  mock.method(toastModule.toast, "show", () => {});

  const uiLogModule = await import("../../src/lib/uiLog.ts");
  mock.method(uiLogModule, "logUI", () => {});

  const { PetDetailView } = await import("../../src/ui/pets/PetDetailView.ts");

  const container = document.createElement("div");
  await PetDetailView(
    container,
    {
      id: "pet-guard",
      name: "Quill",
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
  const documentInput = container.querySelector<HTMLInputElement>("input[name=\"document\"]");
  assert.ok(form && dateInput && descInput && documentInput);

  dateInput.value = "2024-06-01";
  descInput.value = "Stitches";
  documentInput.value = "../escape.pdf";

  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitForMicrotasks();

  assert.equal(createMock.mock.calls.length, 0, "create should not be attempted");
  assert.equal(
    documentInput.validationMessage,
    "That file isn’t inside the app’s attachments folder.",
    "inline message matches guard copy",
  );
  assert.equal(documentInput.dataset.errorCode, "PATH_OUT_OF_VAULT");
});

test("deleting a record removes it and logs success", async () => {
  const householdModule = await import("../../src/db/household.ts");
  makeMethodConfigurable(householdModule, "getHouseholdIdForCalls");
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
  makeMethodConfigurable(householdModule, "getHouseholdIdForCalls");
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
  makeMethodConfigurable(householdModule, "getHouseholdIdForCalls");
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

test("missing attachment fix-path flow repairs the card in place", async () => {
  (globalThis as any).__ARKLOWDUN_SKIP_ATTACHMENT_PROBE__ = false;

  class ImmediateObserver {
    private readonly callback: IntersectionObserverCallback;

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as any);
    }

    unobserve() {}

    disconnect() {}
  }

  const originalObserver = (window as any).IntersectionObserver;
  (window as any).IntersectionObserver = ImmediateObserver as any;

  try {
    const householdModule = await import("../../src/db/household.ts");
    makeMethodConfigurable(householdModule, "getHouseholdIdForCalls");
    mock.method(householdModule, "getHouseholdIdForCalls", async () => "hh-missing");

    const reposModule = await import("../../src/repos.ts");
    const existingRecords = [
      {
        id: "med-missing",
        pet_id: "pet-10",
        household_id: "hh-missing",
        date: Date.UTC(2023, 5, 2),
        description: "Bloodwork",
        reminder: null,
        document: null,
        relative_path: "missing/report.pdf",
        category: "pet_medical",
        created_at: Date.UTC(2023, 5, 2, 12),
        updated_at: Date.UTC(2023, 5, 2, 12),
        deleted_at: null,
        root_key: null,
      },
      {
        id: "med-okay",
        pet_id: "pet-10",
        household_id: "hh-missing",
        date: Date.UTC(2023, 3, 20),
        description: "Wellness exam",
        reminder: null,
        document: null,
        relative_path: null,
        category: "pet_medical",
        created_at: Date.UTC(2023, 3, 20, 12),
        updated_at: Date.UTC(2023, 3, 20, 12),
        deleted_at: null,
        root_key: null,
      },
    ];
    mock.method(reposModule.petMedicalRepo, "list", async () => existingRecords);
    const updateRecordMock = mock.method(
      reposModule.petMedicalRepo,
      "update",
      async (_household, _id, payload) => {
        existingRecords[0] = { ...existingRecords[0], ...payload };
      },
    );
    mock.method(reposModule.petsRepo, "update", async () => {});

    const dialogModule = await import("../../src/lib/ipc/dialog.ts");
    makeMethodConfigurable(dialogModule, "open");
    const openDialogMock = mock.method(dialogModule, "open", async () => [
      "/vault/attachments/repaired/report.jpg",
    ]);

    const pathModule = await import("../../src/files/path.ts");
    makeMethodConfigurable(pathModule, "canonicalizeAndVerify");
    mock.method(pathModule, "canonicalizeAndVerify", async (input: string, scope: string) => {
      const ATTACH_BASE = "/vault/attachments";
      const APPDATA_BASE = "/appdata";
      if (scope === "attachments") {
        if (input === ".") {
          return { base: `${ATTACH_BASE}/`, realPath: `${ATTACH_BASE}/` };
        }
        const trimmed = input.replace(/^\/+/, "");
        return { base: `${ATTACH_BASE}/`, realPath: `${ATTACH_BASE}/${trimmed}` };
      }
      if (scope === "appData") {
        const trimmed = input.replace(/^\.+/, "").replace(/^\/+/, "");
        return { base: `${APPDATA_BASE}/`, realPath: `${APPDATA_BASE}/${trimmed}` };
      }
      throw new Error(`Unexpected scope ${scope}`);
    });

    const coreModule = await import("../../src/lib/ipc/core.ts");
    makeMethodConfigurable(coreModule, "convertFileSrc");
    mock.method(coreModule, "convertFileSrc", (path: string) => `test://${path}`);

    const diagnosticsModule = await import("../../src/diagnostics/runtime.ts");
    makeMethodConfigurable(diagnosticsModule, "updateDiagnosticsSection");
    mock.method(diagnosticsModule, "updateDiagnosticsSection", () => {});

    const ipcModule = await import("../../src/lib/ipc/call.ts");
    makeMethodConfigurable(ipcModule, "call");
    let existsCalls = 0;
    let thumbnailCalls = 0;
    const callMock = mock.method(ipcModule, "call", async (command: string) => {
      if (command === "files_exists") {
        existsCalls += 1;
        return { exists: existsCalls > 1 };
      }
      if (command === "thumbnails_get_or_create") {
        thumbnailCalls += 1;
        if (thumbnailCalls === 1) {
          return { ok: false, code: "UNSUPPORTED" };
        }
        return {
          ok: true,
          relative_thumb_path: ".thumbnails/repaired-hash-160.jpg",
          cache_hit: false,
          width: 120,
          height: 96,
          duration_ms: 7,
        };
      }
      if (command === "pets_diagnostics_counters") {
        return {
          pet_attachments_total: 1,
          pet_attachments_missing: existsCalls === 0 ? 0 : existsCalls === 1 ? 1 : 0,
          pet_thumbnails_built: thumbnailCalls > 1 ? 1 : 0,
          pet_thumbnails_cache_hits: 0,
          missing_attachments: [],
        };
      }
      throw new Error(`Unexpected IPC command ${command}`);
    });

    const toastModule = await import("../../src/ui/Toast.ts");
    mock.method(toastModule.toast, "show", () => {});

    const logModule = await import("../../src/lib/uiLog.ts");
    makeMethodConfigurable(logModule, "logUI");
    const logMock = mock.method(logModule, "logUI", () => {});

    const { PetDetailView } = await import("../../src/ui/pets/PetDetailView.ts");

    const container = document.createElement("div");
    await PetDetailView(
      container,
      {
        id: "pet-10",
        name: "Luna",
        type: "Dog",
        household_id: "hh-missing",
        position: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
      () => {},
      () => {},
    );

    await flushAsyncTasks();

    const missingCard = container.querySelector<HTMLElement>("[data-record-id=\"med-missing\"]");
    const stableCard = container.querySelector<HTMLElement>("[data-record-id=\"med-okay\"]");
    assert.ok(missingCard && stableCard, "both medical records render");

    const banner = missingCard!.querySelector<HTMLDivElement>(".pet-detail__record-missing");
    assert.ok(banner, "missing banner rendered");
    assert.equal(banner!.hidden, false, "missing banner visible after probe");

    const fixButton = missingCard!.querySelector<HTMLButtonElement>(".pet-detail__record-fix");
    assert.ok(fixButton, "fix path button present");

    const initialThumbnail = missingCard!.querySelector<HTMLDivElement>(".pet-detail__record-thumbnail");
    assert.ok(initialThumbnail, "thumbnail slot rendered");

    const missingLog = logMock.mock.calls.find((call) => call.arguments[1] === "ui.pets.attachment_missing");
    assert.ok(missingLog, "missing attachment logged once");

    const stableReference = stableCard;

    fixButton!.click();
    await flushAsyncTasks(5);

    assert.equal(openDialogMock.mock.calls.length, 1, "file dialog opened once");
    assert.equal(updateRecordMock.mock.calls.length, 1, "record update invoked");
    const updateArgs = updateRecordMock.mock.calls[0].arguments as [string, string, { relative_path: string }];
    assert.equal(updateArgs[2].relative_path, "repaired/report.jpg", "relative path sanitised before update");

    const afterThumbnail = missingCard!.querySelector<HTMLImageElement>(".pet-detail__record-thumbnail-image");
    assert.ok(afterThumbnail, "thumbnail image rendered after repair");
    assert.match(afterThumbnail!.src, /test:\/\//, "thumbnail src uses converted URL");

    assert.ok(!banner!.hidden, "banner remains visible until probe completes");

    await flushAsyncTasks(5);

    assert.equal(banner!.hidden, true, "banner hidden after successful probe");
    assert.equal(missingCard!.dataset.attachmentMissing, undefined, "missing state cleared");

    const reopenedCard = container.querySelector<HTMLElement>("[data-record-id=\"med-missing\"]");
    assert.strictEqual(reopenedCard, missingCard, "fixed record reused DOM node");
    const stableAfter = container.querySelector<HTMLElement>("[data-record-id=\"med-okay\"]");
    assert.strictEqual(stableAfter, stableReference, "unaffected record preserved");

    const fixOpenedLog = logMock.mock.calls.find((call) => call.arguments[1] === "ui.pets.attachment_fix_opened");
    const fixSuccessLog = logMock.mock.calls.find((call) => call.arguments[1] === "ui.pets.attachment_fixed");
    const builtLog = logMock.mock.calls.find((call) => call.arguments[1] === "ui.pets.thumbnail_built");
    assert.ok(fixOpenedLog, "fix-path opened telemetry emitted");
    assert.ok(fixSuccessLog, "fix-path success telemetry emitted");
    assert.ok(builtLog, "thumbnail build logged");

    assert.equal(
      callMock.mock.calls.filter((call) => call.arguments[0] === "files_exists").length,
      2,
      "files_exists called twice (before and after repair)",
    );
  } finally {
    if (originalObserver) {
      (window as any).IntersectionObserver = originalObserver;
    } else {
      delete (window as any).IntersectionObserver;
    }
  }
});

test("thumbnail cache hits emit the correct telemetry", async () => {
  (globalThis as any).__ARKLOWDUN_SKIP_ATTACHMENT_PROBE__ = false;

  class ImmediateObserver {
    private readonly callback: IntersectionObserverCallback;

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as any);
    }

    unobserve() {}

    disconnect() {}
  }

  const originalObserver = (window as any).IntersectionObserver;
  (window as any).IntersectionObserver = ImmediateObserver as any;

  try {
    const householdModule = await import("../../src/db/household.ts");
    makeMethodConfigurable(householdModule, "getHouseholdIdForCalls");
    mock.method(householdModule, "getHouseholdIdForCalls", async () => "hh-thumb");

    const reposModule = await import("../../src/repos.ts");
    mock.method(reposModule.petMedicalRepo, "list", async () => [
      {
        id: "med-thumb",
        pet_id: "pet-11",
        household_id: "hh-thumb",
        date: Date.UTC(2024, 0, 15),
        description: "Radiograph",
        reminder: null,
        document: null,
        relative_path: "records/radiograph.jpg",
        category: "pet_medical",
        created_at: Date.UTC(2024, 0, 15, 12),
        updated_at: Date.UTC(2024, 0, 15, 12),
        deleted_at: null,
        root_key: null,
      },
    ]);
    mock.method(reposModule.petMedicalRepo, "update", async () => {});
    mock.method(reposModule.petsRepo, "update", async () => {});

    const pathModule = await import("../../src/files/path.ts");
    makeMethodConfigurable(pathModule, "canonicalizeAndVerify");
    mock.method(pathModule, "canonicalizeAndVerify", async (input: string, scope: string) => {
      const ATTACH_BASE = "/vault/attachments";
      const APPDATA_BASE = "/appdata";
      if (scope === "attachments") {
        if (input === ".") {
          return { base: `${ATTACH_BASE}/`, realPath: `${ATTACH_BASE}/` };
        }
        const trimmed = input.replace(/^\/+/, "");
        return { base: `${ATTACH_BASE}/`, realPath: `${ATTACH_BASE}/${trimmed}` };
      }
      if (scope === "appData") {
        const trimmed = input.replace(/^\.+/, "").replace(/^\/+/, "");
        return { base: `${APPDATA_BASE}/`, realPath: `${APPDATA_BASE}/${trimmed}` };
      }
      throw new Error(`Unexpected scope ${scope}`);
    });

    const coreModule = await import("../../src/lib/ipc/core.ts");
    makeMethodConfigurable(coreModule, "convertFileSrc");
    mock.method(coreModule, "convertFileSrc", (path: string) => `cache://${path}`);

    const diagnosticsModule = await import("../../src/diagnostics/runtime.ts");
    makeMethodConfigurable(diagnosticsModule, "updateDiagnosticsSection");
    mock.method(diagnosticsModule, "updateDiagnosticsSection", () => {});

    const ipcModule = await import("../../src/lib/ipc/call.ts");
    makeMethodConfigurable(ipcModule, "call");
    let existsCalls = 0;
    mock.method(ipcModule, "call", async (command: string) => {
      if (command === "files_exists") {
        existsCalls += 1;
        return { exists: true };
      }
      if (command === "thumbnails_get_or_create") {
        return {
          ok: true,
          relative_thumb_path: ".thumbnails/cache-hit-160.jpg",
          cache_hit: true,
          width: 144,
          height: 144,
          duration_ms: 3,
        };
      }
      if (command === "pets_diagnostics_counters") {
        return {
          pet_attachments_total: 1,
          pet_attachments_missing: 0,
          pet_thumbnails_built: 0,
          pet_thumbnails_cache_hits: 1,
          missing_attachments: [],
        };
      }
      throw new Error(`Unexpected IPC command ${command}`);
    });

    const toastModule = await import("../../src/ui/Toast.ts");
    mock.method(toastModule.toast, "show", () => {});

    const logModule = await import("../../src/lib/uiLog.ts");
    makeMethodConfigurable(logModule, "logUI");
    const logMock = mock.method(logModule, "logUI", () => {});

    const { PetDetailView } = await import("../../src/ui/pets/PetDetailView.ts");

    const container = document.createElement("div");
    await PetDetailView(
      container,
      {
        id: "pet-11",
        name: "Mo",
        type: "Cat",
        household_id: "hh-thumb",
        position: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
      () => {},
      () => {},
    );

    await flushAsyncTasks(4);

    const image = container.querySelector<HTMLImageElement>(".pet-detail__record-thumbnail-image");
    assert.ok(image, "thumbnail image rendered for cached asset");
    assert.match(image!.src, /cache:\/\//, "cached thumbnail uses converted URL");

    const cacheLog = logMock.mock.calls.find((call) => call.arguments[1] === "ui.pets.thumbnail_cache_hit");
    assert.ok(cacheLog, "cache-hit telemetry emitted");
    const buildLog = logMock.mock.calls.find((call) => call.arguments[1] === "ui.pets.thumbnail_built");
    assert.equal(buildLog, undefined, "no build log recorded for cache hit");

    assert.equal(
      container.querySelectorAll(".pet-detail__record").length,
      1,
      "single record rendered without duplication",
    );
    assert.equal(existsCalls, 1, "files_exists probed once");
  } finally {
    if (originalObserver) {
      (window as any).IntersectionObserver = originalObserver;
    } else {
      delete (window as any).IntersectionObserver;
    }
  }
});
