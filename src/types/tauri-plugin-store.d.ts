declare module "@tauri-apps/plugin-store" {
  export class Store {
    constructor(path: string);
    static load(path: string): Promise<Store>;
    get<T = unknown>(key: string): Promise<T | null>;
    set<T = unknown>(key: string, value: T): Promise<void>;
    has(key: string): Promise<boolean>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
    save(): Promise<void>;
  }
}
