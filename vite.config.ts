import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const fromRoot = (p: string): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), p);

// https://vite.dev/config/
export default defineConfig(async () => ({

  resolve: {
    alias: {
      "@features": fromRoot("src/features"),
      "@ui": fromRoot("src/ui"),
      "@layout": fromRoot("src/layout"),
      "@lib": fromRoot("src/lib"),
      "@store": fromRoot("src/store"),
    },
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
