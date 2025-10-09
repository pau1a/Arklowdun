import { familyStore } from "../family.store";
import type { FamilyMember, MemberAttachment } from "../family.types";
import { familyRepo } from "../../../repos";
import { toast, type ToastKind } from "@ui/Toast";
import { createEmptyState } from "@ui/EmptyState";
import { logUI } from "@lib/uiLog";
import {
  normalizeError,
  DB_UNHEALTHY_WRITE_BLOCKED,
  DB_UNHEALTHY_WRITE_BLOCKED_MESSAGE,
} from "@lib/ipc/call";
import { presentFsError } from "@lib/ipc";
import { call } from "@lib/ipc/call";
import {
  mkdir,
  exists,
  remove,
  writeBinary,
  PathError,
} from "@files/safe-fs";
import { revealLabel } from "../../../ui/attachments";
import type { OpenDialogReturn } from "@tauri-apps/plugin-dialog/dist-js/index";
import type { AttachmentRef } from "@lib/ipc/contracts";

type AttachmentSource = {
  name: string;
  mimeType: string | null;
  read: () => Promise<Uint8Array>;
};

type SortMode = "date" | "name";

type NormalizedError = ReturnType<typeof normalizeError>;

type FileSystemEntryLike = { isDirectory: boolean };

const MEMBER_ATTACHMENT_TABLE = "member_attachments";

const MIME_UNKNOWN = "Unknown";

const DROP_ACTIVE_CLASS = "family-documents__dropzone--active";
const DROP_DISABLED_CLASS = "family-documents__dropzone--disabled";

interface ErrorBucket {
  message: string;
  kind: ToastKind;
  count: number;
}

export interface DocumentsTabInstance {
  element: HTMLElement;
  setMember(member: FamilyMember | null): void;
  updateAttachments(list: MemberAttachment[]): void;
  refresh(force?: boolean): Promise<void>;
  focusAttachment(id: string): void;
  destroy(): void;
}

export function createDocumentsTab(): DocumentsTabInstance {
  const element = document.createElement("div");
  element.className = "family-drawer__panel family-documents";
  element.id = "family-drawer-panel-documents";

  const dropZone = document.createElement("div");
  dropZone.className = "family-documents__dropzone";
  dropZone.setAttribute("role", "button");
  dropZone.tabIndex = 0;

  const dropLabel = document.createElement("span");
  dropLabel.className = "family-documents__dropzone-label";
  dropLabel.textContent = "Drop documents here";
  dropZone.appendChild(dropLabel);

  const dropHint = document.createElement("span");
  dropHint.className = "family-documents__dropzone-hint";
  dropHint.textContent = "or choose files";
  dropZone.appendChild(dropHint);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.hidden = true;

  const toolbar = document.createElement("div");
  toolbar.className = "family-documents__toolbar";

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "family-drawer__add";
  addButton.textContent = "Add from disk";
  addButton.setAttribute("aria-label", "Add documents from disk");
  toolbar.appendChild(addButton);

  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "family-documents__refresh";
  refreshButton.textContent = "Refresh";
  refreshButton.setAttribute("aria-label", "Refresh documents");
  toolbar.appendChild(refreshButton);

  const sortGroup = document.createElement("div");
  sortGroup.className = "family-documents__sort";

  const sortByDateButton = document.createElement("button");
  sortByDateButton.type = "button";
  sortByDateButton.className = "family-documents__sort-button";
  sortByDateButton.textContent = "Sort by date";
  sortByDateButton.dataset.sortMode = "date";
  sortGroup.appendChild(sortByDateButton);

  const sortByNameButton = document.createElement("button");
  sortByNameButton.type = "button";
  sortByNameButton.className = "family-documents__sort-button";
  sortByNameButton.textContent = "Sort by name";
  sortByNameButton.dataset.sortMode = "name";
  sortGroup.appendChild(sortByNameButton);

  toolbar.appendChild(sortGroup);

  const listHost = document.createElement("div");
  listHost.className = "family-drawer__list family-documents__list";

  const emptyState = createEmptyState({
    title: "No documents yet",
    body: "Add important files for this member."
  });
  emptyState.hidden = true;
  emptyState.update({
    cta: {
      kind: "button",
      label: "Choose files",
      onClick: () => {
        if (isBusy() || !currentMember) return;
        fileInput.click();
      },
      variant: "ghost",
    },
  });

  const loadingMessage = document.createElement("p");
  loadingMessage.className = "family-documents__loading";
  loadingMessage.textContent = "Loading documents…";
  loadingMessage.hidden = true;

  listHost.append(emptyState, loadingMessage);

  element.append(dropZone, toolbar, listHost, fileInput);

  let currentMember: FamilyMember | null = null;
  let attachments: MemberAttachment[] = [];
  let sortMode: SortMode = "date";
  let pendingFocusId: string | null = null;
  let isLoading = false;
  let importing = false;
  let loadToken = 0;

  function isBusy(): boolean {
    return importing || isLoading;
  }

  function getMemberLabel(member: FamilyMember | null): string {
    if (!member) return "this member";
    if (member.nickname && member.nickname.trim().length > 0) return member.nickname.trim();
    if (member.name && member.name.trim().length > 0) return member.name.trim();
    return "this member";
  }

  function updateDropZoneState(): void {
    if (!currentMember) {
      dropZone.classList.add(DROP_DISABLED_CLASS);
      dropZone.setAttribute("aria-disabled", "true");
      dropZone.tabIndex = -1;
      dropZone.classList.remove(DROP_ACTIVE_CLASS);
    } else {
      dropZone.classList.remove(DROP_DISABLED_CLASS);
      dropZone.removeAttribute("aria-disabled");
      dropZone.tabIndex = 0;
    }
    addButton.disabled = !currentMember || importing;
    refreshButton.disabled = !currentMember || importing || isLoading;
  }

  function extractFileName(relativePath: string): string {
    const segments = relativePath.split("/").filter(Boolean);
    return segments.length ? segments[segments.length - 1] : relativePath;
  }

  function getDisplayTitle(attachment: MemberAttachment): string {
    const title = (attachment.title ?? "").trim();
    if (title.length > 0) return title;
    return extractFileName(attachment.relativePath ?? "");
  }

  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  function formatTimestamp(value: number | null | undefined): string {
    if (!value) return "Unknown";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return dateFormatter.format(date);
  }

  function sortAttachments(list: MemberAttachment[]): MemberAttachment[] {
    const copy = [...list];
    if (sortMode === "name") {
      copy.sort((a, b) => getDisplayTitle(a).localeCompare(getDisplayTitle(b), undefined, { sensitivity: "base" }));
    } else {
      copy.sort((a, b) => {
        const diff = (b.addedAt ?? 0) - (a.addedAt ?? 0);
        if (diff !== 0) return diff;
        return getDisplayTitle(a).localeCompare(getDisplayTitle(b), undefined, { sensitivity: "base" });
      });
    }
    return copy;
  }

  function renderAttachments(): void {
    listHost.querySelectorAll(".family-documents__card").forEach((node) => node.remove());

    const sorted = sortAttachments(attachments);

    if (isLoading) {
      loadingMessage.hidden = false;
      emptyState.hidden = true;
    } else {
      loadingMessage.hidden = true;
      if (sorted.length === 0) {
        emptyState.hidden = false;
      } else {
        emptyState.hidden = true;
        for (const attachment of sorted) {
          const card = document.createElement("div");
          card.className = "family-drawer__list-item family-documents__card";
          card.dataset.attachmentId = attachment.id;
          card.tabIndex = -1;

          const title = document.createElement("div");
          title.className = "family-documents__title";
          title.textContent = getDisplayTitle(attachment);
          card.appendChild(title);

          const meta = document.createElement("div");
          meta.className = "family-documents__meta";
          const mime = attachment.mimeHint && attachment.mimeHint.length > 0 ? attachment.mimeHint : MIME_UNKNOWN;
          meta.textContent = `${mime} · ${formatTimestamp(attachment.addedAt)}`;
          card.appendChild(meta);

          const actions = document.createElement("div");
          actions.className = "family-documents__actions";

          const openButton = document.createElement("button");
          openButton.type = "button";
          openButton.className = "family-documents__action";
          openButton.textContent = "Open";
          openButton.setAttribute("aria-label", `Open ${getDisplayTitle(attachment)}`);
          openButton.addEventListener("click", (event) => {
            event.preventDefault();
            void handleOpen(attachment);
          });
          actions.appendChild(openButton);

          const revealButton = document.createElement("button");
          revealButton.type = "button";
          revealButton.className = "family-documents__action";
          revealButton.textContent = revealLabel();
          revealButton.setAttribute("aria-label", `${revealLabel()} ${getDisplayTitle(attachment)}`);
          revealButton.addEventListener("click", (event) => {
            event.preventDefault();
            void handleReveal(attachment);
          });
          actions.appendChild(revealButton);

          const removeButton = document.createElement("button");
          removeButton.type = "button";
          removeButton.className = "family-documents__remove";
          removeButton.textContent = "Remove";
          removeButton.setAttribute("aria-label", `Remove ${getDisplayTitle(attachment)}`);
          removeButton.addEventListener("click", (event) => {
            event.preventDefault();
            void handleRemove(attachment);
          });
          actions.appendChild(removeButton);

          card.appendChild(actions);
          listHost.appendChild(card);
        }
      }
    }

    updateSortButtons();
    updateDropZoneState();
    applyPendingFocus();
  }

  function updateSortButtons(): void {
    const buttons = [sortByDateButton, sortByNameButton];
    for (const button of buttons) {
      const mode = button.dataset.sortMode as SortMode | undefined;
      const selected = mode === sortMode;
      button.classList.toggle("family-documents__sort-button--active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }

  function applyPendingFocus(): void {
    if (!pendingFocusId) return;
    const target = listHost.querySelector<HTMLElement>(
      `.family-documents__card[data-attachment-id="${pendingFocusId}"]`,
    );
    if (target) {
      target.focus();
    }
    pendingFocusId = null;
  }

  function setLoading(value: boolean): void {
    isLoading = value;
    renderAttachments();
  }

  async function loadForMember(member: FamilyMember, force = false): Promise<void> {
    const token = ++loadToken;
    setLoading(true);
    try {
      await familyStore.attachments.load(member.id, { force });
      if (token !== loadToken) return;
      const latest = familyStore.attachments.get(member.id);
      attachments = latest;
    } catch (error) {
      const normalized = normalizeError(error);
      showErrorToast(mapAttachmentError(normalized, error));
    } finally {
      if (token === loadToken) {
        setLoading(false);
      }
    }
  }

  function showErrorToast(bucket: ErrorBucket | null): void {
    if (!bucket) return;
    const suffix = bucket.count > 1 ? ` (x${bucket.count})` : "";
    toast.show({ kind: bucket.kind, message: `${bucket.message}${suffix}` });
  }

  function normalizeFileName(input: string): string {
    const normalized = input.normalize("NFC");
    const replaced = normalized.replace(/[<>:"\\/|?*\x00-\x1F]/g, "");
    const collapsed = replaced.replace(/\s+/g, " ").trim();
    const sanitized = (collapsed || "Document").replace(/^\.+/, "").replace(/\.+$/, "");
    const finalName = sanitized || "Document";
    return clampFileName(finalName);
  }

  function splitExtension(name: string): { base: string; ext: string } {
    const lastDot = name.lastIndexOf(".");
    if (lastDot <= 0 || lastDot === name.length - 1) {
      return { base: name, ext: "" };
    }
    return { base: name.slice(0, lastDot), ext: name.slice(lastDot) };
  }

  function clampFileName(name: string, limit = 120): string {
    if (name.length <= limit) return name;
    const { base, ext } = splitExtension(name);
    const remaining = Math.max(limit - ext.length, 1);
    const trimmedBase = base.slice(0, remaining);
    return `${trimmedBase}${ext}`;
  }

  function buildCandidateName(base: string, ext: string, attempt: number, limit = 120): string {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const availableForBase = Math.max(limit - suffix.length - ext.length, 0);
    const trimmedBase = availableForBase > 0 ? base.slice(0, availableForBase) : "";
    let candidate = `${trimmedBase}${suffix}${ext}`;
    if (candidate.length > limit) {
      candidate = candidate.slice(0, limit);
    }
    return candidate || "Document".slice(0, limit);
  }

  async function ensureUniqueName(
    desired: string,
    existing: Set<string>,
    householdId: string,
    memberId: string,
  ): Promise<string> {
    const normalized = clampFileName(desired);
    const { base, ext } = splitExtension(normalized);
    let attempt = 0;
    for (;;) {
      const candidate = buildCandidateName(base, ext, attempt);
      const relative = `people/${memberId}/${candidate}`;
      if (!existing.has(relative)) {
        const fsPath = buildVaultPath(householdId, relative);
        const alreadyExists = await exists(fsPath, "appData").catch(() => false);
        if (!alreadyExists) {
          return candidate;
        }
      }
      attempt += 1;
    }
  }

  function buildVaultPath(householdId: string, relative: string): string {
    return `attachments/${householdId}/misc/${relative}`;
  }

  function ensureVaultFolder(householdId: string, memberId: string): Promise<void> {
    return mkdir(`attachments/${householdId}/misc/people/${memberId}`, "appData", {
      recursive: true,
    });
  }

  function createSource(file: File): AttachmentSource {
    return {
      name: file.name,
      mimeType: file.type || null,
      read: async () => new Uint8Array(await file.arrayBuffer()),
    };
  }

  async function openSystemPicker(): Promise<AttachmentSource[]> {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = (await open({ multiple: true })) as OpenDialogReturn<{ multiple: true }>;
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (paths.length === 0) return [];
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const sources: AttachmentSource[] = [];
      for (const p of paths) {
        try {
          const data = await readFile(p);
          const name = p.split(/[\\/]/).pop() || "Document";
          sources.push({ name, mimeType: null, read: async () => data });
        } catch (e) {
          console.warn("dialog-read-failed", e);
        }
      }
      return sources;
    } catch (e) {
      console.warn("dialog-open-unavailable", e);
      return [];
    }
  }

  function recordError(bucketMap: Map<string, ErrorBucket>, bucket: ErrorBucket | null): void {
    if (!bucket) return;
    const existing = bucketMap.get(bucket.message);
    if (existing) {
      existing.count += bucket.count;
    } else {
      bucketMap.set(bucket.message, { ...bucket });
    }
  }

  function mapAttachmentError(error: NormalizedError, raw: unknown): ErrorBucket | null {
    const code = error.code ?? "UNKNOWN";
    if (code === DB_UNHEALTHY_WRITE_BLOCKED) {
      return { message: DB_UNHEALTHY_WRITE_BLOCKED_MESSAGE, kind: "info", count: 1 };
    }

    const codeMap: Record<string, ErrorBucket> = {
      PATH_OUT_OF_VAULT: {
        message: "That file can’t be stored here. (It lives outside the managed vault.)",
        kind: "info",
        count: 1,
      },
      "ATTACHMENTS/OUT_OF_VAULT": {
        message: "That file can’t be stored here. (It lives outside the managed vault.)",
        kind: "info",
        count: 1,
      },
      "ATTACHMENTS/SYMLINK_REJECTED": {
        message: "Symbolic links aren’t allowed for safety.",
        kind: "info",
        count: 1,
      },
      SYMLINK: {
        message: "Symbolic links aren’t allowed for safety.",
        kind: "info",
        count: 1,
      },
      "ATTACHMENTS/PATH_CONFLICT": {
        message: "A document with that name already exists.",
        kind: "info",
        count: 1,
      },
      NAME_TOO_LONG: {
        message: "That file name is too long. Try a shorter name.",
        kind: "info",
        count: 1,
      },
      FILENAME_INVALID: {
        message: "That file name isn’t allowed on this system.",
        kind: "info",
        count: 1,
      },
      "ATTACHMENTS/INVALID_ROOT": {
        message: "Attachments must use the managed vault root.",
        kind: "error",
        count: 1,
      },
      "ATTACHMENTS/INVALID_INPUT": {
        message: "Something went wrong adding the document.",
        kind: "error",
        count: 1,
      },
      "IO/GENERIC": {
        message: "The file couldn’t be read or written.",
        kind: "error",
        count: 1,
      },
      NOT_ALLOWED: {
        message: "The app didn’t have permission to access that file.",
        kind: "error",
        count: 1,
      },
      PERMISSION_DENIED: {
        message: "The app didn’t have permission to access that file.",
        kind: "error",
        count: 1,
      },
    };

    if (Object.prototype.hasOwnProperty.call(codeMap, code)) {
      return { ...codeMap[code] };
    }

    if (raw instanceof PathError) {
      if (raw.code === "OUTSIDE_ROOT") {
        return {
          message: "That file can’t be stored here. (It lives outside the managed vault.)",
          kind: "info",
          count: 1,
        };
      }
      if (raw.code === "SYMLINK") {
        return { message: "Symbolic links aren’t allowed for safety.", kind: "info", count: 1 };
      }
    }

    const rawCode =
      raw && typeof (raw as { code?: unknown }).code === "string"
        ? ((raw as { code?: string }).code as string)
        : null;
    logUI("WARN", "ui.family.attach.add.error.unmapped_code", {
      normalized_code: code ?? null,
      raw_code: rawCode,
      message: error.message ?? null,
    });

    if (error.message && error.message.trim().length > 0) {
      return { message: error.message, kind: "error", count: 1 };
    }

    return { message: "Something went wrong adding the document.", kind: "error", count: 1 };
  }

  async function handleOpen(attachment: MemberAttachment): Promise<void> {
    if (!currentMember) return;
    const start = performance.now();
    try {
      await call("attachment_open", { table: MEMBER_ATTACHMENT_TABLE, id: attachment.id });
      logUI("INFO", "ui.family.attach.open", {
        member_id: currentMember.id,
        attachment_id: attachment.id,
        duration_ms: Math.round(performance.now() - start),
        result: "success",
      });
    } catch (error) {
      const normalized = normalizeError(error);
      logUI("ERROR", "ui.family.attach.open", {
        member_id: currentMember.id,
        attachment_id: attachment.id,
        result: "error",
        error_code: normalized.code,
      });
      presentFsError(normalized);
    }
  }

  async function handleReveal(attachment: MemberAttachment): Promise<void> {
    if (!currentMember) return;
    const start = performance.now();
    try {
      await call("attachment_reveal", { table: MEMBER_ATTACHMENT_TABLE, id: attachment.id });
      logUI("INFO", "ui.family.attach.reveal", {
        member_id: currentMember.id,
        attachment_id: attachment.id,
        duration_ms: Math.round(performance.now() - start),
        result: "success",
      });
    } catch (error) {
      const normalized = normalizeError(error);
      logUI("ERROR", "ui.family.attach.reveal", {
        member_id: currentMember.id,
        attachment_id: attachment.id,
        result: "error",
        error_code: normalized.code,
      });
      if (normalized.code === "IO/UNSUPPORTED_REVEAL") {
        presentFsError({ code: "IO/GENERIC", message: "Reveal not supported on this platform." });
      } else {
        presentFsError(normalized);
      }
    }
  }

  async function handleRemove(attachment: MemberAttachment): Promise<void> {
    if (!currentMember) return;
    const label = getDisplayTitle(attachment);
    const memberLabel = getMemberLabel(currentMember);
    const confirmed = window.confirm(`Remove this document from ${memberLabel}?`);
    if (!confirmed) return;

    try {
      await familyStore.attachments.remove(currentMember.id, attachment.id);
      attachments = familyStore.attachments.get(currentMember.id);
      toast.show({ kind: "success", message: `Removed ${label}.` });
    } catch (error) {
      const normalized = normalizeError(error);
      showErrorToast(mapAttachmentError(normalized, error));
    }
  }

  async function importSources(sources: AttachmentSource[]): Promise<void> {
    if (!currentMember) return;
    if (sources.length === 0) return;

    const householdId = currentMember.householdId;
    const memberId = currentMember.id;

    importing = true;
    updateDropZoneState();

    logUI("INFO", "ui.family.attach.drop.begin", {
      household_id: householdId,
      member_id: memberId,
      count: sources.length,
    });

    const buckets = new Map<string, ErrorBucket>();
    const successes: AttachmentRef[] = [];
    const existing = new Set<string>(attachments.map((item) => item.relativePath));

    for (const source of sources) {
      const start = performance.now();
      try {
        const rawName = normalizeFileName(source.name);
        const uniqueName = await ensureUniqueName(rawName, existing, householdId, memberId);
        const relative = `people/${memberId}/${uniqueName}`;
        const fsPath = buildVaultPath(householdId, relative);

        await ensureVaultFolder(householdId, memberId);
        const data = await source.read();
        await writeBinary(fsPath, "appData", data);
        logUI("INFO", "ui.family.attach.import.file", {
          household_id: householdId,
          member_id: memberId,
          filename: source.name,
          inferred_mime: source.mimeType ?? null,
          duration_ms: Math.round(performance.now() - start),
        });

        let created: AttachmentRef;
        try {
          created = await familyRepo.attachments.add({
            householdId,
            memberId,
            rootKey: "appData",
            relativePath: relative,
            title: uniqueName,
            mimeHint: source.mimeType ?? undefined,
          });
        } catch (error) {
          await remove(fsPath, "appData").catch(() => undefined);
          throw error;
        }

        successes.push(created);
        existing.add(created.relativePath ?? relative);
        logUI("INFO", "ui.family.attach.add.success", {
          household_id: householdId,
          member_id: memberId,
          attachment_id: created.id,
          duration_ms: Math.round(performance.now() - start),
        });
      } catch (error) {
        const normalized = normalizeError(error);
        recordError(buckets, mapAttachmentError(normalized, error));
        logUI("ERROR", "ui.family.attach.add.error", {
          household_id: householdId,
          member_id: memberId,
          filename: source.name,
          error_code: normalized.code,
          duration_ms: Math.round(performance.now() - start),
        });
      }
    }

    if (successes.length > 0) {
      const successMessage = successes.length === 1 ? "Added 1 document." : `Added ${successes.length} documents.`;
      toast.show({ kind: "success", message: successMessage });
      pendingFocusId = successes[successes.length - 1].id;
      await loadForMember(currentMember, true);
    }

    for (const bucket of buckets.values()) {
      showErrorToast(bucket);
    }

    importing = false;
    updateDropZoneState();
  }

  function collectFilesFromDataTransfer(data: DataTransfer | null): File[] {
    if (!data) return [];
    const files: File[] = [];
    let hasDirectory = false;

    const items = data.items;
    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.kind !== "file") continue;

        // Best-effort directory detection (Safari/WebKit specific API)
        const entry = (item as DataTransferItem & {
          webkitGetAsEntry?: () => FileSystemEntryLike | null;
        }).webkitGetAsEntry?.();
        if (entry && entry.isDirectory) {
          hasDirectory = true;
          continue;
        }

        const file = item.getAsFile();
        if (file) {
          files.push(file);
          continue;
        }

        // Some WebKit builds expose items but return null for getAsFile().
        // Fall back to DataTransfer.files so drops still work.
        if (data.files && data.files.length > 0) {
          for (let j = 0; j < data.files.length; j += 1) {
            const f = data.files[j];
            if (f) files.push(f);
          }
          break;
        }
      }
    } else if (data.files && data.files.length > 0) {
      for (let i = 0; i < data.files.length; i += 1) {
        const file = data.files[i];
        if (file) files.push(file);
      }
    }

    if (hasDirectory) {
      toast.show({ kind: "info", message: "Folders aren’t supported yet." });
    }
    return files;
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    if (!currentMember || importing) return;
    dropZone.classList.remove(DROP_ACTIVE_CLASS);
    const files = collectFilesFromDataTransfer(event.dataTransfer);
    if (files.length > 0) {
      const sources = files.map(createSource);
      void importSources(sources);
    } else {
      // Older WebKit didn’t provide File objects on drop. Don’t force a picker;
      // guide the user to use the button explicitly.
      toast.show({ kind: "info", message: "Drag-and-drop isn’t supported here. Use ‘Add from disk’." });
    }
  }

  function handleDragEnter(event: DragEvent): void {
    event.preventDefault();
    if (!currentMember || importing) return;
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    } catch {
      /* ignore */
    }
    dropZone.classList.add(DROP_ACTIVE_CLASS);
  }

  function handleDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!currentMember || importing) return;
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    } catch {
      /* ignore */
    }
  }

  function handleDragLeave(event: DragEvent): void {
    const target = event.currentTarget as EventTarget | null;
    // Only clear the highlight when the pointer leaves our drop region entirely.
    if (target === dropZone || target === element) {
      dropZone.classList.remove(DROP_ACTIVE_CLASS);
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!currentMember || importing) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  }

  fileInput.addEventListener("change", (event) => {
    event.stopPropagation();
    if (!currentMember || importing) {
      fileInput.value = "";
      return;
    }
    const fileList = fileInput.files;
    const sources: AttachmentSource[] = [];
    if (fileList) {
      for (let i = 0; i < fileList.length; i += 1) {
        sources.push(createSource(fileList[i]!));
      }
    }
    fileInput.value = "";
    void importSources(sources);
  });

  fileInput.addEventListener("input", (event) => {
    event.stopPropagation();
  });

  // Attach to both the explicit dropZone and the entire tab panel to
  // tolerate minor layout/positioning differences across WebKit builds.
  const dropTargets: (HTMLElement | Window)[] = [dropZone, element];
  for (const target of dropTargets) {
    target.addEventListener("dragenter", handleDragEnter as any);
    target.addEventListener("dragover", handleDragOver as any);
    target.addEventListener("dragleave", handleDragLeave as any);
    target.addEventListener("drop", handleDrop as any);
  }
  dropZone.addEventListener("keydown", handleKeydown);

  // Global fallback: some WebKit builds only deliver drop if default
  // is prevented at the window level. Limit this to the lifetime of
  // the Documents tab instance to avoid side effects elsewhere.
  const windowDragBlocker = (e: Event) => e.preventDefault();
  window.addEventListener("dragover", windowDragBlocker);
  window.addEventListener("drop", windowDragBlocker);

  addButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (!currentMember || importing) return;
    fileInput.click();
  });

  refreshButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (!currentMember || importing) return;
    void loadForMember(currentMember, true);
  });

  sortByDateButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (sortMode === "date") return;
    sortMode = "date";
    renderAttachments();
  });

  sortByNameButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (sortMode === "name") return;
    sortMode = "name";
    renderAttachments();
  });

  // Bridge for older macOS WebKit where Finder file drops do not
  // produce DOM `drop` events with File objects. We listen to the
  // Tauri window drag/drop events and provide a graceful fallback by
  // prompting the user with the standard file picker on drop.
  (async () => {
    try {
      const mod = await import("@tauri-apps/api/window");
      const appWindow = mod.getCurrentWindow?.() ?? mod.Window?.getCurrent?.();
      if (!appWindow || typeof appWindow.onDragDropEvent !== "function") return;
      await appWindow.onDragDropEvent((evt: any) => {
        const kind = evt?.payload?.type as string | undefined;
        if (!kind) return;
        if (!currentMember || importing) return;
        if (kind === "enter" || kind === "over") {
          dropZone.classList.add(DROP_ACTIVE_CLASS);
          return;
        }
        if (kind === "leave") {
          dropZone.classList.remove(DROP_ACTIVE_CLASS);
          return;
        }
        if (kind === "drop") {
          dropZone.classList.remove(DROP_ACTIVE_CLASS);
          const osPaths: string[] = Array.isArray(evt?.payload?.paths) ? evt.payload.paths : [];
          if (osPaths.length === 0) return;
          // Import via backend so users don't need a picker on older WebKit.
          const start = performance.now();
          logUI("INFO", "ui.family.attach.drop.import_paths", {
            count: osPaths.length,
          });
          void (async () => {
            try {
              const created = (await call("member_attachments_import_paths", {
                householdId: currentMember!.householdId,
                memberId: currentMember!.id,
                paths: osPaths,
              })) as AttachmentRef[];
              if (created.length > 0) {
                const msg = created.length === 1 ? "Added 1 document." : `Added ${created.length} documents.`;
                toast.show({ kind: "success", message: msg });
                pendingFocusId = created[created.length - 1].id;
                await loadForMember(currentMember!, true);
              }
              logUI("INFO", "ui.family.attach.drop.import_paths.complete", {
                count: created.length,
                duration_ms: Math.round(performance.now() - start),
              });
            } catch (error) {
              const normalized = normalizeError(error);
              showErrorToast(mapAttachmentError(normalized, error));
              logUI("ERROR", "ui.family.attach.drop.import_paths.error", {
                error_code: normalized.code,
              });
            }
          })();
        }
      });
    } catch {
      // Not running under Tauri or API unavailable; ignore.
    }
  })();

  function resetState(): void {
    attachments = [];
    pendingFocusId = null;
    renderAttachments();
  }

  renderAttachments();
  updateDropZoneState();

  return {
    element,
    setMember(member) {
      const isSameMember =
        Boolean(member && currentMember && member.id === currentMember.id);
      currentMember = member;
      if (member) {
        dropZone.setAttribute(
          "aria-label",
          `Add documents to ${getMemberLabel(member)}`,
        );
        attachments = familyStore.attachments.get(member.id);
        renderAttachments();
        if (!isSameMember) {
          loadForMember(member).catch(() => {
            /* errors surfaced via toasts */
          });
        }
      } else {
        dropZone.setAttribute("aria-label", "Add documents");
        loadToken += 1;
        resetState();
      }
      updateDropZoneState();
    },
    updateAttachments(list) {
      if (!currentMember) return;
      attachments = list;
      renderAttachments();
    },
    async refresh(force = false) {
      if (!currentMember) return;
      await loadForMember(currentMember, force);
    },
    focusAttachment(id) {
      pendingFocusId = id;
      applyPendingFocus();
    },
    destroy() {
      for (const target of dropTargets) {
        target.removeEventListener("dragenter", handleDragEnter as any);
        target.removeEventListener("dragover", handleDragOver as any);
        target.removeEventListener("dragleave", handleDragLeave as any);
        target.removeEventListener("drop", handleDrop as any);
      }
      dropZone.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("dragover", windowDragBlocker);
      window.removeEventListener("drop", windowDragBlocker);
    },
  };
}
