const tauriImportRestriction = {
  paths: [
    {
      name: "@tauri-apps/api/tauri",
      message:
        "IPC calls must go through src/lib/ipc/. Use the shared adapters instead of importing @tauri-apps/api/tauri directly.",
    },
    {
      name: "@tauri-apps/api/core",
      message:
        "IPC calls must go through src/lib/ipc/. Use the shared adapters instead of importing @tauri-apps/api/core directly.",
    },
  ],
  patterns: [
    {
      group: ["@tauri-apps/plugin-*"],
      message:
        "IPC plugins must be wrapped inside src/lib/ipc/. Import the shared adapter instead of the plugin package directly.",
    },
  ],
};

const componentImportRestriction = {
  paths: [...tauriImportRestriction.paths],
  patterns: [
    ...tauriImportRestriction.patterns,
    {
      group: [
        "@lib/ipc",
        "@lib/ipc/**",
        "lib/ipc",
        "lib/ipc/**",
        "../lib/ipc",
        "../lib/ipc/**",
        "../../lib/ipc",
        "../../lib/ipc/**",
        "../../../lib/ipc",
        "../../../lib/ipc/**",
        "../../../../lib/ipc",
        "../../../../lib/ipc/**",
        "../../../../../lib/ipc",
        "../../../../../lib/ipc/**",
      ],
      message:
        "Feature components must use their feature API adapters instead of importing src/lib/ipc directly.",
    },
  ],
};

module.exports = {
  root: true,
  ignorePatterns: [
    "node_modules",
    "dist",
    "coverage",
    "src-tauri",
    "**/*.d.ts",
  ],
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ["import", "unused-imports", "security", "jsx-a11y"],
  settings: {
    react: {
      version: "detect",
    },
  },
  rules: {
    "import/no-relative-parent-imports": "warn",
    "unused-imports/no-unused-imports": "warn",
    "security/detect-object-injection": "warn",
    "jsx-a11y/no-autofocus": "warn",
    "jsx-a11y/no-static-element-interactions": "warn",
    "jsx-a11y/click-events-have-key-events": "warn",
  },
  overrides: [
    {
      files: ["src/**/*.{ts,tsx,js,jsx}"] ,
      excludedFiles: ["src/lib/ipc/**/*.{ts,tsx,js,jsx}"],
      rules: {
        "no-restricted-imports": ["error", tauriImportRestriction],
      },
    },
    {
      files: ["src/lib/ipc/**/*.{ts,tsx,js,jsx}"],
      rules: {
        "no-restricted-imports": "off",
      },
    },
    {
      files: ["src/features/**/*.{ts,tsx,js,jsx}"],
      rules: {
        "import/no-relative-parent-imports": "error",
      },
    },
    {
      files: ["src/features/**/components/**/*.{ts,tsx,js,jsx}"],
      rules: {
        "no-restricted-imports": ["error", componentImportRestriction],
      },
    },
    {
      files: ["src/features/files/**/*.{ts,tsx,js,jsx}"],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "CallExpression[callee.object.name='document'][callee.property.name='createElement'][arguments.0.value='button']",
            message: 'Use @ui/Button instead of native <button> in Files feature files.',
          },
          {
            selector:
              "CallExpression[callee.object.name='document'][callee.property.name='createElement'][arguments.0.value='input']",
            message: 'Use @ui/Input instead of native <input> in Files feature files.',
          },
          {
            selector:
              "CallExpression[callee.object.name='document'][callee.property.name='createElement'][arguments.0.value='select']",
            message: 'Use @ui/Select instead of native <select> in Files feature files.',
          },
        ],
      },
    },
  ],
};
