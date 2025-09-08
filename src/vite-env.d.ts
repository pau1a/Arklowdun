/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_LOG_LEVEL?: "debug" | "info" | "warn" | "error";
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
