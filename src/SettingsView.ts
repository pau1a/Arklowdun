export function SettingsView(container: HTMLElement) {
  const section = document.createElement("section");
  section.className = "settings";
  section.innerHTML = `
    <a href="#" class="settings__back">Back to dashboard</a>
    <h2 class="settings__title">Settings</h2>

    <section class="card settings__section" aria-labelledby="settings-general">
      <h3 id="settings-general">General</h3>
      <p class="settings__empty">No settings yet.</p>
    </section>

    <section class="card settings__section" aria-labelledby="settings-storage">
      <h3 id="settings-storage">Storage and permissions</h3>
      <p class="settings__empty">No settings yet.</p>
    </section>

    <section class="card settings__section" aria-labelledby="settings-notifications">
      <h3 id="settings-notifications">Notifications</h3>
      <p class="settings__empty">No settings yet.</p>
    </section>

    <section class="card settings__section" aria-labelledby="settings-appearance">
      <h3 id="settings-appearance">Appearance</h3>
      <p class="settings__empty">No settings yet.</p>
    </section>

    <section class="card settings__section" aria-labelledby="settings-about">
      <h3 id="settings-about">About and diagnostics</h3>
      <p class="settings__empty">No settings yet.</p>
    </section>
  `;

  container.innerHTML = "";
  container.appendChild(section);

  section
    .querySelector<HTMLAnchorElement>(".settings__back")
    ?.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelector<HTMLAnchorElement>("#nav-dashboard")?.click();
    });
}

