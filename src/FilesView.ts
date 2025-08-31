import { open } from "@tauri-apps/api/dialog";
import {
  readDir,
  writeFile,
  removeFile,
  removeDir,
  createDir,
} from "@tauri-apps/api/fs";
import { join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";

async function listDirectory(
  dir: string,
  listEl: HTMLUListElement,
  previewEl: HTMLElement,
  pathEl: HTMLElement,
  setDir: (d: string) => void,
) {
  const entries = await readDir(dir);
  listEl.innerHTML = "";
  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "list empty";
    empty.textContent = "No files";
    listEl.appendChild(empty);
    return;
  }
  for (const entry of entries) {
    const li = document.createElement("li");
    li.textContent = entry.name;
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        if (entry.children) await removeDir(entry.path, { recursive: true });
        else await removeFile(entry.path);
        await listDirectory(dir, listEl, previewEl, pathEl, setDir);
      } catch (err) {
        console.error("Failed to delete", err);
      }
    });
    li.appendChild(del);
    li.addEventListener("click", async () => {
      if (entry.children) {
        setDir(entry.path);
        pathEl.textContent = entry.path;
        await listDirectory(entry.path, listEl, previewEl, pathEl, setDir);
      } else {
        previewEl.innerHTML = "";
        const ext = entry.name.split(".").pop()?.toLowerCase();
        const url = convertFileSrc(entry.path);
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
      }
    });
    listEl.appendChild(li);
  }
}

export async function FilesView(container: HTMLElement) {
  const section = document.createElement("section");
  section.innerHTML = `
    <h2>Files</h2>
    <button id="select-dir">Select Directory</button>
    <div id="current-path"></div>
    <form id="new-file-form" style="display:none">
      <input id="new-file-name" type="text" placeholder="New file name" required />
      <button type="submit">Create File</button>
    </form>
    <form id="new-folder-form" style="display:none">
      <input id="new-folder-name" type="text" placeholder="New folder name" required />
      <button type="submit">Create Folder</button>
    </form>
    <ul id="file-list"></ul>
    <div id="preview"></div>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const selectBtn = section.querySelector<HTMLButtonElement>("#select-dir");
  const listEl = section.querySelector<HTMLUListElement>("#file-list");
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
      setDir(dir);
      if (pathEl) pathEl.textContent = dir;
      if (fileForm) fileForm.style.display = "block";
      if (folderForm) folderForm.style.display = "block";
      if (listEl && previewEl && pathEl)
        await listDirectory(dir, listEl, previewEl, pathEl, setDir);
    }
  });

  fileForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentDir || !fileNameInput) return;
    const path = await join(currentDir, fileNameInput.value);
    await writeFile({ path, contents: "" });
    fileNameInput.value = "";
    if (listEl && previewEl && pathEl)
      await listDirectory(currentDir, listEl, previewEl, pathEl, setDir);
  });

  folderForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentDir || !folderNameInput) return;
    const path = await join(currentDir, folderNameInput.value);
    await createDir(path, { recursive: true });
    folderNameInput.value = "";
    if (listEl && previewEl && pathEl)
      await listDirectory(currentDir, listEl, previewEl, pathEl, setDir);
  });
}

