import { logUI } from "@lib/uiLog";
import type { UpcomingBirthdayEntry } from "./family.utils";
import { UPCOMING_BIRTHDAY_WINDOW_DAYS } from "./family.utils";

export interface BannerBirthdaysInstance {
  element: HTMLElement;
  update(entries: UpcomingBirthdayEntry[], meta?: BannerUpdateMeta): void;
  destroy(): void;
}

export interface BannerUpdateMeta {
  totalMembers: number;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

function describeEntry(entry: UpcomingBirthdayEntry): string {
  const name = entry.member.nickname?.trim() || entry.member.name?.trim() || "Unknown";
  if (entry.daysUntil === 0) {
    return `${name} has a birthday today (${dateFormatter.format(entry.occursOn)})`;
  }
  const dayLabel = entry.daysUntil === 1 ? "day" : "days";
  return `${name} has a birthday in ${entry.daysUntil} ${dayLabel} (${dateFormatter.format(entry.occursOn)})`;
}

export function createBannerBirthdays(host: HTMLElement): BannerBirthdaysInstance {
  const container = document.createElement("section");
  container.className = "family-banner";
  container.dataset.widget = "family-birthdays";
  container.setAttribute("aria-live", "polite");
  container.setAttribute("aria-label", "Upcoming birthdays");

  const heading = document.createElement("h2");
  heading.className = "family-banner__title";
  heading.textContent = "Upcoming birthdays";

  const list = document.createElement("ul");
  list.className = "family-banner__list";

  const emptyState = document.createElement("div");
  emptyState.className = "family-banner__empty";
  emptyState.textContent = `No birthdays in the next ${UPCOMING_BIRTHDAY_WINDOW_DAYS} days`;

  container.append(heading, list, emptyState);
  host.innerHTML = "";
  host.appendChild(container);

  logUI("INFO", "ui.family.banner.mounted", {});

  let mounted = false;

  const renderEntries = (entries: UpcomingBirthdayEntry[]) => {
    list.innerHTML = "";
    if (entries.length === 0) {
      emptyState.hidden = false;
      return;
    }
    emptyState.hidden = true;
    for (const entry of entries) {
      const item = document.createElement("li");
      item.className = "family-banner__item";

      const card = document.createElement("article");
      card.className = "family-banner__card";
      card.setAttribute("aria-label", describeEntry(entry));

      const icon = document.createElement("span");
      icon.className = "family-banner__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "🎂";

      const name = document.createElement("h3");
      name.className = "family-banner__name";
      name.textContent = entry.member.nickname?.trim() || entry.member.name?.trim() || "Unknown";

      const detail = document.createElement("p");
      detail.className = "family-banner__detail";
      if (entry.daysUntil === 0) {
        detail.textContent = "Birthday is today";
      } else {
        const dayLabel = entry.daysUntil === 1 ? "day" : "days";
        detail.textContent = `Birthday in ${entry.daysUntil} ${dayLabel}`;
      }

      const subtext = document.createElement("p");
      subtext.className = "family-banner__date";
      subtext.textContent = dateFormatter.format(entry.occursOn);

      card.append(icon, name, detail, subtext);
      item.appendChild(card);
      list.appendChild(item);
    }

    if (!mounted) {
      requestAnimationFrame(() => {
        container.classList.add("family-banner--visible");
        mounted = true;
      });
    }
  };

  renderEntries([]);

  return {
    element: container,
    update(entries: UpcomingBirthdayEntry[], meta?: BannerUpdateMeta) {
      renderEntries(entries);
      logUI("INFO", "ui.family.banner.updated", {
        members: meta?.totalMembers ?? null,
        upcoming_count: entries.length,
      });
    },
    destroy() {
      container.remove();
    },
  };
}
