// Simple tabbed UI scaffold for Arklowdun
// Bundle Font Awesome locally (no remote kit, no CORS, works offline)
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./debug";
import "./theme.scss";
import "./styles.scss";
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
  type RouteDefinition,
} from "./routes";
import { defaultHouseholdId } from "./db/household";
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

// Resolve main app logo (SVG) as a URL the bundler can serve
const appLogoUrl = new URL("./assets/logo.svg", import.meta.url).href;

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
  }

  return ctx;
}

function ensureCanonicalHash(route: RouteDefinition) {
  if (window.location.hash === route.hash) return;
  history.replaceState(null, "", route.hash);
}

async function renderApp({ route }: { route: RouteDefinition }) {
  const context = ensureLayout();
  const reusedLayout = layoutMounted;

  context.sidebar.setActive(route.id);
  context.footer.setActive(route.id);
  ensureCanonicalHash(route);

  if (currentRouteId === route.id) {
    log.debug("renderApp: route unchanged", { route: route.id, reusedLayout });
    return;
  }

  const sequence = ++renderSequence;
  const container = context.content.view;

  actions.setActivePane(route.id);
  runViewCleanups(container);

  log.debug("renderApp: mount route", { route: route.id, reusedLayout });

  try {
    await route.mount(container);
  } catch (error) {
    log.error("renderApp: mount failed", error);
    return;
  }

  if (sequence === renderSequence) {
    currentRouteId = route.id;
    // Update toolbar page title using route display label (fallback to id)
    const display = route.display;
    setAppToolbarTitle(display?.label ?? route.id);
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

async function handleRouteChange() {
  const route = resolveRouteFromHash(window.location.hash);
  try {
    await renderApp({ route });
  } catch (error) {
    log.error("handleRouteChange failed", error);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("app") ?? document.body;
  mountMacToolbar(root);
  // Use the same SVG as the app-wide favicon/brand mark
  ensureFavicon(appLogoUrl);

  log.debug("app booted");
  defaultHouseholdId().catch((e) => console.error("DB init failed:", e));

  const onHashChange = () => {
    void handleRouteChange();
  };
  window.addEventListener("hashchange", onHashChange);

  void (async () => {
    await handleRouteChange();
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
  })();
});

window.addEventListener("beforeunload", () => {
  dbHealthUi?.unsubscribe?.();
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
