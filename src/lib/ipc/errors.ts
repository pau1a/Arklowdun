export const UNKNOWN_IPC_ERROR_CODE = "APP/UNKNOWN" as const;

export class UnknownIpcCommandError extends Error {
  readonly code = UNKNOWN_IPC_ERROR_CODE;
  readonly knownCommands: readonly string[];

  constructor(command: string, knownCommands: readonly string[]) {
    super(`Unknown IPC command '${command}'. Known commands: ${knownCommands.join(", ")}`);
    this.name = "UnknownIpcCommandError";
    this.knownCommands = knownCommands;
  }
}

export class MissingScenarioHandlerError extends Error {
  readonly code = UNKNOWN_IPC_ERROR_CODE;
  readonly command: string;
  readonly scenario: string;

  constructor(command: string, scenario: string) {
    super(`Scenario '${scenario}' has no handler for ${command}`);
    this.name = "MissingScenarioHandlerError";
    this.command = command;
    this.scenario = scenario;
  }
}
