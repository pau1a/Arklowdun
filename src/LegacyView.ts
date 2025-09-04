export function LegacyView(container: HTMLElement) {
  const section = document.createElement("section");
  section.innerHTML = `
    <h2>Legacy</h2>
    <nav class="legacy">
      <a id="nav-primary" href="#">Primary</a>
      <a id="nav-secondary" href="#">Secondary</a>
      <a id="nav-tertiary" href="#">Tertiary</a>
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
