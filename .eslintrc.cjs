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
      files: ["src/ui/**/*.{ts,tsx,js,jsx}"],
      rules: {
        "no-restricted-syntax": [
          "error",
          {
            selector:
              "Literal[value=/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
            message: "Use design tokens via @ui/theme instead of hard-coded colour literals.",
          },
          {
            selector: "Literal[value=/#[0-9a-fA-F]{3,8}/]",
            message: "Use design tokens via @ui/theme instead of hard-coded colour literals.",
          },
          {
            selector: "Literal[value=/^(?:rgb|rgba|hsl|hsla)\\(/i]",
            message: "Use design tokens via @ui/theme instead of hard-coded colour literals.",
          },
          {
            selector: "Literal[value=/(?:^|[^a-z])(?:rgb|rgba|hsl|hsla)\\s*\\(/i]",
            message: "Use design tokens via @ui/theme instead of hard-coded colour literals.",
          },
          {
            selector:
              "Literal[value=/^(?:red|blue|green|black|white|gray|grey|orange|purple|pink|yellow|cyan|magenta)$/i]",
            message: "Use design tokens via @ui/theme instead of hard-coded colour literals.",
          },
          {
            selector:
              "TemplateLiteral[quasis.length=1][quasis.0.value.raw=/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
            message: "Use design tokens via @ui/theme instead of hard-coded colour literals.",
          },
          {
            selector:
              "TemplateLiteral[quasis.length=1][quasis.0.value.raw=/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})/i]",
            message: "Use design tokens via @ui/theme instead of hard-coded colour literals.",
          },
          {
            selector:
              "TemplateLiteral[quasis.length=1][quasis.0.value.raw=/^(?:rgb|rgba|hsl|hsla)\\(/i]",
            message: "Use design tokens via @ui/theme instead of hard-coded colour literals.",
          },
          {
            selector:
              "TemplateLiteral[quasis.length=1][quasis.0.value.raw=/(?:^|[^a-z])(?:rgb|rgba|hsl|hsla)\\s*\\(/i]",
            message: "Use design tokens via @ui/theme instead of hard-coded colour literals.",
          },
          {
            selector:
              "TemplateLiteral[quasis.length=1][quasis.0.value.raw=/^(?:red|blue|green|black|white|gray|grey|orange|purple|pink|yellow|cyan|magenta)$/i]",
            message: "Use design tokens via @ui/theme instead of hard-coded colour literals.",
          },
        ],
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
    {
      files: [
        "scripts/**/*.{ts,js}",
        "tests/**/*.{ts,js}",
        "src/tools/**/*.{ts,js}"
      ],
      rules: {
        "import/no-relative-parent-imports": "off",
        "security/detect-object-injection": "off",
      },
    },
  ],
};
