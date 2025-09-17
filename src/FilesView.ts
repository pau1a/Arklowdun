import { open } from "@lib/ipc/dialog";
import {
  readDir,
  writeText,
  remove,
  mkdir,
  toUserMessage,
  type RootKey,
} from "./files/safe-fs";
import { canonicalizeAndVerify, rejectSymlinks } from "./files/path";
import { convertFileSrc } from "@lib/ipc/core";
import { STR } from "@ui/strings";
import { showError } from "@ui/errors";

const ROOT: RootKey = "attachments";

function renderBreadcrumb(path: string, el: HTMLElement) {
  el.innerHTML = "";
  const parts = path.split(/[/\\]/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const span = document.createElement("span");
    span.textContent = parts[i];
    span.className = "breadcrumb__segment" + (i === parts.length - 1 ? " current" : "");
    span.tabIndex = 0;
    el.appendChild(span);
  }
}

async function listDirectory(
  dir: string,
  listEl: HTMLTableSectionElement,
  previewEl: HTMLElement,
  pathEl: HTMLElement,
  setDir: (d: string) => void,
) {
  try {
    const entries = await readDir(dir, ROOT); // entries expose isDirectory/isFile
    renderBreadcrumb(dir, pathEl);
    listEl.innerHTML = "";
    if (entries.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      const { createEmptyState } = await import("@ui/emptyState");
      cell.appendChild(
        createEmptyState({
          title: STR.empty.filesTitle,
          actionLabel: "New file",
          onAction: () => setDir(dir),
        }),
      );
      row.appendChild(cell);
      listEl.appendChild(row);
      return;
    }
    for (const entry of entries) {
      const relPath = dir === "." ? entry.name : `${dir}/${entry.name}`;
      const row = document.createElement("tr");
      row.tabIndex = 0;

    const nameTd = document.createElement("td");
    const icon = document.createElement("span");
    icon.textContent = entry.isDirectory ? "📁" : "📄";
    icon.className = "files__icon";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = entry.name;
    nameSpan.className = "files__name";
    nameSpan.title = entry.name;
    nameTd.append(icon, nameSpan);

    const typeTd = document.createElement("td");
    typeTd.textContent = entry.isDirectory ? "Folder" : "File";

    const sizeTd = document.createElement("td");
    const modTd = document.createElement("td");

    const actionsTd = document.createElement("td");
    actionsTd.className = "files__actions-cell";
      const del = document.createElement("button");
      del.textContent = "Delete";
      del.className = "files__action";
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await remove(relPath, ROOT, { recursive: entry.isDirectory === true });
          await listDirectory(dir, listEl, previewEl, pathEl, setDir);
        } catch (err) {
          showError({ code: "INFO", message: toUserMessage(err) });
        }
      });
      actionsTd.appendChild(del);

      row.addEventListener("click", async () => {
        if (entry.isDirectory) {
          setDir(relPath);
          await listDirectory(relPath, listEl, previewEl, pathEl, setDir);
        } else {
          previewEl.innerHTML = "";
          const ext = entry.name.split(".").pop()?.toLowerCase();
          try {
            const { realPath } = await canonicalizeAndVerify(relPath, ROOT);
            await rejectSymlinks(realPath, ROOT);
            const url = convertFileSrc(realPath);
            if (
              ext &&
              ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"].includes(ext)
            ) {
              const img = document.createElement("img");
              img.src = url;
              img.style.maxWidth = "100%";
              previewEl.appendChild(img);
            } else if (ext === "pdf") {
              const embed = document.createElement("embed");
              embed.src = url;
              embed.type = "application/pdf";
              embed.style.width = "100%";
              embed.style.height = "600px";
              previewEl.appendChild(embed);
            } else {
              previewEl.textContent = "No preview available";
            }
          } catch (e) {
            showError({ code: "INFO", message: toUserMessage(e) });
          }
        }
      });

      row.append(nameTd, typeTd, sizeTd, modTd, actionsTd);
      listEl.appendChild(row);
    }
  } catch (e) {
    showError({ code: "INFO", message: toUserMessage(e) });
  }
}

export async function FilesView(container: HTMLElement) {
  const section = document.createElement("section");
  section.className = "files";
  section.innerHTML = `
    <header class="files__header">
      <div>
        <h2>Files</h2>
        <nav id="current-path" class="breadcrumb"></nav>
      </div>
      <div class="files__actions">
        <button id="select-dir" class="btn">Select Directory</button>
        <button class="btn">New Folder</button>
        <button class="btn">New File</button>
      </div>
    </header>
    <div class="card files__panel">
      <table class="files__table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Size</th>
            <th>Modified</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="file-list"></tbody>
      </table>
    </div>
    <form id="new-file-form" style="display:none">
      <input id="new-file-name" type="text" placeholder="New file name" required />
      <button type="submit">Create File</button>
    </form>
    <form id="new-folder-form" style="display:none">
      <input id="new-folder-name" type="text" placeholder="New folder name" required />
      <button type="submit">Create Folder</button>
    </form>
    <div id="preview"></div>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const selectBtn = section.querySelector<HTMLButtonElement>("#select-dir");
  const listEl = section.querySelector<HTMLTableSectionElement>("#file-list");
  const previewEl = section.querySelector<HTMLElement>("#preview");
  const pathEl = section.querySelector<HTMLElement>("#current-path");
  const fileForm = section.querySelector<HTMLFormElement>("#new-file-form");
  const folderForm = section.querySelector<HTMLFormElement>("#new-folder-form");
  const fileNameInput = section.querySelector<HTMLInputElement>(
    "#new-file-name",
  );
  const folderNameInput = section.querySelector<HTMLInputElement>(
    "#new-folder-name",
  );

  let currentDir: string | null = null;

  const setDir = (d: string) => {
    currentDir = d;
  };

  selectBtn?.addEventListener("click", async () => {
    const dir = await open({ directory: true });
    if (typeof dir === "string") {
      try {
        const { base, realPath } = await canonicalizeAndVerify(dir, ROOT);
        const rel = realPath.slice(base.length) || ".";
        setDir(rel);
        if (pathEl) renderBreadcrumb(rel, pathEl);
        if (fileForm) fileForm.style.display = "block";
        if (folderForm) folderForm.style.display = "block";
        if (listEl && previewEl && pathEl)
          await listDirectory(rel, listEl, previewEl, pathEl, setDir);
      } catch (e) {
        showError({ code: "INFO", message: toUserMessage(e) });
      }
    }
  });

  fileForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (currentDir === null || !fileNameInput) return;
    const relPath =
      currentDir === "."
        ? fileNameInput.value
        : `${currentDir}/${fileNameInput.value}`;
    try {
      await writeText(relPath, ROOT, "");
      fileNameInput.value = "";
      if (listEl && previewEl && pathEl)
        await listDirectory(currentDir, listEl, previewEl, pathEl, setDir);
    } catch (err) {
      showError({ code: "INFO", message: toUserMessage(err) });
    }
  });

  folderForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (currentDir === null || !folderNameInput) return;
    const relPath =
      currentDir === "."
        ? folderNameInput.value
        : `${currentDir}/${folderNameInput.value}`;
    try {
      await mkdir(relPath, ROOT, { recursive: true });
      folderNameInput.value = "";
      if (listEl && previewEl && pathEl)
        await listDirectory(currentDir, listEl, previewEl, pathEl, setDir);
    } catch (err) {
      showError({ code: "INFO", message: toUserMessage(err) });
    }
  });
}

