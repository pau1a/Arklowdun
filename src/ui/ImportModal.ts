import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { call } from "../db/call";
import { defaultHouseholdId } from "../db/household";
import { showError } from "./errors";

export function ImportModal(el: HTMLElement) {
  el.innerHTML = `
    <div class="modal">
      <h3>Import legacy data</h3>
      <label><input type="checkbox" id="dry" checked/> Dry-run</label>
      <div id="progress" class="log"></div>
      <div class="actions">
        <button id="start">Start</button>
        <button id="close">Close</button>
      </div>
      <div id="loglink"></div>
    </div>
  `;

  const dry = el.querySelector<HTMLInputElement>("#dry")!;
  const progress = el.querySelector<HTMLDivElement>("#progress")!;
  const logLink = el.querySelector<HTMLDivElement>("#loglink")!;
  let unsub: Array<() => void> = [];

  function line(s: string) {
    const p = document.createElement("div");
    p.textContent = s;
    progress.appendChild(p);
    progress.scrollTop = progress.scrollHeight;
  }

  async function start() {
    const hh = await defaultHouseholdId();

    const u1 = await listen("import://started", (e:any) => {
      const p = e.payload as any;
      const lp = p.fields?.logPath;
      if (lp) {
        logLink.innerHTML = "";
        const btn = document.createElement("button");
        btn.textContent = "Open log";
        btn.onclick = () => openPath(lp);
        logLink.appendChild(btn);
      }
      line("Started");
    });
    unsub.push(u1);

    const u2 = await listen("import://progress", (e:any) => {
      const p = e.payload as any;
      if (p.event === "step_start") {
        line(`Start: ${p.step}`);
      } else if (p.event === "step_end") {
        line(`End: ${p.step} (${p.duration_ms}ms)`);
      }
    });
    unsub.push(u2);

    const u3 = await listen("import://error", (e:any) => {
      line(`Error: ${e.payload?.fields?.source ?? "unknown"}`);
    });
    unsub.push(u3);

    const u4 = await listen("import://done", (e:any) => {
      const p = e.payload as any;
      line(`Done: imported=${p.fields?.imported} skipped=${p.fields?.skipped} (${p.duration_ms}ms)`);
    });
    unsub.push(u4);

    try {
      await call("import_run_legacy", { household_id: hh, dry_run: !!dry.checked });
    } catch (err) {
      showError(err);
    }
  }

  el.querySelector<HTMLButtonElement>("#start")!.onclick = start;
  el.querySelector<HTMLButtonElement>("#close")!.onclick = () => {
    unsub.forEach(u => u()); unsub = [];
    el.remove();
  };
}
