import assert from "node:assert/strict";
import test from "node:test";

import { ScenarioLoader } from "../../src/lib/ipc/scenarioLoader";

const CORE_COMMANDS = [
  "household_list",
  "household_get_active",
  "diagnostics_summary",
  "diagnostics_household_stats",
  "events_list_range",
  "notes_list_cursor",
  "notes_list_by_deadline_range",
  "notes_list_for_entity",
  "notes_quick_create_for_entity",
  "note_links_list_by_entity",
  "note_links_get_for_note",
  "vehicles_list",
  "search_entities",
  "bills_list_due_between",
  "db_backup_overview",
  "db_backup_create",
  "db_export_run",
];

test("all Playwright scenarios implement core dashboard/calendar commands", () => {
  const loader = new ScenarioLoader();
  const scenarios = loader.list();
  assert.ok(scenarios.length > 0, "no scenarios registered");
  for (const name of scenarios) {
    const scenario = loader.load(name);
    for (const command of CORE_COMMANDS) {
      const hasHandler = Object.prototype.hasOwnProperty.call(scenario.handlers, command);
      assert.ok(hasHandler, `${name} is missing handler for ${command}`);
    }
  }
});
