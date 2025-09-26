import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

const resolveAlias = {
  "@features": fileURLToPath(new URL("./src/features", import.meta.url)),
  "@ui": fileURLToPath(new URL("./src/ui", import.meta.url)),
  "@layout": fileURLToPath(new URL("./src/layout", import.meta.url)),
  "@lib": fileURLToPath(new URL("./src/lib", import.meta.url)),
  "@bindings": fileURLToPath(new URL("./src/bindings", import.meta.url)),
  "@store": fileURLToPath(new URL("./src/store", import.meta.url)),
  "@strings": fileURLToPath(new URL("./src/strings", import.meta.url)),
};

export default defineConfig({
  resolve: {
    alias: resolveAlias,
  },
  test: {
    include: ["src/**/*.{test,spec}.{js,ts}"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html", "lcov"],
      exclude: [
        "scripts/**",
        "src-tauri/**",
        "node_modules/**",
        "dist/**",
        "**/*.d.ts",
        "**/bindings/**"
      ]
    }
  }
});
