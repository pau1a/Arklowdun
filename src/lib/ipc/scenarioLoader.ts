import type { ContractRequest, ContractResponse, IpcCommand } from "./port";
import type { Clock } from "@lib/runtime/clock";
import type { Rng } from "@lib/runtime/rng";

export interface ScenarioContext {
  clock: Clock;
  rng: Rng;
}

export type ScenarioHandler<K extends IpcCommand> = (
  payload: ContractRequest<K>,
  context: ScenarioContext,
) => Promise<ContractResponse<K>> | ContractResponse<K>;

export type ScenarioHandlers = {
  [K in IpcCommand]?: ScenarioHandler<K>;
};

export interface ScenarioDefinition {
  name: string;
  description?: string;
  handlers: ScenarioHandlers;
  metadata?: Record<string, unknown>;
}

type ScenarioModule = { default: () => ScenarioDefinition; slug?: string };

let scenarioModules: Record<string, ScenarioModule> = {};

try {
  const metaAny = import.meta as unknown as Record<string, unknown>;
  const glob = typeof metaAny.glob === "function"
    ? (metaAny.glob as (pattern: string, options: { eager: boolean }) => Record<string, ScenarioModule>)
    : null;
  if (glob) {
    scenarioModules = glob("../../tests/scenarios/*.ts", { eager: true });
  }
} catch {
  scenarioModules = {};
}

const registry = new Map<string, ScenarioDefinition>();

for (const [path, mod] of Object.entries(scenarioModules)) {
  const definition = mod.default();
  const key = mod.slug ?? definition.name ?? path;
  registry.set(key, definition);
}

export class ScenarioLoader {
  constructor(private readonly scenarios = registry) {}

  list(): string[] {
    return Array.from(this.scenarios.keys()).sort();
  }

  load(name?: string): ScenarioDefinition {
    if (name && this.scenarios.has(name)) {
      return this.scenarios.get(name)!;
    }
    const first = this.scenarios.values().next();
    if (!first.value) {
      throw new Error("No scenarios registered");
    }
    return first.value;
  }
}
