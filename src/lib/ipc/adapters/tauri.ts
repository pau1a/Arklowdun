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
  private invoker?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

  private async getInvoke() {
    if (this.invoker) {
      return this.invoker;
    }

    const anyWindow = typeof window !== "undefined" ? (window as Window & { __TAURI__?: TauriInvoke }) : undefined;

    if (anyWindow?.__TAURI__?.invoke) {
      this.invoker = anyWindow.__TAURI__.invoke.bind(anyWindow.__TAURI__);
      return this.invoker;
    }

    try {
      const mod = await import("@tauri-apps/api/core");
      this.invoker = mod.invoke as unknown as typeof this.invoker;
      return this.invoker!;
    } catch {
      throw new Error("Tauri invoke bridge is not available");
    }
  }

  async invoke<K extends IpcCommand>(
    command: K,
    payload: ContractRequest<K>,
  ): Promise<ContractResponse<K>> {
    const contract = getContract(command);
    const request = contract.request.parse(payload ?? {});
    const invoke = await this.getInvoke();
    const result = await invoke<ContractResponse<K>>(command, request as Record<string, unknown>);
    return contract.response.parse(result);
  }
}
