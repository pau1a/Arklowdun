import {
  PathError,
  PathValidationError,
  canonicalizeAndVerify,
  sanitizeRelativePath,
} from "../../files/path";
import type { Pet, PetMedicalRecord } from "../../models";
import { petMedicalRepo, petsRepo } from "../../repos";
import { getHouseholdIdForCalls } from "../../db/household";
import { toast } from "../../ui/Toast";
import { openAttachment, revealAttachment, revealLabel } from "../../ui/attachments";
import { logUI } from "@lib/uiLog";
import { open as openDialog } from "@lib/ipc/dialog";
import * as ipcCall from "../../lib/ipc/call";
import { convertFileSrc } from "../../lib/ipc/core";
import { updateDiagnosticsSection } from "../../diagnostics/runtime";

type Nullable<T> = T | null | undefined;

const PET_MEDICAL_CATEGORY = "pet_medical" as const;

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_HOUSEHOLD: "No active household selected. Refresh and try again.",
  PATH_OUT_OF_VAULT: "That file isn’t inside the app’s attachments folder.",
  PATH_SYMLINK_REJECTED: "Links aren’t allowed. Choose the real file.",
  FILENAME_INVALID: "That name can’t be used. Try letters, numbers, dashes or underscores.",
  ROOT_KEY_NOT_SUPPORTED: "This location isn’t allowed for Pets documents.",
  NAME_TOO_LONG: "That name is too long for the filesystem.",
  [ipcCall.DB_UNHEALTHY_WRITE_BLOCKED]: ipcCall.DB_UNHEALTHY_WRITE_BLOCKED_MESSAGE,
};

const GUARD_CODES = new Set([
  "PATH_OUT_OF_VAULT",
  "PATH_SYMLINK_REJECTED",
  "FILENAME_INVALID",
  "ROOT_KEY_NOT_SUPPORTED",
  "NAME_TOO_LONG",
]);

interface FocusSnapshot {
  scrollTop: number;
  focusKey: string | null;
}

function formatDate(timestamp: Nullable<number>): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "—";
  const date = new Date(timestamp);
  return date.toLocaleDateString();
}

function toDateInputValue(timestamp: Nullable<number>): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const y = `${date.getFullYear()}`;
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateInput(value: string): number | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parts = value.split("-");
  if (parts.length !== 3) return null;
  const [ys, ms, ds] = parts;
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const date = new Date();
  date.setFullYear(y, m - 1, d);
  date.setHours(12, 0, 0, 0);
  return date.getTime();
}

function computeAge(birthday: Nullable<number>): string | null {
  if (typeof birthday !== "number" || !Number.isFinite(birthday)) return null;
  const birth = new Date(birthday);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let years = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  const dayDiff = today.getDate() - birth.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    years -= 1;
  }
  if (years < 0) return null;
  return `${years} ${years === 1 ? "year" : "years"}`;
}

function resolveError(error: unknown, fallback: string): { message: string; code: string } {
  const normalized = ipcCall.normalizeError(error);
  const message = ERROR_MESSAGES[normalized.code] ?? normalized.message ?? fallback;
  return { message: message || fallback, code: normalized.code };
}

function compareRecords(a: PetMedicalRecord, b: PetMedicalRecord): number {
  const dateDiff = (b.date ?? 0) - (a.date ?? 0);
  if (dateDiff !== 0) return dateDiff;
  const createdDiff = (b.created_at ?? 0) - (a.created_at ?? 0);
  if (createdDiff !== 0) return createdDiff;
  return a.id.localeCompare(b.id);
}

function sortRecords(records: PetMedicalRecord[]): PetMedicalRecord[] {
  return [...records].sort(compareRecords);
}

function snapshotFocus(container: HTMLElement): FocusSnapshot {
  const active = container.contains(document.activeElement)
    ? (document.activeElement as HTMLElement)
    : null;
  const focusKey = active?.dataset.focusKey ?? null;
  const scrollTop = container.scrollTop;
  return { scrollTop, focusKey };
}

function restoreFocus(container: HTMLElement, snapshot: FocusSnapshot): void {
  container.scrollTop = snapshot.scrollTop;
  if (!snapshot.focusKey) return;
  const next = container.querySelector<HTMLElement>(
    `[data-focus-key="${snapshot.focusKey.replace(/"/g, '\\"')}"]`,
  );
  next?.focus();
}

function insertMeta(meta: HTMLElement, label: string, value: string): void {
  const dt = document.createElement("dt");
  dt.textContent = label;
  dt.className = "pet-detail__meta-label";

  const dd = document.createElement("dd");
  dd.textContent = value;
  dd.className = "pet-detail__meta-value";

  meta.append(dt, dd);
}

const THUMBNAIL_EDGE = 160;

type ThumbnailState =
  | "idle"
  | "loading"
  | "loaded"
  | "missing"
  | "unsupported"
  | "error";

interface ThumbnailCommandResponse {
  ok: boolean;
  relative_thumb_path?: string | null;
  code?: string | null;
  cache_hit?: boolean;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
}

interface MissingBannerElements {
  banner: HTMLDivElement;
  fixButton: HTMLButtonElement;
  dismissButton: HTMLButtonElement;
  message: HTMLSpanElement;
}

interface MissingAttachmentSnapshot {
  household_id: string;
  category: string;
  relative_path: string;
}

interface PetsDiagnosticsCountersResponse {
  pet_attachments_total?: number;
  pet_attachments_missing?: number;
  pet_thumbnails_built?: number;
  pet_thumbnails_cache_hits?: number;
  missing_attachments?: MissingAttachmentSnapshot[];
}

function createMissingBanner(): MissingBannerElements {
  const banner = document.createElement("div");
  banner.className = "pet-detail__record-missing";
  banner.setAttribute("role", "alert");
  banner.dataset.state = "hidden";
  banner.style.display = "flex";
  banner.style.alignItems = "center";
  banner.style.justifyContent = "space-between";
  banner.style.gap = "12px";
  banner.style.padding = "12px 16px";
  banner.style.borderRadius = "10px";
  banner.style.background = "rgba(229, 57, 53, 0.12)";
  banner.style.color = "rgba(95, 0, 0, 0.88)";

  const message = document.createElement("span");
  message.className = "pet-detail__record-missing-message";
  message.textContent = "File not found.";
  message.style.flex = "1";
  message.style.fontSize = "13px";
  message.style.lineHeight = "1.45";

  const fixButton = document.createElement("button");
  fixButton.type = "button";
  fixButton.textContent = "Fix path";
  fixButton.className = "pet-detail__record-fix";
  fixButton.style.flexShrink = "0";
  fixButton.style.alignSelf = "flex-start";

  const dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.className = "pet-detail__record-dismiss";
  dismissButton.setAttribute("aria-label", "Dismiss missing attachment warning");
  dismissButton.textContent = "✕";
  dismissButton.style.flexShrink = "0";
  dismissButton.style.alignSelf = "flex-start";
  dismissButton.style.width = "28px";
  dismissButton.style.height = "28px";
  dismissButton.style.borderRadius = "14px";
  dismissButton.style.fontSize = "14px";
  dismissButton.style.lineHeight = "1";

  dismissButton.addEventListener("click", () => {
    banner.hidden = true;
    banner.dataset.state = "dismissed";
  });

  banner.hidden = true;
  banner.append(message, fixButton, dismissButton);
  return { banner, fixButton, dismissButton, message };
}

function createThumbnailSlot(recordId: string): HTMLDivElement {
  const slot = document.createElement("div");
  slot.className = "pet-detail__record-thumbnail";
  slot.dataset.recordId = recordId;
  slot.dataset.thumbnailState = "idle";
  slot.style.width = `${THUMBNAIL_EDGE}px`;
  slot.style.height = `${THUMBNAIL_EDGE}px`;
  slot.style.flex = `0 0 ${THUMBNAIL_EDGE}px`;
  slot.style.borderRadius = "12px";
  slot.style.backgroundColor = "var(--thumbnail-surface, rgba(0, 0, 0, 0.08))";
  slot.style.display = "flex";
  slot.style.alignItems = "center";
  slot.style.justifyContent = "center";
  slot.style.overflow = "hidden";
  slot.style.position = "relative";
  slot.style.userSelect = "none";
  return slot;
}

function createThumbnailLabel(message: string): HTMLSpanElement {
  const label = document.createElement("span");
  label.className = "pet-detail__record-thumbnail-label";
  label.textContent = message;
  label.style.fontSize = "12px";
  label.style.lineHeight = "1.4";
  label.style.color = "var(--thumbnail-foreground, rgba(60, 64, 67, 0.72))";
  label.style.textAlign = "center";
  label.style.padding = "0 12px";
  return label;
}

function renderThumbnailMessage(
  slot: HTMLDivElement,
  message: string,
  state: ThumbnailState,
): void {
  slot.dataset.thumbnailState = state;
  slot.innerHTML = "";
  slot.append(createThumbnailLabel(message));
}

function renderThumbnailLoading(slot: HTMLDivElement): void {
  renderThumbnailMessage(slot, "Loading preview…", "loading");
}

function renderThumbnailUnsupported(slot: HTMLDivElement): void {
  slot.dataset.thumbnailState = "unsupported";
  slot.innerHTML = "";
  const icon = document.createElement("div");
  icon.className = "pet-detail__record-thumbnail-icon";
  icon.textContent = "🖼️";
  icon.style.fontSize = "28px";
  icon.style.lineHeight = "1";
  icon.style.marginBottom = "8px";
  icon.style.opacity = "0.72";
  icon.setAttribute("aria-hidden", "true");
  icon.style.display = "flex";
  icon.style.alignItems = "center";
  icon.style.justifyContent = "center";
  const label = createThumbnailLabel("Preview unavailable");
  slot.append(icon, label);
}

function renderThumbnailMissing(slot: HTMLDivElement): void {
  renderThumbnailMessage(slot, "File not found", "missing");
}

function renderThumbnailError(slot: HTMLDivElement): void {
  renderThumbnailMessage(slot, "Preview failed", "error");
}

function renderThumbnailImage(slot: HTMLDivElement, src: string): void {
  slot.dataset.thumbnailState = "loaded";
  slot.innerHTML = "";
  const img = document.createElement("img");
  img.className = "pet-detail__record-thumbnail-image";
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.src = src;
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "cover";
  slot.append(img);
}

export async function PetDetailView(
  container: HTMLElement,
  pet: Pet,
  onChange: () => Promise<void> | void,
  onBack: () => void,
): Promise<void> {
  const skipAttachmentProbe =
    typeof window !== "undefined" &&
    Boolean((window as unknown as { __ARKLOWDUN_SKIP_ATTACHMENT_PROBE__?: boolean }).__ARKLOWDUN_SKIP_ATTACHMENT_PROBE__);
  const thumbnailLoaders = new WeakMap<Element, () => void>();
  let diagnosticsUpdateScheduled = false;

  function scheduleDiagnosticsUpdate(): void {
    if (skipAttachmentProbe) return;
    if (diagnosticsUpdateScheduled) return;
    diagnosticsUpdateScheduled = true;
    void (async () => {
      try {
        const counters = (await ipcCall.call("pets_diagnostics_counters")) as PetsDiagnosticsCountersResponse;
        if (counters && typeof counters === "object") {
          updateDiagnosticsSection("pets", {
            pet_attachments_total: counters.pet_attachments_total ?? 0,
            pet_attachments_missing: counters.pet_attachments_missing ?? 0,
            pet_thumbnails_built: counters.pet_thumbnails_built ?? 0,
            pet_thumbnails_cache_hits: counters.pet_thumbnails_cache_hits ?? 0,
            missing_attachments: counters.missing_attachments ?? [],
          });
        }
      } catch (error) {
        console.warn("pets diagnostics update failed", error);
      } finally {
        diagnosticsUpdateScheduled = false;
      }
    })();
  }

  const householdId = await getHouseholdIdForCalls();
  logUI("INFO", "ui.pets.detail_opened", { id: pet.id, household_id: householdId });

  const revealText = revealLabel();

  const root = document.createElement("section");
  root.className = "pet-detail";

  const header = document.createElement("header");
  header.className = "pet-detail__header";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "pet-detail__back";
  backBtn.textContent = "Back";
  backBtn.addEventListener("click", () => {
    onBack();
  });

  const title = document.createElement("h1");
  title.className = "pet-detail__title";
  title.textContent = pet.name;

  header.append(backBtn, title);

  const identity = document.createElement("section");
  identity.className = "pet-detail__identity";

  const avatar = document.createElement("div");
  avatar.className = "pet-detail__avatar";
  avatar.textContent = (pet.name?.[0] ?? "?").toUpperCase();

  const identityBody = document.createElement("div");
  identityBody.className = "pet-detail__identity-body";

  const nameHeading = document.createElement("h2");
  nameHeading.className = "pet-detail__name";
  nameHeading.textContent = pet.name;

  const subtitle = document.createElement("p");
  subtitle.className = "pet-detail__subtitle";
  const species = pet.species ?? pet.type ?? "—";
  const breed = pet.breed ?? "";
  subtitle.textContent = breed ? `${species} · ${breed}` : species;

  const meta = document.createElement("dl");
  meta.className = "pet-detail__meta";
  insertMeta(meta, "Species", species);
  insertMeta(meta, "Breed", breed || "—");
  insertMeta(meta, "Birthday", formatDate(pet.birthday));

  const age = computeAge(pet.birthday);
  if (age) {
    const ageChip = document.createElement("span");
    ageChip.className = "pet-detail__age";
    ageChip.textContent = age;
    identityBody.append(nameHeading, subtitle, meta, ageChip);
  } else {
    identityBody.append(nameHeading, subtitle, meta);
  }

  identity.append(avatar, identityBody);

  const medicalSection = document.createElement("section");
  medicalSection.className = "pet-detail__section";

  const formHeading = document.createElement("h3");
  formHeading.className = "pet-detail__section-title";
  formHeading.textContent = "Add medical record";

  const form = document.createElement("form");
  form.className = "pet-detail__form";
  form.autocomplete = "off";

  const fieldsRow = document.createElement("div");
  fieldsRow.className = "pet-detail__form-row";

  const dateField = document.createElement("label");
  dateField.className = "pet-detail__field";
  dateField.textContent = "Date";
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.required = true;
  dateInput.id = "pet-medical-date";
  dateInput.name = "date";
  dateField.append(dateInput);

  const descField = document.createElement("label");
  descField.className = "pet-detail__field";
  descField.textContent = "Description";
  const descInput = document.createElement("textarea");
  descInput.required = true;
  descInput.name = "description";
  descInput.rows = 2;
  descInput.className = "pet-detail__textarea";
  descField.append(descInput);

  fieldsRow.append(dateField, descField);

  const secondaryRow = document.createElement("div");
  secondaryRow.className = "pet-detail__form-row";

  const reminderField = document.createElement("label");
  reminderField.className = "pet-detail__field";
  reminderField.textContent = "Reminder";
  const reminderInput = document.createElement("input");
  reminderInput.type = "date";
  reminderInput.name = "reminder";
  reminderField.append(reminderInput);

  const documentField = document.createElement("label");
  documentField.className = "pet-detail__field";
  documentField.textContent = "Attachment path";
  const documentInput = document.createElement("input");
  documentInput.type = "text";
  documentInput.name = "document";
  documentInput.placeholder = "e.g. vet/records.pdf";
  documentField.append(documentInput);

  secondaryRow.append(reminderField, documentField);

  const submitRow = document.createElement("div");
  submitRow.className = "pet-detail__actions";
  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "pet-detail__submit";
  submitBtn.textContent = "Add record";
  submitBtn.disabled = true;
  submitRow.append(submitBtn);

  form.append(fieldsRow, secondaryRow, submitRow);

  const historyHeading = document.createElement("h3");
  historyHeading.className = "pet-detail__section-title";
  historyHeading.textContent = "Medical history";

  const historyContainer = document.createElement("div");
  historyContainer.className = "pet-detail__history";
  historyContainer.tabIndex = 0;

  let thumbnailObserver: IntersectionObserver | null = null;
  const canObserveThumbnails =
    !skipAttachmentProbe &&
    typeof window !== "undefined" &&
    typeof (window as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver !== "undefined";

  if (canObserveThumbnails) {
    thumbnailObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const loader = thumbnailLoaders.get(entry.target);
          if (loader) loader();
        }
      },
      { root: historyContainer, rootMargin: "96px 0px" },
    );
  }

  function finalizeThumbnail(slot: HTMLDivElement): void {
    if (thumbnailObserver) {
      thumbnailObserver.unobserve(slot);
    }
    thumbnailLoaders.delete(slot);
  }

  function resetThumbnail(slot: HTMLDivElement): void {
    slot.dataset.thumbnailState = "idle";
    slot.innerHTML = "";
    thumbnailLoaders.delete(slot);
  }

  function scheduleThumbnailLoad(
    slot: HTMLDivElement,
    record: PetMedicalRecord,
    card: HTMLElement,
  ): void {
    if (!record.relative_path) return;

    const execute = async () => {
      if (card.dataset.attachmentMissing === "true") {
        renderThumbnailMissing(slot);
        finalizeThumbnail(slot);
        return;
      }

      const state = slot.dataset.thumbnailState;
      if (state === "loading" || state === "loaded") {
        return;
      }

      renderThumbnailLoading(slot);

      try {
        const response = (await ipcCall.call("thumbnails_get_or_create", {
          household_id: record.household_id ?? householdId,
          category: PET_MEDICAL_CATEGORY,
          relative_path: record.relative_path,
          max_edge: THUMBNAIL_EDGE,
        })) as ThumbnailCommandResponse;

        if (response?.ok && response.relative_thumb_path) {
          const cacheHit = response.cache_hit === true;
          try {
            const { realPath } = await canonicalizeAndVerify(
              response.relative_thumb_path,
              "appData",
            );
            const src = convertFileSrc(realPath);
            renderThumbnailImage(slot, src);
            if (cacheHit) {
              logUI("INFO", "ui.pets.thumbnail_cache_hit", {
                medical_id: record.id,
                path: record.relative_path ?? null,
                household_id: householdId,
              });
            } else {
              const width = typeof response.width === "number" ? response.width : null;
              const height = typeof response.height === "number" ? response.height : null;
              const duration =
                typeof response.duration_ms === "number" ? response.duration_ms : null;
              logUI("INFO", "ui.pets.thumbnail_built", {
                medical_id: record.id,
                path: record.relative_path ?? null,
                household_id: householdId,
                width,
                height,
                ms: duration,
              });
            }
          } catch (resolveError) {
            console.warn("thumbnail resolve failed", resolveError);
            renderThumbnailError(slot);
          }
        } else if (response?.code === "UNSUPPORTED") {
          renderThumbnailUnsupported(slot);
        } else {
          renderThumbnailError(slot);
        }
      } catch (err) {
        console.warn("thumbnail load failed", err);
        renderThumbnailError(slot);
      } finally {
        finalizeThumbnail(slot);
      }
    };

    const trigger = () => {
      void execute();
    };

    thumbnailLoaders.set(slot, trigger);
    if (thumbnailObserver) {
      thumbnailObserver.observe(slot);
    } else {
      trigger();
    }
  }

  async function getAttachmentsBase(): Promise<string> {
    const { base, realPath } = await canonicalizeAndVerify(".", "attachments");
    // canonicalize returns base with trailing slash; prefer directory path for dialogs
    if (realPath.endsWith("/")) return realPath.slice(0, -1);
    return realPath;
  }

  function mapPathErrorToGuardCode(error: unknown): string | null {
    if (error instanceof PathValidationError) {
      if (error.code === "EMPTY") return "FILENAME_INVALID";
      return error.code;
    }
    if (error instanceof PathError) {
      switch (error.code) {
        case "SYMLINK":
          return "PATH_SYMLINK_REJECTED";
        case "DOT_DOT_REJECTED":
        case "OUTSIDE_ROOT":
        case "CROSS_VOLUME":
        case "UNC_REJECTED":
          return "PATH_OUT_OF_VAULT";
        case "INVALID":
          return "FILENAME_INVALID";
        default:
          return null;
      }
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
    ) {
      const backendCode = (error as { code: string }).code;
      if (backendCode === "SYMLINK_DENIED") return "PATH_SYMLINK_REJECTED";
      return backendCode;
    }
    return null;
  }

  function presentGuardToast(code: string, fallback: string): void {
    const message = ERROR_MESSAGES[code] ?? fallback;
    toast.show({ kind: "error", message });
  }

  function updateMissingState(
    card: HTMLElement,
    banner: HTMLDivElement | null,
    slot: HTMLDivElement | null,
    missing: boolean,
  ): void {
    const wasMissing = card.dataset.attachmentMissing === "true";
    if (missing) {
      card.dataset.attachmentMissing = "true";
      if (banner) {
        banner.hidden = false;
        banner.dataset.state = "visible";
      }
      if (slot) {
        renderThumbnailMissing(slot);
        finalizeThumbnail(slot);
      }
    } else {
      delete card.dataset.attachmentMissing;
      if (banner) {
        banner.hidden = true;
        banner.dataset.state = "hidden";
      }
      if (slot && wasMissing) {
        resetThumbnail(slot);
      }
    }
  }

  async function probeAttachment(
    record: PetMedicalRecord,
    card: HTMLElement,
    slot: HTMLDivElement | null,
    banner: HTMLDivElement | null,
  ): Promise<boolean> {
    if (!record.relative_path || skipAttachmentProbe) {
      updateMissingState(card, banner, slot, false);
      scheduleDiagnosticsUpdate();
      return true;
    }
    try {
      const response = await ipcCall.call("files_exists", {
        household_id: record.household_id,
        category: PET_MEDICAL_CATEGORY,
        relative_path: record.relative_path,
      });
      const exists = typeof response === "object" && response !== null && "exists" in response
        ? Boolean((response as { exists: boolean }).exists)
        : Boolean((response as any)?.exists);
      if (!exists) {
        const previouslyMissing = card.dataset.attachmentMissing === "true";
        updateMissingState(card, banner, slot, true);
        if (!previouslyMissing) {
          logUI("INFO", "ui.pets.attachment_missing", {
            medical_id: record.id,
            path: record.relative_path,
            household_id: householdId,
          });
        }
      } else {
        const wasMissing = card.dataset.attachmentMissing === "true";
        updateMissingState(card, banner, slot, false);
        if (wasMissing && slot) {
          scheduleThumbnailLoad(slot, record, card);
        }
      }
      scheduleDiagnosticsUpdate();
      return exists;
    } catch (err) {
      const { code } = resolveError(err, "Attachment check failed.");
      if (code && GUARD_CODES.has(code)) {
        logUI("WARN", "ui.pets.vault_guard_reject", {
          code,
          path: record.relative_path ?? null,
          household_id: householdId,
          medical_id: record.id,
          stage: "probe",
        });
      }
      console.warn("files_exists probe failed", err);
      scheduleDiagnosticsUpdate();
      return false;
    }
  }

  const attachmentFixInFlight = new Set<string>();

  async function promptForReplacement(
    record: PetMedicalRecord,
    currentPath: string | null | undefined,
  ): Promise<string | null> {
    try {
      const defaultLocation = currentPath
        ? (await canonicalizeAndVerify(currentPath, "attachments")).realPath
        : await getAttachmentsBase();
      const selection = await openDialog({
        multiple: false,
        directory: false,
        defaultPath: defaultLocation,
      });
      const chosen = Array.isArray(selection) ? selection[0] : selection;
      if (!chosen) {
        return null;
      }
      const { base, realPath } = await canonicalizeAndVerify(chosen, "attachments");
      const relative = realPath.slice(base.length);
      const sanitized = sanitizeRelativePath(relative);
      return sanitized;
    } catch (error) {
      const guardCode = mapPathErrorToGuardCode(error);
      if (guardCode && GUARD_CODES.has(guardCode)) {
        presentGuardToast(guardCode, "Attachment path is invalid.");
        logUI("WARN", "ui.pets.vault_guard_reject", {
          code: guardCode,
          path: currentPath ?? null,
          household_id: householdId,
          medical_id: record.id,
          stage: "fix_select",
        });
      } else {
        toast.show({ kind: "error", message: "Could not select an attachment." });
      }
      console.warn("fix-path selection failed", error);
      return null;
    }
  }

  async function handleFixPath(
    record: PetMedicalRecord,
    card: HTMLElement,
    slot: HTMLDivElement | null,
    banner: HTMLDivElement | null,
    button: HTMLButtonElement,
  ): Promise<void> {
    if (skipAttachmentProbe) return;
    if (attachmentFixInFlight.has(record.id)) return;
    attachmentFixInFlight.add(record.id);
    const previousLabel = button.textContent ?? "Fix path";
    button.disabled = true;
    button.textContent = "Fixing…";
    logUI("INFO", "ui.pets.attachment_fix_opened", {
      medical_id: record.id,
      path: record.relative_path ?? null,
      household_id: householdId,
    });
    try {
      const replacement = await promptForReplacement(record, record.relative_path ?? null);
      if (!replacement) {
        return;
      }

      const currentPath = record.relative_path ?? null;
      if (replacement === currentPath) {
        updateMissingState(card, banner, slot, false);
        if (slot) {
          resetThumbnail(slot);
          scheduleThumbnailLoad(slot, record, card);
        }
        await probeAttachment(record, card, slot, banner);
        return;
      }

      await petMedicalRepo.update(householdId, record.id, {
        relative_path: replacement,
        category: PET_MEDICAL_CATEGORY,
      });

      const index = records.findIndex((item) => item.id === record.id);
      if (index >= 0) {
        records[index] = { ...records[index], relative_path: replacement };
      }
      record.relative_path = replacement;

      updateMissingState(card, banner, slot, false);
      if (slot) {
        resetThumbnail(slot);
        scheduleThumbnailLoad(slot, record, card);
      }

      logUI("INFO", "ui.pets.attachment_fixed", {
        medical_id: record.id,
        old_path: currentPath,
        new_path: replacement,
        household_id: householdId,
      });

      await probeAttachment(record, card, slot, banner);
      await onChange?.();
    } catch (err) {
      const { message, code } = resolveError(err, "Could not update attachment path.");
      toast.show({ kind: "error", message });
      if (code && GUARD_CODES.has(code)) {
        logUI("WARN", "ui.pets.vault_guard_reject", {
          code,
          path: record.relative_path ?? null,
          household_id: householdId,
          medical_id: record.id,
          stage: "fix_update",
        });
      }
    } finally {
      attachmentFixInFlight.delete(record.id);
      button.disabled = false;
      button.textContent = previousLabel;
    }
  }

  const historyList = document.createElement("div");
  historyList.className = "pet-detail__history-list";
  historyList.setAttribute("role", "list");

  const historyEmpty = document.createElement("p");
  historyEmpty.className = "pet-detail__empty";
  historyEmpty.textContent = "No medical records yet.";
  historyEmpty.hidden = true;

  const historyLoading = document.createElement("p");
  historyLoading.className = "pet-detail__loading";
  historyLoading.textContent = "Loading medical history…";

  historyContainer.append(historyLoading, historyEmpty, historyList);

  medicalSection.append(formHeading, form, historyHeading, historyContainer);

  root.append(header, identity, medicalSection);
  container.innerHTML = "";
  container.append(root);

  let records: PetMedicalRecord[] = [];
  let creating = false;
  let sanitizedDocumentPath: string | undefined;
  const pendingDeletes = new Set<string>();

  function validateDocumentField(opts: { report?: boolean } = {}): boolean {
    const raw = documentInput.value;
    const trimmed = raw.trim();
    sanitizedDocumentPath = undefined;

    if (trimmed.length === 0) {
      documentInput.setCustomValidity("");
      documentInput.dataset.errorCode = "";
      if (opts.report) documentInput.reportValidity();
      return true;
    }

    try {
      sanitizedDocumentPath = sanitizeRelativePath(trimmed);
      documentInput.setCustomValidity("");
      documentInput.dataset.errorCode = "";
      if (opts.report) documentInput.reportValidity();
      return true;
    } catch (error) {
      if (error instanceof PathValidationError) {
        const message =
          ERROR_MESSAGES[error.code] ??
          (error.code === "EMPTY"
            ? "Attachment path is required."
            : error.message || "Attachment path is invalid.");
        documentInput.setCustomValidity(message);
        documentInput.dataset.errorCode = error.code;
      } else {
        documentInput.setCustomValidity("Attachment path is invalid.");
        documentInput.dataset.errorCode = "UNKNOWN";
      }
      if (opts.report) documentInput.reportValidity();
      return false;
    }
  }

  function updateSubmitState() {
    const hasRequired = dateInput.value.trim().length > 0 && descInput.value.trim().length > 0;
    const pathValid = validateDocumentField();
    submitBtn.disabled = creating || !hasRequired || !pathValid;
  }

  function renderRecords() {
    if (thumbnailObserver) {
      thumbnailObserver.disconnect();
    }
    historyList.innerHTML = "";
    if (records.length === 0) {
      historyEmpty.hidden = false;
    } else {
      historyEmpty.hidden = true;
      for (const record of records) {
        const card = document.createElement("article");
        card.className = "pet-detail__record";
        card.setAttribute("role", "listitem");
        card.dataset.recordId = record.id;

        const cardHeader = document.createElement("header");
        cardHeader.className = "pet-detail__record-header";

        const dateEl = document.createElement("time");
        dateEl.className = "pet-detail__record-date";
        const dateIso = new Date(record.date).toISOString();
        dateEl.dateTime = dateIso;
        dateEl.textContent = formatDate(record.date);
        cardHeader.append(dateEl);

        if (record.reminder) {
          const reminderChip = document.createElement("span");
          reminderChip.className = "pet-detail__record-reminder";
          reminderChip.textContent = `Reminder ${formatDate(record.reminder)}`;
          cardHeader.append(reminderChip);
        }

        const desc = document.createElement("p");
        desc.className = "pet-detail__record-description";
        desc.textContent = record.description;

        const actions = document.createElement("div");
        actions.className = "pet-detail__record-actions";

        let contentContainer: HTMLElement = card;
        let thumbnailSlot: HTMLDivElement | null = null;

        let missingBanner: HTMLDivElement | null = null;
        let fixButton: HTMLButtonElement | null = null;

        if (record.relative_path && !skipAttachmentProbe) {
          thumbnailSlot = createThumbnailSlot(record.id);
          const layout = document.createElement("div");
          layout.className = "pet-detail__record-layout";
          layout.style.display = "flex";
          layout.style.flexWrap = "wrap";
          layout.style.gap = "16px";
          layout.style.alignItems = "stretch";
          layout.style.justifyContent = "flex-start";
          layout.style.width = "100%";
          card.append(layout);

          const content = document.createElement("div");
          content.className = "pet-detail__record-content";
          content.style.display = "flex";
          content.style.flexDirection = "column";
          content.style.gap = "12px";
          content.style.flex = "1";
          content.style.minWidth = "0";
          layout.append(thumbnailSlot, content);
          contentContainer = content;

          const missing = createMissingBanner();
          missingBanner = missing.banner;
          fixButton = missing.fixButton;
          fixButton.dataset.recordId = record.id;
          fixButton.dataset.focusKey = `${record.id}:fix`;
          fixButton.addEventListener("click", (event) => {
            event.preventDefault();
            void handleFixPath(record, card, thumbnailSlot, missingBanner, fixButton!);
          });
          content.append(missingBanner);

          const openBtn = document.createElement("button");
          openBtn.type = "button";
          openBtn.className = "pet-detail__record-action";
          openBtn.textContent = "Open";
          openBtn.dataset.recordId = record.id;
          openBtn.dataset.focusKey = `${record.id}:open`;
          openBtn.addEventListener("click", (event) => {
            event.preventDefault();
            void (async () => {
              const result = await openAttachment(PET_MEDICAL_CATEGORY, record.id);
              logUI(result ? "INFO" : "WARN", "ui.pets.attach_open", {
                path: record.relative_path ?? record.document ?? null,
                result: result ? "ok" : "error",
                record_id: record.id,
                pet_id: pet.id,
                household_id: householdId,
              });
            })();
          });
          actions.append(openBtn);

          const revealBtn = document.createElement("button");
          revealBtn.type = "button";
          revealBtn.className = "pet-detail__record-action";
          revealBtn.textContent = revealText;
          revealBtn.dataset.recordId = record.id;
          revealBtn.dataset.focusKey = `${record.id}:reveal`;
          revealBtn.addEventListener("click", (event) => {
            event.preventDefault();
            void (async () => {
              const result = await revealAttachment(PET_MEDICAL_CATEGORY, record.id);
              logUI(result ? "INFO" : "WARN", "ui.pets.attach_reveal", {
                path: record.relative_path ?? record.document ?? null,
                result: result ? "ok" : "error",
                record_id: record.id,
                pet_id: pet.id,
                household_id: householdId,
              });
            })();
          });
          actions.append(revealBtn);
        }

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "pet-detail__record-delete";
        deleteBtn.textContent = "Delete";
        deleteBtn.dataset.recordId = record.id;
        deleteBtn.dataset.focusKey = `${record.id}:delete`;
        deleteBtn.disabled = pendingDeletes.has(record.id);
        deleteBtn.addEventListener("click", (event) => {
          event.preventDefault();
          if (pendingDeletes.has(record.id)) return;
          pendingDeletes.add(record.id);
          deleteBtn.disabled = true;
          const snapshot = snapshotFocus(historyContainer);
          void (async () => {
            try {
              await petMedicalRepo.delete(householdId, record.id);
              await petsRepo.update(householdId, pet.id, { updated_at: Date.now() } as Partial<Pet>);
              records = records.filter((r) => r.id !== record.id);
              renderRecords();
              restoreFocus(historyContainer, snapshot);
              toast.show({ kind: "success", message: "Medical record deleted." });
              logUI("INFO", "ui.pets.medical_delete_success", {
                id: record.id,
                pet_id: pet.id,
                household_id: householdId,
              });
              await onChange?.();
              scheduleDiagnosticsUpdate();
            } catch (err) {
              const { message, code } = resolveError(err, "Could not delete medical record.");
              toast.show({ kind: "error", message });
              logUI("WARN", "ui.pets.medical_delete_fail", {
                id: record.id,
                pet_id: pet.id,
                household_id: householdId,
                code,
              });
              deleteBtn.disabled = false;
            } finally {
              pendingDeletes.delete(record.id);
            }
          })();
        });
        actions.append(deleteBtn);

        if (contentContainer !== card) {
          contentContainer.append(cardHeader, desc, actions);
        } else {
          card.append(cardHeader, desc, actions);
        }

        historyList.append(card);

        if (thumbnailSlot) {
          scheduleThumbnailLoad(thumbnailSlot, record, card);
        }

        if (record.relative_path && !skipAttachmentProbe) {
          void probeAttachment(record, card, thumbnailSlot, missingBanner);
        }
      }
    }
  }

  dateInput.addEventListener("input", updateSubmitState);
  descInput.addEventListener("input", updateSubmitState);
  documentInput.addEventListener("input", updateSubmitState);
  reminderInput.addEventListener("input", () => {
    const reminder = parseDateInput(reminderInput.value);
    if (reminder != null && dateInput.value && reminder < parseDateInput(dateInput.value)!) {
      reminderInput.setCustomValidity("Reminder must be on or after the visit date.");
    } else {
      reminderInput.setCustomValidity("");
    }
    updateSubmitState();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (creating) return;
    const dateValue = parseDateInput(dateInput.value);
    const description = descInput.value.trim();
    if (!dateValue || description.length === 0) {
      updateSubmitState();
      return;
    }
    const reminderValue = parseDateInput(reminderInput.value);
    if (!validateDocumentField({ report: true })) {
      updateSubmitState();
      return;
    }
    const relativePath = sanitizedDocumentPath;

    creating = true;
    updateSubmitState();
    const snapshot = snapshotFocus(historyContainer);
    void (async () => {
      try {
        const created = await petMedicalRepo.create(householdId, {
          pet_id: pet.id,
          date: dateValue,
          description,
          reminder: reminderValue ?? undefined,
          relative_path: relativePath,
          category: PET_MEDICAL_CATEGORY,
        });
        await petsRepo.update(householdId, pet.id, { updated_at: Date.now() } as Partial<Pet>);
        records = sortRecords([created, ...records]);
        renderRecords();
        restoreFocus(historyContainer, snapshot);
        toast.show({ kind: "success", message: "Medical record added." });
        logUI("INFO", "ui.pets.medical_create_success", {
          id: created.id,
          pet_id: pet.id,
          household_id: householdId,
        });
        form.reset();
        reminderInput.setCustomValidity("");
        updateSubmitState();
        dateInput.focus();
        await onChange?.();
        scheduleDiagnosticsUpdate();
      } catch (err) {
        const { message, code } = resolveError(err, "Could not save medical record.");
        toast.show({ kind: "error", message });
        logUI("WARN", "ui.pets.medical_create_fail", {
          pet_id: pet.id,
          household_id: householdId,
          code,
        });
      } finally {
        creating = false;
        updateSubmitState();
      }
    })();
  });

  try {
    const fetched = await petMedicalRepo.list({
      householdId,
      petId: pet.id,
      orderBy: "date DESC, created_at DESC, id",
    });
    records = sortRecords(fetched.filter((record) => record.pet_id === pet.id));
  } catch (err) {
    const { message } = resolveError(err, "Could not load medical records.");
    toast.show({ kind: "error", message });
    records = [];
  } finally {
    historyLoading.remove();
    renderRecords();
    scheduleDiagnosticsUpdate();
  }

  updateSubmitState();
  dateInput.value = toDateInputValue(Date.now());
  updateSubmitState();
}
