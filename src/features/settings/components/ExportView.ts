import createButton from "@ui/Button";
import { toast } from "@ui/Toast";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { runExport } from "../api/export";

export interface ExportViewInstance {
  element: HTMLElement;
}

export function createExportView(): ExportViewInstance {
  const section = document.createElement("section");
  section.className = "card settings__section settings__section--export";
  section.setAttribute("aria-labelledby", "settings-export");

  const heading = document.createElement("h3");
  heading.id = "settings-export";
  heading.textContent = "Export data";

  const helper = document.createElement("p");
  helper.className = "settings__helper export__helper";
  helper.textContent = "Create a portable export with data, attachments, and a verification script.";

  const controls = document.createElement("div");
  controls.className = "export__controls";

  const pickButton = createButton({ label: "Choose folder…", variant: "ghost" });
  const exportButton = createButton({ label: "Export", variant: "primary" });
  exportButton.disabled = true;

  const status = document.createElement("p");
  status.className = "export__status";

  let outDir: string | null = null;

  pickButton.onclick = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string" && selected.length > 0) {
        outDir = selected;
        exportButton.disabled = false;
        status.textContent = `Destination: ${selected}`;
      }
    } catch (e) {
      // ignore cancel
    }
  };

  exportButton.onclick = async () => {
    if (!outDir) return;
    exportButton.disabled = true;
    pickButton.disabled = true;
    status.textContent = "Export in progress…";
    try {
      const entry = await runExport(outDir);
      status.textContent = `Export complete. Folder: ${entry.directory}`;
      try {
        const mod = await import("@tauri-apps/plugin-opener");
        const reveal = (mod as any)?.open as undefined | ((p: string) => Promise<void>);
        const action = {
          label: "Reveal",
          onSelect: async () => {
            if (typeof reveal === "function") {
              try {
                await reveal(entry.manifestPath);
              } catch {
                /* ignore */
              }
            } else {
              try { await navigator?.clipboard?.writeText?.(entry.directory); } catch {}
            }
          },
        };
        toast.show({ kind: "success", message: `Export complete: ${entry.directory}`, actions: [action] });
      } catch {
        // Fallback toast without action
        toast.show({ kind: "success", message: `Export complete: ${entry.directory}` });
      }
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : String(e);
      status.textContent = msg;
      toast.show({ kind: "error", message: msg });
    } finally {
      pickButton.disabled = false;
      exportButton.disabled = !outDir;
    }
  };

  controls.append(pickButton, exportButton);
  section.append(heading, helper, controls, status);
  return { element: section };
}

export default createExportView;
