// src/ManageView.ts

export function ManageView(container: HTMLElement) {
  const section = document.createElement("section");
  section.className = "manage-page";

  section.innerHTML = `
    <h2>Manage</h2>
    <nav class="manage" aria-label="Manage categories">
      <a id="nav-primary" href="#primary">Primary</a>
      <a id="nav-secondary" href="#secondary">Secondary</a>
      <a id="nav-tasks" href="#tasks">Tasks</a>
      <a id="nav-bills" href="#bills">Bills</a>
      <a id="nav-insurance" href="#insurance">Insurance</a>
      <a id="nav-property" href="#property">Property</a>
      <a id="nav-vehicles" href="#vehicles">Vehicles</a>
      <a id="nav-pets" href="#pets">Pets</a>
      <a id="nav-family" href="#family">Family</a>
      <a id="nav-inventory" href="#inventory">Inventory</a>
      <a id="nav-budget" href="#budget">Budget</a>
      <a id="nav-shopping" href="#shopping">Shopping List</a>
    </nav>
  `;

  container.innerHTML = "";
  container.appendChild(section);
}
