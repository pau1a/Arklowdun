import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

export interface LogicalSizeInput {
  width: number;
  height: number;
}

export interface AppWindowHandle {
  readonly label: string;
  innerSize(): Promise<LogicalSizeInput>;
  scaleFactor(): Promise<number>;
  setMinSize(size: LogicalSizeInput): Promise<void>;
  setSize(size: LogicalSizeInput): Promise<void>;
}

function toLogicalSize({ width, height }: LogicalSizeInput): LogicalSize {
  return new LogicalSize(width, height);
}

function createAppWindowHandle(): AppWindowHandle {
  const window = getCurrentWindow();
  return {
    get label() {
      return window.label;
    },
    async innerSize() {
      const size = await window.innerSize();
      return { width: size.width, height: size.height };
    },
    scaleFactor() {
      return window.scaleFactor();
    },
    async setMinSize(size) {
      await window.setMinSize(toLogicalSize(size));
    },
    async setSize(size) {
      await window.setSize(toLogicalSize(size));
    },
  };
}

export function getStartupWindow(): AppWindowHandle | null {
  if (!import.meta.env.TAURI) return null;
  return createAppWindowHandle();
}
