import createButton from "@ui/Button";
import { toast } from "@ui/Toast";
import { runExport } from "../api/export";
import { revealPath } from "@lib/ipc/opener";
import { openDirectoryDialog } from "../api/dialog";
import { recoveryText } from "@strings/recovery";

export interface ExportViewInstance {
  element: HTMLElement;
}

export function createExportView(): ExportViewInstance {
  const section = document.createElement("section");
  section.className = "card settings__section settings__section--export";
  section.setAttribute("aria-labelledby", "settings-export");

  const heading = document.createElement("h3");
  heading.id = "settings-export";
  heading.textContent = recoveryText("db.export.section.title");

  const helper = document.createElement("p");
  helper.className = "settings__helper export__helper";
  helper.textContent = recoveryText("db.export.section.helper");

  const controls = document.createElement("div");
  controls.className = "export__controls";

  const pickButton = createButton({
    label: recoveryText("db.export.button.choose"),
    variant: "ghost",
  });
  const exportButton = createButton({
    label: recoveryText("db.export.button.run"),
    variant: "primary",
  });
  exportButton.disabled = true;

  const status = document.createElement("p");
  status.className = "export__status";

  let outDir: string | null = null;

  pickButton.onclick = async () => {
    try {
      const selected = await openDirectoryDialog();
      if (typeof selected === "string" && selected.length > 0) {
        outDir = selected;
        exportButton.disabled = false;
        status.textContent = recoveryText("db.export.status.destination", {
          path: selected,
        });
      }
    } catch (e) {
      // ignore cancel
    }
  };

  exportButton.onclick = async () => {
    if (!outDir) return;
    exportButton.disabled = true;
    pickButton.disabled = true;
    status.textContent = recoveryText("db.export.status.running");
    try {
      const entry = await runExport(outDir);
      status.textContent = recoveryText("db.export.status.complete", {
        path: entry.directory,
      });
      try {
        const action = {
          label: recoveryText("db.common.reveal"),
          onSelect: async () => {
            const ok = await revealPath(entry.manifestPath);
            if (!ok) {
              try { await navigator?.clipboard?.writeText?.(entry.directory); } catch {}
            }
          },
        };
        toast.show({
          kind: "success",
          message: recoveryText("db.export.toast.success_path", {
            path: entry.directory,
          }),
          actions: [action],
        });
      } catch {
        // Fallback toast without action
        toast.show({
          kind: "success",
          message: recoveryText("db.export.toast.success_path", {
            path: entry.directory,
          }),
        });
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
