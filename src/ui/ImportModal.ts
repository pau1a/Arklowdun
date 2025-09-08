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
      const p = e.payload as { logPath: string };
      logLink.innerHTML = "";
      const btn = document.createElement("button");
      btn.textContent = "Open log";
      btn.onclick = () => openPath(p.logPath);
      logLink.appendChild(btn);
      line("Started");
    });
    unsub.push(u1);

    const u2 = await listen("import://progress", (e:any) => {
      const { step, current, total } = e.payload as any;
      line(total ? `Step ${current}/${total}: ${step}` : `Step: ${step}`);
    });
    unsub.push(u2);

    const u3 = await listen("import://warn", (e:any) => {
      line(`Warning: ${e.payload?.message ?? "?"}`);
    });
    unsub.push(u3);

    const u4 = await listen("import://error", (e:any) => {
      line(`Error: ${e.payload?.message ?? "unknown"}`);
    });
    unsub.push(u4);

    const u5 = await listen("import://done", (e:any) => {
      const { imported, skipped, durationMs } = e.payload as any;
      line(`Done: imported=${imported} skipped=${skipped} (${durationMs}ms)`);
    });
    unsub.push(u5);

    try {
      await call("import_run_legacy", { householdId: hh, dryRun: !!dry.checked });
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
