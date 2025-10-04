import type { z } from "zod";
import { contracts, type ContractEntry } from "./contracts/index";

export type IpcCommand = keyof typeof contracts;

export type ContractRequest<K extends IpcCommand> = z.input<ContractEntry<K>["request"]>;
export type ContractResponse<K extends IpcCommand> = z.output<ContractEntry<K>["response"]>;

export interface IpcAdapter {
  invoke<K extends IpcCommand>(
    command: K,
    payload: ContractRequest<K>,
  ): Promise<ContractResponse<K>>;
}

export function getContract<K extends IpcCommand>(command: K): ContractEntry<K> {
  return contracts[command];
}
