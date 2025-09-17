export type Pane = "files" | "calendar" | "notes" | "settings";

export interface AppState {
  activePane: Pane;
  ready: boolean;
}

type Listener = (state: AppState) => void;

const DEFAULT_STATE: AppState = {
  activePane: "files",
  ready: false,
};

class AppStore {
  private state: AppState = { ...DEFAULT_STATE };
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setActivePane(pane: Pane): void {
    if (this.state.activePane === pane) return;
    this.state = { ...this.state, activePane: pane };
    this.emit();
  }

  markReady(): void {
    if (this.state.ready) return;
    this.state = { ...this.state, ready: true };
    this.emit();
  }

  getState(): AppState {
    return this.state;
  }

  reset(): void {
    this.state = { ...DEFAULT_STATE };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

export const appStore = new AppStore();
export type { Listener as AppStoreListener };
