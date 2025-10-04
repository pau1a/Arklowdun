import { FixedClock, type Clock } from "@lib/runtime/clock";
import { SeededRng, type Rng } from "@lib/runtime/rng";
import type { DbHealthReport } from "@bindings/DbHealthReport";
import { ScenarioLoader, type ScenarioDefinition, type ScenarioHandler } from "../scenarioLoader";
import {
  getContract,
  type ContractRequest,
  type ContractResponse,
  type IpcAdapter,
  type IpcCommand,
} from "../port";

const DEFAULT_TIMESTAMP = "2024-06-01T12:00:00.000Z";

type HealthState = "healthy" | "unhealthy";

export interface TestAdapterOptions {
  loader?: ScenarioLoader;
  clock?: Clock;
  rng?: Rng;
  scenarioName?: string;
  logSize?: number;
}

export interface LogEntry {
  command: IpcCommand;
  payload: unknown;
  response?: unknown;
  error?: unknown;
  timestamp: string;
}

declare global {
  interface Window {
    __ARKLOWDUN_TEST_ADAPTER__?: {
      dumpLogs: () => LogEntry[];
      setHealth: (state: HealthState) => void;
      listScenarios: () => string[];
    };
  }
}

export class TestAdapter implements IpcAdapter {
  private readonly loader: ScenarioLoader;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly logSize: number;
  private readonly logs: LogEntry[] = [];
  private health: HealthState = "healthy";
  private scenario: ScenarioDefinition;

  constructor(options: TestAdapterOptions = {}) {
    this.loader = options.loader ?? new ScenarioLoader();
    this.clock = options.clock ?? new FixedClock(new Date(DEFAULT_TIMESTAMP));
    this.rng = options.rng ?? new SeededRng(42);
    this.logSize = options.logSize ?? 200;
    const scenarioEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const scenarioName = options.scenarioName ?? scenarioEnv?.VITE_IPC_SCENARIO ?? undefined;
    this.scenario = this.loader.load(scenarioName);
    const metaHealth = this.scenario.metadata?.health;
    if (metaHealth === "healthy" || metaHealth === "unhealthy") {
      this.health = metaHealth;
    }

    if (typeof window !== "undefined") {
      window.__ARKLOWDUN_TEST_ADAPTER__ = {
        dumpLogs: () => [...this.logs],
        setHealth: (state: HealthState) => {
          this.health = state;
        },
        listScenarios: () => this.loader.list(),
      };
    }
  }

  setScenario(name: string): void {
    this.scenario = this.loader.load(name);
    const metaHealth = this.scenario.metadata?.health;
    if (metaHealth === "healthy" || metaHealth === "unhealthy") {
      this.health = metaHealth;
    }
  }

  setHealth(state: HealthState): void {
    this.health = state;
  }

  private record(entry: LogEntry): void {
    this.logs.push(entry);
    if (this.logs.length > this.logSize) {
      this.logs.shift();
    }
  }

  private healthReport(): DbHealthReport {
    const base: DbHealthReport = {
      status: this.health === "healthy" ? "ok" : "error",
      checks: [
        {
          name: "fake-db-check",
          passed: this.health === "healthy",
          duration_ms: 1,
          details: this.health === "healthy" ? "ok" : "simulated failure",
        },
      ],
      offenders:
        this.health === "healthy"
          ? []
          : [
              {
                table: "events",
                rowid: 1,
                message: "simulated corruption",
              },
            ],
      schema_hash: "fake-schema",
      app_version: "test",
      generated_at: this.clock.now().toISOString(),
    };
    return base;
  }

  async invoke<K extends IpcCommand>(
    command: K,
    payload: ContractRequest<K>,
  ): Promise<ContractResponse<K>> {
    const contract = getContract(command);
    const parsedPayload = contract.request.parse(payload ?? {});
    const timestamp = this.clock.now().toISOString();

    if (command === "db_get_health_report" || command === "db_recheck") {
      const report = this.healthReport();
      const parsed = contract.response.parse(report);
      this.record({ command, payload: parsedPayload, response: parsed, timestamp });
      return parsed as ContractResponse<K>;
    }

    const handler = this.scenario.handlers[command] as ScenarioHandler<K> | undefined;

    if (!handler) {
      const error = new Error(`Scenario '${this.scenario.name}' has no handler for ${command}`);
      this.record({ command, payload: parsedPayload, error, timestamp });
      throw error;
    }

    try {
      const response = await handler(parsedPayload, { clock: this.clock, rng: this.rng });
      const parsed = contract.response.parse(response);
      this.record({ command, payload: parsedPayload, response: parsed, timestamp });
      return parsed;
    } catch (error) {
      this.record({ command, payload: parsedPayload, error, timestamp });
      throw error;
    }
  }
}
