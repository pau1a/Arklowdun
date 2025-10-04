// Simple tabbed UI scaffold for Arklowdun
// Bundle Font Awesome locally (no remote kit, no CORS, works offline)
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./debug";
import "./theme.scss";
import "./styles.scss";
import "./styles/blob-tokens.css";
import { Page, type PageInstance } from "@layout/Page";
import {
  Sidebar,
  type SidebarInstance,
  type SidebarItemConfig,
} from "@layout/Sidebar";
import { Content, type ContentInstance } from "@layout/Content";
import { Toolbar, type ToolbarInstance } from "@layout/Toolbar";
import { Footer, type FooterInstance, type FooterItemConfig } from "@layout/Footer";
import {
  resolveRouteFromHash,
  getHubRoutes,
  getSidebarRoutes,
  getFooterRoutes,
  getDefaultRoute,
  type RouteDefinition,
} from "./routes";
import { getHouseholdIdForCalls } from "./db/household";
import { log } from "./utils/logger";
import { initCommandPalette } from "@ui/CommandPalette";
import { initKeyboardMap } from "@ui/keys";
import createDbHealthBanner, {
  type DbHealthBannerElement,
} from "@ui/DbHealthBanner";
import createDbHealthDrawer, {
  type DbHealthDrawerInstance,
} from "@ui/DbHealthDrawer";
import { actions, subscribe, selectors, type AppPane } from "./store";
import { emit } from "./store/events";
import { runViewCleanups } from "./utils/viewLifecycle";
import { initTheme } from "@ui/ThemeToggle";
import { getStartupWindow } from "@lib/ipc/startup";
import { ensureDbHealthReport, recheckDbHealth } from "./services/dbHealth";
import { recoveryText } from "@strings/recovery";
import { mountMacToolbar, setAppToolbarTitle } from "@ui/AppToolbar";
import { initAmbientBackground, type AmbientBackgroundController } from "@ui/AmbientBackground";
import { getActiveTestScenario, getIpcAdapterName } from "@lib/ipc/provider";

// Resolve main app logo (SVG) as a URL the bundler can serve
const appLogoUrl = new URL("./assets/logo.svg", import.meta.url).href;

const envRecord =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const runtimeMode = envRecord.MODE ?? envRecord.VITE_ENV ?? "development";

declare global {
  interface Window {
    __APP_READY__?: boolean;
  }
}

function ensureFavicon(url: string): void {
  const head = document.head || document.documentElement;
  // Remove any existing favicon links to avoid duplicates
  Array.from(document.querySelectorAll('link[rel="icon"]')).forEach((n) => n.remove());
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = url;
  head.appendChild(link);
}

const appWindow = getStartupWindow();

initTheme();

interface LayoutContext {
  page: PageInstance;
  sidebar: SidebarInstance;
  content: ContentInstance;
  footer: FooterInstance;
  toolbar: ToolbarInstance;
}

interface DbHealthUiContext {
  banner: DbHealthBannerElement;
  drawer: DbHealthDrawerInstance;
  unsubscribe: () => void;
}

let layoutContext: LayoutContext | null = null;
let layoutMounted = false;
let currentRouteId: AppPane | null = null;
let renderSequence = 0;
let dbHealthUi: DbHealthUiContext | null = null;
const numberFormatter = new Intl.NumberFormat();
let ambientController: AmbientBackgroundController | null = null;
let ambientInit: Promise<void> | null = null;
let appReadyNotified = false;

function signalAppReady(container: HTMLElement): void {
  if (typeof window === "undefined" || appReadyNotified) return;
  const mainHost = container.closest("main[role='main']") ??
    document.querySelector<HTMLElement>("main[role='main']");
  if (!mainHost) return;
  appReadyNotified = true;
  window.__APP_READY__ = true;
  window.dispatchEvent(new Event("app:ready"));
}

function renderFatalBanner(error: unknown): void {
  if (typeof document === "undefined") return;
  const existing = document.getElementById("fatal-app-error");
  existing?.remove();
  const host = document.createElement("div");
  host.id = "fatal-app-error";
  host.setAttribute("role", "alert");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.background = "#7f1d1d";
  host.style.color = "#fff";
  host.style.display = "flex";
  host.style.flexDirection = "column";
  host.style.alignItems = "center";
  host.style.justifyContent = "center";
  host.style.padding = "32px";
  host.style.fontFamily = "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  host.style.zIndex = "9999";

  const title = document.createElement("strong");
  title.textContent = "Application failed to start";
  title.style.fontSize = "1.5rem";
  title.style.marginBottom = "12px";

  const message = document.createElement("p");
  const errorMessage =
    error instanceof Error
      ? `${error.name ?? "Error"}: ${error.message}`
      : String(error ?? "Unknown error");
  message.textContent = errorMessage;
  message.style.margin = "0";
  message.style.whiteSpace = "pre-wrap";
  message.style.textAlign = "center";

  host.append(title, message);
  document.body.append(host);
}

function ensureAmbientBackground(): void {
  if (ambientInit) return;
  // Prefer a dedicated overlay container to avoid any stacking quirks
  let host = document.getElementById("ambient-overlay") as HTMLElement | null;
  if (!host) {
    host = document.createElement("div");
    host.id = "ambient-overlay";
    (host.style as any).inset = "0";
    host.style.position = "fixed";
    host.style.top = "0";
    host.style.right = "0";
    host.style.bottom = "0";
    host.style.left = "0";
    host.style.pointerEvents = "none";
    // Place ambient between backdrop (z:0) and UI (z:1)
    host.style.zIndex = "0";
    document.body.appendChild(host);
    log.debug("ambient:overlay-mounted");
  }
  ambientInit = initAmbientBackground(host)
    .then((controller) => {
      ambientController = controller;
    })
    .catch((error) => {
      ambientInit = null;
      log.warn("ambient:bootstrap", error);
    })
    .then(() => {
      // noop
    });
}

function toSidebarItem(route: RouteDefinition, section: "hub" | "primary"): SidebarItemConfig {
  const display = route.display;
  const icon = display?.icon;
  return {
    id: route.id,
    label: display?.label ?? route.id,
    ariaLabel: display?.ariaLabel,
    className: display?.className,
    href: route.hash,
    section,
    icon: {
      name: icon?.name ?? "fa-circle",
      defaultVariant: icon?.defaultVariant ?? "regular",
      activeVariant: icon?.activeVariant,
      fixed: icon?.fixed ?? false,
    },
  };
}

function toFooterItem(route: RouteDefinition): FooterItemConfig {
  const display = route.display;
  const icon = display?.icon;
  return {
    id: route.id,
    label: display?.label ?? route.id,
    ariaLabel: display?.ariaLabel,
    className: display?.className,
    title: display?.label ?? route.id,
    href: route.hash,
    icon: {
      name: icon?.name ?? "fa-gear",
      variant: icon?.defaultVariant ?? "solid",
    },
  };
}

function applyRouteTitle(route: RouteDefinition): void {
  const label = route.display?.label ?? route.id;
  setAppToolbarTitle(label);
  if (typeof document !== "undefined") {
    document.title = `Arklowdun – ${label}`;
  }
}

type DbHealthState = ReturnType<(typeof selectors)['db']['health']>;

function formatDbHealthTimestamp(
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function syncDbHealthUi(
  health: DbHealthState,
  banner: DbHealthBannerElement,
  drawer: DbHealthDrawerInstance,
  host: HTMLElement,
): void {
  const { phase, report, error, lastUpdated } = health;
  const isPending = phase === "pending";
  const hasReport = report !== null;
  const isUnhealthy = report?.status === "error";
  const hasError = phase === "error";

  const shouldShowBanner = isPending || isUnhealthy || hasError;

  let message: string | null = null;
  if (isPending) {
    message = hasReport
      ? recoveryText("db.health.status.rechecking")
      : recoveryText("db.health.status.checking");
  } else if (hasError) {
    message =
      error?.message ?? recoveryText("db.health.status.unavailable");
  } else if (isUnhealthy) {
    message = recoveryText("db.health.status.issues");
  } else {
    message = recoveryText("db.health.status.healthy");
  }

  const descriptionParts: string[] = [];
  const generatedLabel = formatDbHealthTimestamp(report?.generated_at ?? null);
  if (generatedLabel) {
    descriptionParts.push(
      recoveryText("db.health.description.generated", {
        timestamp: generatedLabel,
      }),
    );
  }
  const updatedLabel = formatDbHealthTimestamp(lastUpdated ?? null);
  if (updatedLabel) {
    descriptionParts.push(
      recoveryText("db.health.description.updated", {
        timestamp: updatedLabel,
      }),
    );
  }
  if (isUnhealthy && report?.offenders?.length) {
    descriptionParts.push(
      recoveryText("db.health.description.violations", {
        count: numberFormatter.format(report.offenders.length),
      }),
    );
  }
  if (hasError && error?.code) {
    descriptionParts.push(error.code);
  }

  const description = descriptionParts.join(" • ");

  host.hidden = !shouldShowBanner;
  host.classList.toggle("is-hidden", !shouldShowBanner);
  banner.update({
    state: isPending
      ? "running"
      : isUnhealthy || hasError
        ? "unhealthy"
        : "healthy",
    message,
    description,
    showSpinner: isPending,
    hidden: !shouldShowBanner,
  });

  drawer.update({
    phase,
    report,
    error: hasError ? error ?? null : null,
    lastUpdated: lastUpdated ?? null,
  });
}

function ensureDbHealthUi(content: ContentInstance): DbHealthUiContext {
  if (dbHealthUi) return dbHealthUi;

  const handleRecheck = async () => {
    try {
      await recheckDbHealth();
    } catch (error) {
      console.error("Failed to re-run database health check", error);
    }
  };

  const drawer = createDbHealthDrawer({
    open: false,
    phase: "idle",
    report: null,
    error: null,
    lastUpdated: null,
    onRecheck: handleRecheck,
  });

  const banner = createDbHealthBanner({
    state: "healthy",
    hidden: true,
    showSpinner: false,
    onViewDetails: () => {
      drawer.setOpen(true);
    },
  });

  content.bannerHost.appendChild(banner);

  const unsubscribe = subscribe(selectors.db.health, (health) => {
    syncDbHealthUi(health, banner, drawer, content.bannerHost);
  });

  dbHealthUi = { banner, drawer, unsubscribe };
  return dbHealthUi;
}

function ensureLayout(): LayoutContext {
  if (!layoutContext) {
    const sidebar = Sidebar({
      hubItems: getHubRoutes().map((route) => toSidebarItem(route, "hub")),
      primaryItems: getSidebarRoutes().map((route) => toSidebarItem(route, "primary")),
    });
    const content = Content();
    const toolbar = Toolbar();
    const footer = Footer(getFooterRoutes().map((route) => toFooterItem(route)));
    const page = Page({ sidebar, content, footer, toolbar });
    layoutContext = { page, sidebar, content, footer, toolbar };
  }

  const ctx = layoutContext;
  if (!ctx) {
    throw new Error("Layout failed to initialise");
  }

  ensureDbHealthUi(ctx.content);

  if (!layoutMounted) {
    ctx.page.mount();
    layoutMounted = true;
    ensureAmbientBackground();
  }

  return ctx;
}

function ensureCanonicalHash(route: RouteDefinition) {
  const current = window.location.hash;
  if (
    current === route.hash ||
    current.startsWith(`${route.hash}#`) ||
    current.startsWith(`${route.hash}?`)
  ) {
    return;
  }
  history.replaceState(null, "", route.hash);
}

async function renderApp({ route }: { route: RouteDefinition }) {
  const context = ensureLayout();
  const reusedLayout = layoutMounted;

  context.sidebar.setActive(route.id);
  context.footer.setActive(route.id);
  ensureCanonicalHash(route);

  if (currentRouteId === route.id) {
    applyRouteTitle(route);
    log.debug("renderApp: route unchanged", { route: route.id, reusedLayout });
    return;
  }

  const sequence = ++renderSequence;
  const container = context.content.view;

  actions.setActivePane(route.id);
  runViewCleanups(container);

  log.debug("renderApp: mount route", { route: route.id, reusedLayout });

  applyRouteTitle(route);

  try {
    await route.mount(container);
  } catch (error) {
    log.error("renderApp: mount failed", error);
    if (!appReadyNotified) {
      throw error;
    }
    return;
  }

  if (sequence === renderSequence) {
    currentRouteId = route.id;
    signalAppReady(container);
  }
}

// --- HEIGHT-ONLY floor: ensure full sidebar is visible ---
// Width is not constrained here.
function findScrollableContent(root: HTMLElement): HTMLElement {
  let best = root;
  let bestSH = root.scrollHeight;
  const stack: HTMLElement[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY)) {
      const sh = el.scrollHeight;
      if (sh > bestSH) {
        best = el;
        bestSH = sh;
      }
    }
    stack.push(...(Array.from(el.children) as HTMLElement[]));
  }
  return best;
}

function requiredLogicalFloor(): { w: number; h: number } {
  const MIN_WIDTH = 800;
  const MIN_CONTENT_HEIGHT = 480;
  const MIN_APP_HEIGHT = 600;

  const sidebarEl = document.querySelector<HTMLElement>(".sidebar");
  const headerEl =
    document.querySelector<HTMLElement>(".app-toolbar") ||
    document.querySelector<HTMLElement>("#titlebar");
  const footerEl = document.querySelector<HTMLElement>("footer");

  const headerH = headerEl?.getBoundingClientRect().height ?? 0;
  const footerH = footerEl?.getBoundingClientRect().height ?? 0;

  const contentRoot = sidebarEl ? findScrollableContent(sidebarEl) : null;
  const intrinsic = contentRoot ? contentRoot.scrollHeight : 0;

  const neededH = Math.max(
    MIN_APP_HEIGHT,
    headerH + footerH + Math.max(MIN_CONTENT_HEIGHT, intrinsic),
  );
  return { w: MIN_WIDTH, h: neededH };
}

let raf: number | null = null;
let lastMin = { w: 0, h: 0 };
async function enforceMinNow(growOnly = true) {
  if (!appWindow) return;
  const { w, h } = requiredLogicalFloor();
  const nextW = lastMin.w ? Math.max(w, lastMin.w) : w;
  const nextH = lastMin.h && growOnly ? Math.max(h, lastMin.h) : h;
  try {
    await appWindow.setMinSize({ width: nextW, height: nextH });
    lastMin = { w: nextW, h: nextH };

    const current = await appWindow.innerSize();
    const sf = await appWindow.scaleFactor();
    const curW = current.width / sf;
    const curH = current.height / sf;
    if (curW < nextW || curH < nextH) {
      await appWindow.setSize({
        width: Math.max(curW, nextW),
        height: Math.max(curH, nextH),
      });
    }
  } catch (e) {
    log.warn("enforceMinNow failed", e);
  }
}

function calibrateMinHeight(durationMs = 1000) {
  const start = performance.now();
  const tick = async () => {
    const before = lastMin.h;
    await enforceMinNow(true);
    const after = lastMin.h;
    if (after > before) {
      if (performance.now() - start < durationMs) requestAnimationFrame(tick);
      return;
    }
    if (performance.now() - start < durationMs) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setupDynamicMinSize() {
  if (!appWindow) return;
  const sidebarEl = document.querySelector<HTMLElement>(".sidebar");
  if (!sidebarEl) return;
  const mo = new MutationObserver(() => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => enforceMinNow(true));
  });
  mo.observe(sidebarEl, { childList: true, subtree: true, characterData: true });
  calibrateMinHeight(1000);
}

interface HandleRouteChangeOptions {
  suppressErrors?: boolean;
}

async function handleRouteChange(options: HandleRouteChangeOptions = {}) {
  const route = resolveRouteFromHash(window.location.hash);
  try {
    await renderApp({ route });
  } catch (error) {
    log.error("handleRouteChange failed", error);
    if (!options.suppressErrors) {
      throw error;
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const boot = async () => {
    window.__APP_READY__ = false;
    appReadyNotified = false;

    const root = document.getElementById("app") ?? document.body;
    mountMacToolbar(root);
    ensureFavicon(appLogoUrl);

    const adapterName = getIpcAdapterName();
    const scenarioName = getActiveTestScenario();
    console.info("[ENV]", {
      mode: runtimeMode,
      IPC_ADAPTER: adapterName,
      IPC_SCENARIO: scenarioName ?? null,
    });

    const defaultRoute = getDefaultRoute();
    if (!window.location.hash || window.location.hash === "#" || window.location.hash === "#/") {
      history.replaceState(null, "", defaultRoute.hash);
    }

    log.debug("app booted");
    getHouseholdIdForCalls().catch((e) => console.error("DB init failed:", e));

    const onHashChange = () => {
      void handleRouteChange({ suppressErrors: true });
    };
    window.addEventListener("hashchange", onHashChange);

    try {
      await handleRouteChange();
    } catch (error) {
      window.removeEventListener("hashchange", onHashChange);
      throw error;
    }

    void ensureDbHealthReport();
    const palette = initCommandPalette();
    initKeyboardMap({
      openCommandPalette: () => {
        palette?.open();
      },
    });
    emit("app:ready", { ts: Date.now() });

    requestAnimationFrame(() => {
      if (!appWindow) return;
      console.log("Runtime window label:", appWindow.label);
      setupDynamicMinSize();
    });
  };

  boot().catch((error) => {
    console.error("[BOOT]", error);
    window.__APP_READY__ = false;
    appReadyNotified = false;
    renderFatalBanner(error);
  });
});

window.addEventListener("beforeunload", () => {
  dbHealthUi?.unsubscribe?.();
  ambientController?.destroy?.();
});

// minimal debug handle without ts-expect-error
const DEV = import.meta.env.DEV ?? false;
if (DEV && appWindow) {
  (window as any).__win = {
    label: appWindow.label,
    setMin: (w = 1200, h = 800) =>
      appWindow.setMinSize({ width: w, height: h }),
    setSize: (w = 1200, h = 800) =>
      appWindow.setSize({ width: w, height: h }),
  };
  console.log("__win ready:", appWindow.label);
}
