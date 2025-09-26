// src/DashboardView.ts
import createAnimatedWaves from "./components/visuals/AnimatedWaves";
import { nowMs, toDate } from "./db/time";
import { registerViewCleanup } from "./utils/viewLifecycle";
import { defaultHouseholdId } from "./db/household";
import { billsApi, policiesRepo, eventsApi } from "./repos";
import { vehiclesRepo } from "./db/vehiclesRepo";
import type { Event } from "./models";
import { STR } from "./ui/strings";
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" });

function statusFor(dueMs: number, now: number): "soon" | "today" | "overdue" {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  if (dueMs < now) return "overdue";
  if (dueMs >= start.getTime() && dueMs <= end.getTime()) return "today";
  return "soon";
}

export async function DashboardView(container: HTMLElement) {
  const section = document.createElement("section");
  section.className = "dashboard";
  section.innerHTML = `
      <div class="dashboard__background" aria-hidden="true"></div>
      <header class="dashboard__header">
        <div>
          <h2>Dashboard</h2>
          <p class="kicker">What needs your attention</p>
        </div>
        <div class="dashboard__actions">
          <button class="btn btn--accent">+ Event</button>
          <button class="btn btn--secondary">+ Note</button>
        </div>
      </header>
      <div class="card">
        <h3><i class="card__icon fa-solid fa-triangle-exclamation" aria-hidden="true"></i>Attention</h3>
        <div class="list" id="dash-list" role="list"></div>
      </div>
      <div class="card">
        <h3><i class="card__icon fa-regular fa-clock" aria-hidden="true"></i>Upcoming</h3>
        <p>Coming soon</p>
      </div>
    `;

  const backgroundHost = section.querySelector<HTMLDivElement>(".dashboard__background");
  if (backgroundHost) {
    const waves = createAnimatedWaves({ variant: "dark" });
    waves.update({ className: "dashboard__waves" });
    backgroundHost.appendChild(waves);
    registerViewCleanup(container, () => waves.destroy());
  }
  container.innerHTML = "";
  container.appendChild(section);

  const listEl = section.querySelector<HTMLDivElement>("#dash-list");
  const items: { date: number; text: string }[] = [];
  const now = nowMs();
  const hh = await defaultHouseholdId();

  // Bills
  {
    const SIXTY_DAYS = 60 * 24 * 60 * 60 * 1000;
    const upcomingBills = await billsApi.dueBetween(hh, now, now + SIXTY_DAYS, 20, 0);
    const next = upcomingBills[0];
    if (next) {
      const due = next.due_date;
      items.push({
        date: due,
        text: `Bill ${money.format(next.amount / 100)} due ${toDate(due).toLocaleDateString()}`,
      });
    }
  }

  // Policies
  {
    const policies = await policiesRepo.list({ householdId: hh });
    const next = policies.filter(p => p.due_date >= now).sort((a,b) => a.due_date - b.due_date)[0];
    if (next) {
      const due = next.due_date;
      items.push({ date: due, text: `Policy ${money.format(next.amount / 100)} renews ${toDate(due).toLocaleDateString()}` });
    }
  }

  // Vehicles
  {
    const vehicles = await vehiclesRepo.list(hh);
    const vehicleDates: { date: number; text: string }[] = [];
    for (const v of vehicles) {
      if (v.next_mot_due && v.next_mot_due >= now) {
        vehicleDates.push({ date: v.next_mot_due, text: `${v.name} MOT ${toDate(v.next_mot_due).toLocaleDateString()}` });
      }
      if (v.next_service_due && v.next_service_due >= now) {
        vehicleDates.push({ date: v.next_service_due, text: `${v.name} service ${toDate(v.next_service_due).toLocaleDateString()}` });
      }
    }
    vehicleDates.sort((a, b) => a.date - b.date);
    if (vehicleDates[0]) items.push(vehicleDates[0]);
  }

  // Events (via eventsApi)
  {
    const eventsResult = await eventsApi.listRange(
      hh,
      now,
      Date.now() + 90 * 24 * 60 * 60 * 1000,
    );
    const events: Event[] = [...eventsResult.items];
    const next = events.sort((a, b) => a.start_at_utc - b.start_at_utc)[0];
    if (next) {
      const formatted = new Intl.DateTimeFormat(undefined, {
        timeZone: next.tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(next.start_at_utc));
      items.push({ date: next.start_at_utc, text: `${next.title} ${formatted}` });
    }
  }

  // Render
  items.sort((a, b) => a.date - b.date);
  if (!items.length) {
    if (listEl) {
      const { createEmptyState } = await import("./ui/EmptyState");
      listEl.appendChild(
        createEmptyState({
          title: STR.empty.dashboardTitle,
          body: "You're all caught up.",
        }),
      );
    }
  } else {
    items.forEach(({ date, text }) => {
      const li = document.createElement("div");
      li.className = "item";

      const when = statusFor(date, now);
      const left = document.createElement("div");
      left.className = "item__left";
      left.innerHTML = `
        <span class="status-dot status--${when}" aria-hidden="true"></span>
        <span>${text}</span>
      `;

      const right = document.createElement("div");
      right.className = "item__right";
      right.innerHTML = `<a href="#" class="pill pill--view">View</a>`;

      li.append(left, right);
      listEl?.appendChild(li);
    });
  }
}
