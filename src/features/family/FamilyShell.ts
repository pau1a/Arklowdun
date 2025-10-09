import {
  createBannerBirthdays,
  type BannerBirthdaysInstance,
} from "./BannerBirthdays";
import { createFamilyHeader, type FamilyHeaderInstance } from "./FamilyHeader";

export interface FamilyShellInstance {
  element: HTMLElement;
  header: FamilyHeaderInstance;
  banner: BannerBirthdaysInstance;
  contentHost: HTMLElement;
  destroy(): void;
}

export function createFamilyShell(container: HTMLElement): FamilyShellInstance {
  const shell = document.createElement("section");
  shell.className = "family-shell";
  shell.dataset.widget = "family-shell";

  const headerSlot = document.createElement("div");
  headerSlot.className = "family-shell__header";

  const contentSlot = document.createElement("div");
  contentSlot.className = "family-shell__content";
  contentSlot.setAttribute("role", "region");
  contentSlot.setAttribute("aria-label", "Family members");

  const bannerHost =
    typeof document !== "undefined"
      ? (document.getElementById("page-banner") as HTMLElement | null)
      : null;

  if (bannerHost) {
    bannerHost.hidden = false;
    bannerHost.setAttribute("aria-hidden", "false");
    bannerHost.dataset.bannerMode = "interactive";
    bannerHost.style.removeProperty("background-image");
    bannerHost.style.removeProperty("--banner-pos-x");
    bannerHost.style.removeProperty("--banner-pos-y");
  }

  let inlineBannerSlot: HTMLElement | null = null;
  if (!bannerHost) {
    inlineBannerSlot = document.createElement("div");
    inlineBannerSlot.className = "family-shell__banner";
    shell.classList.add("family-shell--inline-banner");
  }

  shell.append(headerSlot);
  if (inlineBannerSlot) {
    shell.append(inlineBannerSlot);
  }
  shell.append(contentSlot);
  container.innerHTML = "";
  container.appendChild(shell);

  const header = createFamilyHeader(headerSlot);
  const banner = createBannerBirthdays(bannerHost ?? inlineBannerSlot ?? contentSlot);

  return {
    element: shell,
    header,
    banner,
    contentHost: contentSlot,
    destroy() {
      header.destroy();
      banner.destroy();
      if (bannerHost && bannerHost.dataset.bannerMode === "interactive") {
        bannerHost.removeAttribute("data-banner-mode");
        if (!bannerHost.hasAttribute("role")) {
          bannerHost.setAttribute("role", "img");
        }
      }
      shell.remove();
    },
  };
}
