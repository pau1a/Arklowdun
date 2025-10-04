import type { ScenarioDefinition } from "../../src/lib/ipc/scenarioLoader";
import defaultHousehold from "./defaultHousehold";

export default function corruptHealth(): ScenarioDefinition {
  const base = defaultHousehold();
  return {
    ...base,
    name: "corruptHealth",
    metadata: { ...(base.metadata ?? {}), health: "unhealthy" },
  };
}
