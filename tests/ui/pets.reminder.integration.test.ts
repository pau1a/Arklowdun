import { strict as assert } from "node:assert";
import test, { mock } from "node:test";
import FakeTimers from "@sinonjs/fake-timers";

import { reminderScheduler, __testing } from "../../src/features/pets/reminderScheduler";
import * as notificationModule from "../../src/lib/ipc/notification";
import * as uiLogModule from "../../src/lib/uiLog";

const MAX_TIMEOUT = 2_147_483_647;

test.beforeEach(() => {
  __testing.reset();
});

test.afterEach(() => {
  mock.restoreAll();
});

function installClock(now: number) {
  return FakeTimers.install({
    now,
    toFake: ["setTimeout", "clearTimeout", "Date"],
  });
}

function stubPermission(granted: boolean) {
  mock.method(notificationModule, "isPermissionGranted", async () => granted);
  mock.method(notificationModule, "requestPermission", async () => (granted ? "granted" : "denied"));
}

function baseRecords(now: number) {
  const recordA = {
    medical_id: "med-a",
    pet_id: "pet-a",
    date: "2025-02-01",
    reminder_at: new Date(now + 30_000).toISOString(),
    description: "Grooming",
    pet_name: "Echo",
  };
  const recordB = {
    medical_id: "med-b",
    pet_id: "pet-b",
    date: "2025-02-05",
    reminder_at: new Date(now + MAX_TIMEOUT).toISOString(),
    description: "Booster",
    pet_name: "Indy",
  };
  return {
    records: [recordA, recordB],
    petNames: { "pet-a": "Echo", "pet-b": "Indy" },
  };
}

test("mount → unmount → mount keeps timer counts stable", async () => {
  const baseNow = Date.UTC(2025, 0, 1, 8, 0, 0);
  const clock = installClock(baseNow);
  try {
    stubPermission(true);
    mock.method(notificationModule, "sendNotification", async () => {});
    mock.method(uiLogModule, "logUI", () => {});

    const { records, petNames } = baseRecords(baseNow);

    reminderScheduler.init();
    reminderScheduler.scheduleMany(records, { householdId: "hh-1", petNames });
    await __testing.waitForIdle();
    const initial = reminderScheduler.stats().activeTimers;
    assert.equal(initial > 0, true);

    reminderScheduler.cancelAll();
    assert.equal(reminderScheduler.stats().activeTimers, 0);

    reminderScheduler.init();
    reminderScheduler.scheduleMany(records, { householdId: "hh-1", petNames });
    await __testing.waitForIdle();
    assert.equal(reminderScheduler.stats().activeTimers, initial);
  } finally {
    clock.uninstall();
  }
});

test("firing a reminder emits reminder_fired log", async () => {
  const baseNow = Date.UTC(2025, 0, 2, 9, 0, 0);
  const clock = installClock(baseNow);
  try {
    stubPermission(true);
    mock.method(notificationModule, "sendNotification", async () => {});
    const logMock = mock.method(uiLogModule, "logUI", () => {});

    const record = {
      medical_id: "med-fire",
      pet_id: "pet-fire",
      date: "2025-02-10",
      reminder_at: new Date(baseNow + 5_000).toISOString(),
      description: "Wellness exam",
      pet_name: "Harper",
    };

    reminderScheduler.init();
    reminderScheduler.scheduleMany([record], {
      householdId: "hh-1",
      petNames: { "pet-fire": "Harper" },
    });
    await __testing.waitForIdle();

    clock.tick(5_000);

    const firedLog = logMock.mock.calls.find((call) => call.arguments[1] === "ui.pets.reminder_fired");
    assert.ok(firedLog, "expected reminder_fired log to be emitted");
  } finally {
    clock.uninstall();
  }
});

test("permission denied skips scheduling and logs once", async () => {
  const baseNow = Date.UTC(2025, 0, 3, 7, 0, 0);
  const clock = installClock(baseNow);
  try {
    stubPermission(false);
    const sendMock = mock.method(notificationModule, "sendNotification", async () => {});
    const logMock = mock.method(uiLogModule, "logUI", () => {});

    const record = {
      medical_id: "med-denied",
      pet_id: "pet-denied",
      date: "2025-03-01",
      reminder_at: new Date(baseNow + 10_000).toISOString(),
      description: "Microchip check",
      pet_name: "Nola",
    };

    reminderScheduler.init();
    reminderScheduler.scheduleMany([record], {
      householdId: "hh-2",
      petNames: { "pet-denied": "Nola" },
    });
    await __testing.waitForIdle();

    assert.equal(reminderScheduler.stats().activeTimers, 0);
    assert.equal(sendMock.mock.calls.length, 0);

    const deniedLog = logMock.mock.calls.find((call) => call.arguments[1] === "ui.pets.reminder_permission_denied");
    assert.ok(deniedLog, "expected permission denied log entry");
  } finally {
    clock.uninstall();
  }
});
