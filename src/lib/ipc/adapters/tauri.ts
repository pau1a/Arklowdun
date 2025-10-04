import { getContract, type ContractRequest, type ContractResponse, type IpcAdapter, type IpcCommand } from "../port";

interface TauriInvoke {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

declare global {
  interface Window {
    __TAURI__?: TauriInvoke;
  }
}

export class TauriAdapter implements IpcAdapter {
  async invoke<K extends IpcCommand>(
    command: K,
    payload: ContractRequest<K>,
  ): Promise<ContractResponse<K>> {
    const contract = getContract(command);
    const request = contract.request.parse(payload ?? {});
    const invoke = window.__TAURI__?.invoke ?? (async () => {
      throw new Error("Tauri invoke bridge is not available");
    });
    const result = await invoke<ContractResponse<K>>(command, request as Record<string, unknown>);
    return contract.response.parse(result);
  }
}
