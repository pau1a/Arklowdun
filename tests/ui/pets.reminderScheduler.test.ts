import { strict as assert } from "node:assert";
import test, { mock } from "node:test";
import FakeTimers from "@sinonjs/fake-timers";

import { reminderScheduler, __testing } from "../../src/features/pets/reminderScheduler";
import { __testing as diagnosticsTesting } from "../../src/diagnostics/runtime";

const MAX_TIMEOUT = 2_147_483_647;

type DependencyOptions = {
  permissionGranted?: boolean;
  sendNotificationImpl?: () => Promise<void> | void;
};

function installClock(now: number) {
  return FakeTimers.install({
    now,
    toFake: ["setTimeout", "clearTimeout", "Date"],
  });
}

function stubDependencies(options: DependencyOptions = {}) {
  const granted = options.permissionGranted ?? true;
  const sendNotificationImpl = options.sendNotificationImpl ?? (async () => {});
  const sendNotificationMock = mock.fn(async () => {
    await sendNotificationImpl();
  });
  __testing.setDependencies({
    isPermissionGranted: mock.fn(async () => granted),
    requestPermission: mock.fn(async () => (granted ? "granted" : "denied")),
    sendNotification: sendNotificationMock,
    logUI: mock.fn(() => {}),
  });
  return { sendNotificationMock };
}

test.beforeEach(() => {
  __testing.reset();
  diagnosticsTesting.reset();
  diagnosticsTesting.disableFilePersistence();
});

test.afterEach(async () => {
  mock.restoreAll();
  await diagnosticsTesting.waitForIdle();
});

test("scheduling the same reminder twice keeps active timer count stable", { concurrency: false }, async () => {
  const clock = installClock(Date.UTC(2025, 0, 1, 8, 0, 0));
  try {
    stubDependencies();

    const record = {
      medical_id: "med-1",
      pet_id: "pet-1",
      date: "2025-01-10",
      reminder_at: new Date(Date.now() + 60_000).toISOString(),
      description: "Vaccine booster",
      pet_name: "Skye",
    };

    reminderScheduler.init();
    reminderScheduler.scheduleMany([record], {
      householdId: "hh-1",
      petNames: { "pet-1": "Skye" },
    });
    await __testing.waitForIdle();

    assert.equal(reminderScheduler.stats().activeTimers, 1);

    reminderScheduler.scheduleMany([record], {
      householdId: "hh-1",
      petNames: { "pet-1": "Skye" },
    });
    await __testing.waitForIdle();

    assert.equal(reminderScheduler.stats().activeTimers, 1);
  } finally {
    clock.uninstall();
  }
});

test("cancelAll clears timers", { concurrency: false }, async () => {
  const clock = installClock(Date.UTC(2025, 0, 1, 9, 0, 0));
  try {
    stubDependencies();

    const record = {
      medical_id: "med-2",
      pet_id: "pet-2",
      date: "2025-01-15",
      reminder_at: new Date(Date.now() + 120_000).toISOString(),
      description: "Dental check",
      pet_name: "Riley",
    };

    reminderScheduler.scheduleMany([record], {
      householdId: "hh-1",
      petNames: { "pet-2": "Riley" },
    });
    await __testing.waitForIdle();
    assert.equal(reminderScheduler.stats().activeTimers, 1);

    reminderScheduler.cancelAll();
    assert.equal(reminderScheduler.stats().activeTimers, 0);
  } finally {
    clock.uninstall();
  }
});

test("diagnostics snapshot tracks active timer stats", { concurrency: false }, async () => {
  const clock = installClock(Date.UTC(2025, 0, 1, 12, 0, 0));
  try {
    stubDependencies();

    const record = {
      medical_id: "med-9",
      pet_id: "pet-9",
      date: "2025-01-20",
      reminder_at: new Date(Date.now() + 45_000).toISOString(),
      description: "Ear cleaning",
      pet_name: "Luna",
    };

    reminderScheduler.init();
    await diagnosticsTesting.waitForIdle();
    assert.deepEqual(diagnosticsTesting.getSnapshot(), {
      pets: {
        reminder_active_timers: 0,
        reminder_buckets: 0,
        reminder_queue_depth: 0,
      },
    });

    reminderScheduler.scheduleMany([record], {
      householdId: "hh-diag",
      petNames: { "pet-9": "Luna" },
    });
    await __testing.waitForIdle();
    await diagnosticsTesting.waitForIdle();
    assert.deepEqual(diagnosticsTesting.getSnapshot(), {
      pets: {
        reminder_active_timers: 1,
        reminder_buckets: 1,
        reminder_queue_depth: 1,
      },
    });

    reminderScheduler.cancelAll();
    await diagnosticsTesting.waitForIdle();
    assert.deepEqual(diagnosticsTesting.getSnapshot(), {
      pets: {
        reminder_active_timers: 0,
        reminder_buckets: 0,
        reminder_queue_depth: 0,
      },
    });
  } finally {
    clock.uninstall();
  }
});

test("catch-up reminders fire only once per session", { concurrency: false }, async () => {
  const clock = installClock(Date.UTC(2025, 0, 10, 9, 0, 0));
  try {
    const { sendNotificationMock } = stubDependencies();

    const pastReminder = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const record = {
      medical_id: "med-3",
      pet_id: "pet-3",
      date: "2025-01-20",
      reminder_at: pastReminder,
      description: "Parasite treatment",
      pet_name: "Luna",
    };

    reminderScheduler.scheduleMany([record], {
      householdId: "hh-1",
      petNames: { "pet-3": "Luna" },
    });
    await __testing.waitForIdle();
    assert.equal(sendNotificationMock.mock.calls.length, 1);

    reminderScheduler.scheduleMany([record], {
      householdId: "hh-1",
      petNames: { "pet-3": "Luna" },
    });
    await __testing.waitForIdle();
    assert.equal(sendNotificationMock.mock.calls.length, 1);
  } finally {
    clock.uninstall();
  }
});

test("long delays chain without duplicates", { concurrency: false }, async () => {
  const clock = installClock(Date.UTC(2025, 0, 1, 0, 0, 0));
  try {
    const { sendNotificationMock } = stubDependencies();

    const longDelayMs = MAX_TIMEOUT * 2 + 5_000;
    const record = {
      medical_id: "med-4",
      pet_id: "pet-4",
      date: "2025-05-01",
      reminder_at: new Date(Date.now() + longDelayMs).toISOString(),
      description: "Annual physical",
      pet_name: "Nova",
    };

    reminderScheduler.scheduleMany([record], {
      householdId: "hh-1",
      petNames: { "pet-4": "Nova" },
    });
    await __testing.waitForIdle();
    assert.equal(reminderScheduler.stats().activeTimers, 1);

    clock.tick(MAX_TIMEOUT);
    assert.equal(sendNotificationMock.mock.calls.length, 0);
    assert.equal(reminderScheduler.stats().activeTimers, 1);

    clock.tick(MAX_TIMEOUT);
    assert.equal(sendNotificationMock.mock.calls.length, 0);
    assert.equal(reminderScheduler.stats().activeTimers, 1);

    clock.tick(5_000);
    assert.equal(sendNotificationMock.mock.calls.length, 1);
    assert.equal(reminderScheduler.stats().activeTimers, 0);
  } finally {
    clock.uninstall();
  }
});

test("canceling chained reminders prevents firing", { concurrency: false }, async () => {
  const clock = installClock(Date.UTC(2025, 0, 1, 0, 0, 0));
  try {
    const { sendNotificationMock } = stubDependencies();

    const longDelayMs = MAX_TIMEOUT * 2 + 1_000;
    const record = {
      medical_id: "med-5",
      pet_id: "pet-5",
      date: "2025-06-01",
      reminder_at: new Date(Date.now() + longDelayMs).toISOString(),
      description: "Allergy shot",
      pet_name: "Rex",
    };

    reminderScheduler.scheduleMany([record], {
      householdId: "hh-1",
      petNames: { "pet-5": "Rex" },
    });
    await __testing.waitForIdle();

    clock.tick(MAX_TIMEOUT);
    assert.equal(sendNotificationMock.mock.calls.length, 0);

    reminderScheduler.cancelAll();
    clock.tick(MAX_TIMEOUT + 1_000);
    assert.equal(sendNotificationMock.mock.calls.length, 0);
  } finally {
    clock.uninstall();
  }
});

test("rescheduleForPet rebuilds timers for a single pet", { concurrency: false }, async () => {
  const clock = installClock(Date.UTC(2025, 0, 1, 12, 0, 0));
  try {
    stubDependencies();

    const petOneRecord = {
      medical_id: "med-6",
      pet_id: "pet-6",
      date: "2025-02-01",
      reminder_at: new Date(Date.now() + 30_000).toISOString(),
      description: "Heartworm",
      pet_name: "Sasha",
    };
    const petTwoRecord = {
      medical_id: "med-7",
      pet_id: "pet-7",
      date: "2025-02-15",
      reminder_at: new Date(Date.now() + 60_000).toISOString(),
      description: "Flea prevention",
      pet_name: "Cooper",
    };

    reminderScheduler.scheduleMany([petOneRecord, petTwoRecord], {
      householdId: "hh-1",
      petNames: { "pet-6": "Sasha", "pet-7": "Cooper" },
    });
    await __testing.waitForIdle();
    assert.equal(reminderScheduler.stats().activeTimers, 2);

    reminderScheduler.rescheduleForPet("pet-6");
    assert.equal(reminderScheduler.stats().activeTimers, 1);

    const updatedRecord = {
      ...petOneRecord,
      reminder_at: new Date(Date.now() + 120_000).toISOString(),
    };

    reminderScheduler.scheduleMany([updatedRecord], {
      householdId: "hh-1",
      petNames: { "pet-6": "Sasha" },
    });
    await __testing.waitForIdle();
    assert.equal(reminderScheduler.stats().activeTimers, 2);
  } finally {
    clock.uninstall();
  }
});
