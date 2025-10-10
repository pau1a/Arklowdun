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

  // Always render the birthdays banner inline within the Family shell.
  const inlineBannerSlot: HTMLElement = document.createElement("div");
  inlineBannerSlot.className = "family-shell__banner";
  shell.classList.add("family-shell--inline-banner");

  shell.append(headerSlot);
  shell.append(inlineBannerSlot);
  shell.append(contentSlot);
  container.innerHTML = "";
  container.appendChild(shell);

  const header = createFamilyHeader(headerSlot);
  const banner = createBannerBirthdays(inlineBannerSlot);

  return {
    element: shell,
    header,
    banner,
    contentHost: contentSlot,
    destroy() {
      header.destroy();
      banner.destroy();
      shell.remove();
    },
  };
}
