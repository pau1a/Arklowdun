import {
  getContract,
  type ContractRequest,
  type ContractResponse,
  type IpcAdapter,
  type IpcCommand,
} from "../port";
import { IpcLogBuffer, attachGlobalDump, type IpcLogEntry } from "../logBuffer";

interface TauriInvoke {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

declare global {
  interface Window {
    __TAURI__?: TauriInvoke;
    __ARKLOWDUN_TAURI_ADAPTER__?: {
      dumpLogs: () => IpcLogEntry[];
    };
  }
}

export class TauriAdapter implements IpcAdapter {
  private invoker?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  private readonly logger = new IpcLogBuffer("tauri", 200);

  constructor() {
    attachGlobalDump("__ARKLOWDUN_TAURI_ADAPTER__", () => this.logger.dump());
  }

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
    const span = this.logger.start(command, payload ?? {});
    try {
      const contract = getContract(command);
      const request = contract.request.parse(payload ?? {});
      const invoke = await this.getInvoke();
      // Some Tauri commands expect a single struct argument named `request` or `payload`.
      // Others expect flattened args. To support all cases without changing callers,
      // send flattened args and also include both wrappers.
      const base = request as Record<string, unknown>;
      const args: Record<string, unknown> = {
        ...(base ?? {}),
        request: request,
        payload: request,
      };
      const result = await invoke<ContractResponse<K>>(command, args);
      const parsed = contract.response.parse(result);
      span.finish({ success: true });
      return parsed;
    } catch (error) {
      span.finish({ success: false, error });
      console.error(`[ipc] tauri invoke failed`, { command, error });
      throw error;
    }
  }
}
