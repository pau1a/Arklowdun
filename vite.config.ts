import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const resolveAlias = {
  "@features": fileURLToPath(new URL("./src/features", import.meta.url)),
  "@ui": fileURLToPath(new URL("./src/ui", import.meta.url)),
  "@layout": fileURLToPath(new URL("./src/layout", import.meta.url)),
  "@lib": fileURLToPath(new URL("./src/lib", import.meta.url)),
  "@bindings": fileURLToPath(new URL("./src/bindings", import.meta.url)),
  "@store": fileURLToPath(new URL("./src/store", import.meta.url)),
  "@utils": fileURLToPath(new URL("./src/utils", import.meta.url)),
};

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  resolve: {
    alias: resolveAlias,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
