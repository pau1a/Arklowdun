import { bannerFor } from "./banner";
import { getTheme, onThemeChange as onThemePreferenceChange } from "./ThemeToggle";

export interface PageBannerRouteLike {
  id: string;
  display?: { label?: string | null } | null;
}

let activeRoute: PageBannerRouteLike | null = null;
let unsubscribeTheme: (() => void) | null = null;
let lastBannerKey: string | null = null;
let lastBannerTheme: "light" | "dark" | null = null;

function isSystemDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function resolveBannerTheme(): "light" | "dark" {
  try {
    const preference = getTheme();
    if (preference === "dark") return "dark";
    if (preference === "light") return "light";
  } catch {
    // Ignore theme resolution failures; fall back to DOM state or media query.
  }
  if (typeof document !== "undefined") {
    const docTheme = document.documentElement?.dataset.theme;
    if (docTheme === "dark") return "dark";
    if (docTheme === "light") return "light";
  }
  return isSystemDark() ? "dark" : "light";
}

function ensureThemeListener(): void {
  if (unsubscribeTheme) return;
  try {
    unsubscribeTheme = onThemePreferenceChange(() => {
      if (activeRoute) {
        applyBanner(activeRoute, { force: true });
      }
    });
  } catch {
    unsubscribeTheme = null;
  }
}

function applyBanner(route: PageBannerRouteLike, options: { force?: boolean } = {}): void {
  if (typeof document === "undefined") return;
  const bannerEl = document.getElementById("page-banner") as HTMLDivElement | null;
  if (!bannerEl) return;
  const body = document.body;

  if (bannerEl.dataset.bannerMode === "interactive") {
    delete bannerEl.dataset.bannerMode;
    bannerEl.innerHTML = "";
    bannerEl.setAttribute("role", "img");
  }

  const key = route.id.toLowerCase();
  const label = route.display?.label ?? key;
  const theme = resolveBannerTheme();
  if (!options.force && lastBannerKey === key && lastBannerTheme === theme) {
    return;
  }

  const url = bannerFor(key, theme) ?? bannerFor(key);
  if (url) {
    bannerEl.hidden = false;
    bannerEl.style.backgroundImage = `url("${url}")`;
    bannerEl.style.setProperty("--banner-pos-x", "50%");
    bannerEl.style.setProperty("--banner-pos-y", "50%");
    bannerEl.setAttribute("role", "img");
    bannerEl.setAttribute("aria-hidden", "false");
    bannerEl.setAttribute("aria-label", `${label} banner`);
    bannerEl.dataset.bannerTheme = theme;
    bannerEl.dataset.bannerKey = key;
    body.dataset.bannerVisibility = "visible";
    lastBannerKey = key;
    lastBannerTheme = theme;
  } else {
    bannerEl.hidden = true;
    bannerEl.style.removeProperty("background-image");
    bannerEl.style.removeProperty("--banner-pos-x");
    bannerEl.style.removeProperty("--banner-pos-y");
    bannerEl.setAttribute("aria-hidden", "true");
    bannerEl.removeAttribute("aria-label");
    delete bannerEl.dataset.bannerTheme;
    delete bannerEl.dataset.bannerKey;
    delete body.dataset.bannerVisibility;
    lastBannerKey = null;
    lastBannerTheme = null;
  }
}

export function updatePageBanner(route: PageBannerRouteLike): void {
  if (typeof document === "undefined") return;
  activeRoute = route;
  ensureThemeListener();
  applyBanner(route, { force: true });
}
