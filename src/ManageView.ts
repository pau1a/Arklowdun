// src/ManageView.ts

export function ManageView(container: HTMLElement) {
  const section = document.createElement("section");
  section.className = "manage-page";

  section.innerHTML = `
    <h2>Manage</h2>
    <nav class="manage" aria-label="Manage categories">
      <a id="nav-primary" href="#">Primary</a>
      <a id="nav-secondary" href="#">Secondary</a>
      <a id="nav-tasks" href="#">Tasks</a>
      <a id="nav-bills" href="#">Bills</a>
      <a id="nav-insurance" href="#">Insurance</a>
      <a id="nav-property" href="#">Property</a>
      <a id="nav-vehicles" href="#">Vehicles</a>
      <a id="nav-pets" href="#">Pets</a>
      <a id="nav-family" href="#">Family</a>
      <a id="nav-inventory" href="#">Inventory</a>
      <a id="nav-budget" href="#">Budget</a>
      <a id="nav-shopping" href="#">Shopping List</a>
    </nav>
  `;

  container.innerHTML = "";
  container.appendChild(section);
}
