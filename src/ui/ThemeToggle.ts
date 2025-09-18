const STORAGE_KEY = "arklowdun.theme";

export type ThemePreference = "system" | "light" | "dark";

const VALID_VALUES = new Set<ThemePreference>(["system", "light", "dark"]);

let currentTheme: ThemePreference = "system";
let initialised = false;
let media: MediaQueryList | null = null;
const listeners = new Set<(theme: ThemePreference) => void>();

function readStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_VALUES.has(stored as ThemePreference)) {
      return stored as ThemePreference;
    }
  } catch (error) {
    console.warn("theme storage read failed", error);
  }
  return "system";
}

function notify() {
  for (const listener of listeners) {
    listener(currentTheme);
  }
}

function isSystemDark(): boolean {
  return media?.matches ?? false;
}

function resolveColorScheme(theme: ThemePreference): "light" | "dark" {
  if (theme === "dark") return "dark";
  if (theme === "light") return "light";
  return isSystemDark() ? "dark" : "light";
}

function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  if (document.body) {
    document.body.dataset.theme = theme;
  }
  const scheme = resolveColorScheme(theme);
  root.style.colorScheme = scheme;
}

function persist(theme: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch (error) {
    console.warn("theme storage write failed", error);
  }
}

function handleSystemChange(): void {
  if (currentTheme !== "system") return;
  applyTheme(currentTheme);
  notify();
}

export function initTheme(): ThemePreference {
  if (initialised) return currentTheme;
  media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  currentTheme = readStoredTheme();
  applyTheme(currentTheme);
  if (media) {
    media.addEventListener("change", handleSystemChange);
  }
  initialised = true;
  return currentTheme;
}

export function getTheme(): ThemePreference {
  return currentTheme;
}

export function setTheme(theme: ThemePreference): void {
  if (!VALID_VALUES.has(theme)) {
    throw new Error(`Invalid theme preference: ${theme}`);
  }
  if (currentTheme === theme) {
    persist(theme);
    applyTheme(theme);
    return;
  }
  currentTheme = theme;
  persist(theme);
  applyTheme(theme);
  notify();
}

export function onThemeChange(listener: (theme: ThemePreference) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface ThemeToggleInstance {
  element: HTMLLabelElement;
  destroy(): void;
}

export function createThemeToggle(): ThemeToggleInstance {
  initTheme();

  const container = document.createElement("label");
  container.className = "theme-toggle";

  const text = document.createElement("span");
  text.className = "theme-toggle__label";
  text.textContent = "Theme";

  const select = document.createElement("select");
  select.name = "theme";
  select.className = "theme-toggle__select";
  select.setAttribute("aria-label", "Select theme preference");

  const options: Array<{ value: ThemePreference; label: string }> = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  for (const option of options) {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    select.appendChild(opt);
  }

  select.value = getTheme();

  select.addEventListener("change", () => {
    const next = select.value as ThemePreference;
    setTheme(next);
  });

  container.append(text, select);

  const unsubscribe = onThemeChange((theme) => {
    if (select.value !== theme) {
      select.value = theme;
    }
  });

  return {
    element: container,
    destroy() {
      unsubscribe();
    },
  };
}
