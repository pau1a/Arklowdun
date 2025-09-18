import { call } from "../api/call";
import { defaultHouseholdId } from "../db/household";
import { showError } from "./errors";
import { presentFsError } from "@lib/ipc";
import {
  listenImportDone,
  listenImportError,
  listenImportProgress,
  listenImportStarted,
} from "@features/files/api/importApi";

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

    const u1 = await listenImportStarted((event) => {
      const p = event.payload;
      const lp = typeof p.fields?.logPath === "string" ? p.fields.logPath : undefined;
      if (lp) {
        logLink.innerHTML = "";
        const btn = document.createElement("button");
        btn.textContent = "Open log";
        btn.onclick = async () => {
          try {
            await call("open_path", { path: lp });
          } catch (e) {
            presentFsError(e);
          }
        };
        logLink.appendChild(btn);
      }
      line("Started");
    });
    unsub.push(u1);

    const u2 = await listenImportProgress((event) => {
      const p = event.payload;
      if (p.event === "step_start") {
        line(`Start: ${p.step}`);
      } else if (p.event === "step_end") {
        line(`End: ${p.step} (${p.duration_ms}ms)`);
      }
    });
    unsub.push(u2);

    const u3 = await listenImportError((event) => {
      const source = event.payload.fields?.source;
      line(`Error: ${typeof source === "string" ? source : "unknown"}`);
    });
    unsub.push(u3);

    const u4 = await listenImportDone((event) => {
      const p = event.payload;
      const imported = p.fields?.imported;
      const skipped = p.fields?.skipped;
      line(
        `Done: imported=${imported ?? "unknown"} skipped=${skipped ?? "unknown"} (${p.duration_ms}ms)`,
      );
    });
    unsub.push(u4);

    try {
      await call("import_run_legacy", {
        args: { householdId: hh, dryRun: !!dry.checked },
      });
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
