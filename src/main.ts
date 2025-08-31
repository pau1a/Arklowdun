// Simple tabbed UI scaffold for Arklowdun

type View = "files" | "calendar";

const viewEl = () => document.querySelector<HTMLElement>("#view");
const btnFiles = () => document.querySelector<HTMLButtonElement>("#nav-files");
const btnCalendar = () =>
  document.querySelector<HTMLButtonElement>("#nav-calendar");

function setActive(tab: View) {
  const filesBtn = btnFiles();
  const calBtn = btnCalendar();
  filesBtn?.classList.toggle("active", tab === "files");
  calBtn?.classList.toggle("active", tab === "calendar");
  filesBtn?.setAttribute("aria-pressed", String(tab === "files"));
  calBtn?.setAttribute("aria-pressed", String(tab === "calendar"));
}

function renderFiles() {
  const el = viewEl();
  if (!el) return;
  el.innerHTML = `
    <section>
      <h2>Files</h2>
      <p>Connect a folder to manage your home documents.</p>
      <div class="row">
        <button id="choose-folder">Choose Folder</button>
        <button id="new-file" disabled title="Coming soon">New File</button>
      </div>
      <div id="file-list" class="list empty">No folder selected.</div>
    </section>
  `;
}

function renderCalendar() {
  const el = viewEl();
  if (!el) return;
  el.innerHTML = `
    <section>
      <h2>Calendar</h2>
      <p>Track events, reminders, and recurring tasks (coming soon).</p>
      <div class="row">
        <button disabled title="Coming soon">Add Event</button>
        <button disabled title="Coming soon">Import .ics</button>
      </div>
      <div class="calendar-empty">Calendar view placeholder</div>
    </section>
  `;
}

function navigate(to: View) {
  setActive(to);
  if (to === "files") renderFiles();
  else renderCalendar();
}

window.addEventListener("DOMContentLoaded", () => {
  btnFiles()?.addEventListener("click", () => navigate("files"));
  btnCalendar()?.addEventListener("click", () => navigate("calendar"));
  navigate("files");
});
