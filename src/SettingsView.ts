export function SettingsView(container: HTMLElement) {
  const section = document.createElement("section");
  section.innerHTML = `
    <h2>Settings</h2>
    <p>Manage application preferences.</p>
  `;
  container.innerHTML = "";
  container.appendChild(section);
}

