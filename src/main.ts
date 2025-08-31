// Simple tabbed UI scaffold for Arklowdun

type View = "dashboard" | "primary" | "secondary" | "tertiary";

const viewEl = () => document.querySelector<HTMLElement>("#view");
const linkDashboard = () =>
  document.querySelector<HTMLAnchorElement>("#nav-dashboard");
const linkPrimary = () =>
  document.querySelector<HTMLAnchorElement>("#nav-primary");
const linkSecondary = () =>
  document.querySelector<HTMLAnchorElement>("#nav-secondary");
const linkTertiary = () =>
  document.querySelector<HTMLAnchorElement>("#nav-tertiary");

function setActive(tab: View) {
  const tabs: Record<View, HTMLAnchorElement | null> = {
    dashboard: linkDashboard(),
    primary: linkPrimary(),
    secondary: linkSecondary(),
    tertiary: linkTertiary(),
  };
  (Object.keys(tabs) as View[]).forEach((name) => {
    const el = tabs[name];
    const active = name === tab;
    el?.classList.toggle("active", active);
    if (active) el?.setAttribute("aria-current", "page");
    else el?.removeAttribute("aria-current");
  });
}

function renderBlank(title: string) {
  const el = viewEl();
  if (!el) return;
  el.innerHTML = `<section><h2>${title}</h2></section>`;
}

function navigate(to: View) {
  setActive(to);
  const title = to.charAt(0).toUpperCase() + to.slice(1);
  renderBlank(title);
}

window.addEventListener("DOMContentLoaded", () => {
  linkDashboard()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("dashboard");
  });
  linkPrimary()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("primary");
  });
  linkSecondary()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("secondary");
  });
  linkTertiary()?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("tertiary");
  });
  navigate("dashboard");
});

