import { bannerFor } from "./banner";

export interface PageBannerRouteLike {
  id: string;
  display?: { label?: string | null } | null;
}

export function updatePageBanner(route: PageBannerRouteLike): void {
  if (typeof document === "undefined") return;
  const bannerEl = document.getElementById("page-banner") as HTMLDivElement | null;
  if (!bannerEl) return;
  const body = document.body;

  // Ensure interactive mode is cleared in case a previous route enabled it.
  if (bannerEl.dataset.bannerMode === "interactive") {
    delete bannerEl.dataset.bannerMode;
    bannerEl.innerHTML = "";
    bannerEl.setAttribute("role", "img");
  }

  const key = route.id.toLowerCase();
  const label = route.display?.label ?? key;
  const url = bannerFor(key);

  if (url) {
    bannerEl.hidden = false;
    bannerEl.style.backgroundImage = `url("${url}")`;
    bannerEl.style.setProperty("--banner-pos-x", "50%");
    bannerEl.style.setProperty("--banner-pos-y", "50%");
    bannerEl.setAttribute("aria-hidden", "false");
    bannerEl.setAttribute("aria-label", `${label} banner`);
    body.dataset.bannerVisibility = "visible";
  } else {
    bannerEl.hidden = true;
    bannerEl.style.removeProperty("background-image");
    bannerEl.style.removeProperty("--banner-pos-x");
    bannerEl.style.removeProperty("--banner-pos-y");
    bannerEl.setAttribute("aria-hidden", "true");
    bannerEl.removeAttribute("aria-label");
    delete body.dataset.bannerVisibility;
  }
}
