import { logUI } from "@lib/uiLog";
import type { UpcomingBirthdayEntry } from "./family.utils";

export interface FamilyHeaderState {
  householdName: string | null;
  memberCount: number;
  nextBirthday: UpcomingBirthdayEntry | null;
}

export interface FamilyHeaderInstance {
  element: HTMLElement;
  update(state: Partial<FamilyHeaderState>): void;
  destroy(): void;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
});

function formatMemberCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "0 Members";
  return count === 1 ? "1 Member" : `${count} Members`;
}

function formatNextBirthday(entry: UpcomingBirthdayEntry | null): string {
  if (!entry) return "Next Birthday: —";
  const displayName = entry.member.nickname?.trim() || entry.member.name?.trim() || "Unknown";
  const formattedDate = dateFormatter.format(entry.occursOn);
  return `Next Birthday: ${displayName} – ${formattedDate}`;
}

export function createFamilyHeader(host: HTMLElement): FamilyHeaderInstance {
  const element = document.createElement("header");
  element.className = "family-header";
  element.dataset.widget = "family-header";

  const textBlock = document.createElement("div");
  textBlock.className = "family-header__text";

  const title = document.createElement("h1");
  title.className = "family-header__title";
  title.textContent = "Family";

  const metaList = document.createElement("div");
  metaList.className = "family-header__meta";

  const memberCountEl = document.createElement("span");
  memberCountEl.className = "family-header__members";

  const nextBirthdayEl = document.createElement("span");
  nextBirthdayEl.className = "family-header__next";

  metaList.append(memberCountEl, nextBirthdayEl);
  textBlock.append(title, metaList);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "family-header__cta";
  addButton.textContent = "Add member";
  addButton.setAttribute("aria-label", "Add a family member");

  const handleAddMember = () => {
    logUI("INFO", "ui.family.add_member.cta", { source: "header" });
    // Stubbed modal hook for PR8.
    console.info("FamilyShell:AddMember", { source: "header" });
  };

  addButton.addEventListener("click", handleAddMember);

  element.append(textBlock, addButton);
  host.innerHTML = "";
  host.appendChild(element);

  logUI("INFO", "ui.family.header.mounted", {});

  let state: FamilyHeaderState = {
    householdName: null,
    memberCount: 0,
    nextBirthday: null,
  };

  const apply = () => {
    title.textContent = state.householdName?.trim() || "Family";
    memberCountEl.textContent = formatMemberCount(state.memberCount);
    nextBirthdayEl.textContent = formatNextBirthday(state.nextBirthday);
  };

  apply();

  return {
    element,
    update(partial: Partial<FamilyHeaderState>) {
      state = { ...state, ...partial };
      apply();
    },
    destroy() {
      addButton.removeEventListener("click", handleAddMember);
      element.remove();
    },
  };
}
