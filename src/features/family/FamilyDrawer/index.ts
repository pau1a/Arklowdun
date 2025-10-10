import { ENABLE_FAMILY_EXPANSION, ENABLE_FAMILY_RENEWALS } from "../../../config/flags";
import { createModal } from "@ui/Modal";
import { toast } from "@ui/Toast";
import { normalizeError, DB_UNHEALTHY_WRITE_BLOCKED, DB_UNHEALTHY_WRITE_BLOCKED_MESSAGE } from "@lib/ipc/call";
import { logUI, type UiLogLevel } from "@lib/uiLog";
import type { FamilyMember } from "../family.types";
import { familyStore } from "../family.store";
import { createDrawerTabs, type DrawerTabDefinition, type FamilyDrawerTabId } from "./DrawerTabs";
import { createPersonalTab, type PersonalFormData } from "./TabPersonal";
import { mkdir, writeBinary } from "@files/safe-fs";
import { createDocumentsTab } from "./TabDocuments";
import { createFinanceTab } from "./TabFinance";
import { createAuditTab } from "./TabAudit";
import { createRenewalsTab } from "./TabRenewals";

const ERROR_MESSAGE_BY_CODE: Record<string, string> = {
  [DB_UNHEALTHY_WRITE_BLOCKED]: DB_UNHEALTHY_WRITE_BLOCKED_MESSAGE,
  "FAMILY/VALIDATION": "We couldn’t save these details because they didn’t pass validation.",
  "FAMILY/CONFLICT": "This member was updated elsewhere. Refresh and try again.",
};

function resolveError(error: unknown): { message: string; code: string } {
  const normalized = normalizeError(error);
  const fallback =
    typeof normalized.message === "string" && normalized.message.trim().length > 0
      ? normalized.message
      : "An unexpected error occurred.";
  return {
    message: ERROR_MESSAGE_BY_CODE[normalized.code] ?? fallback,
    code: normalized.code,
  };
}

export type DrawerCloseReason = "save" | "cancel" | "programmatic";

export interface FamilyDrawerOptions {
  getMember: (id: string) => FamilyMember | undefined;
  saveMember: (patch: Partial<FamilyMember>) => Promise<FamilyMember>;
  onClose?: (reason: DrawerCloseReason) => void;
  log?: typeof logUI;
  resolveVerifierName?: () => Promise<string> | string;
}

export interface FamilyDrawerInstance {
  open(memberId: string): void;
  close(reason?: DrawerCloseReason): void;
  destroy(): void;
  isOpen(): boolean;
  sync(): void;
  getActiveMemberId(): string | null;
}

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toPersonalData(member: FamilyMember): PersonalFormData {
  const emails: string[] = [];
  if (member.email) {
    emails.push(member.email);
  }
  const socialEntries: PersonalFormData["socialLinks"] = [];
  if (member.socialLinks && typeof member.socialLinks === "object") {
    const entries = Object.entries(member.socialLinks as Record<string, unknown>);
    for (const [key, value] of entries) {
      if (typeof value === "string" && value.trim().length > 0) {
        socialEntries.push({ key, value });
      }
    }
  }
  return {
    nickname: member.nickname ?? member.name ?? "",
    fullName: member.fullName ?? "",
    relationship: member.relationship ?? "",
    address: member.address ?? "",
    emails,
    phoneMobile: member.phone?.mobile ?? "",
    phoneHome: member.phone?.home ?? "",
    phoneWork: member.phone?.work ?? "",
    website: member.personalWebsite ?? "",
    socialLinks: socialEntries,
  };
}

function toFinanceData(member: FamilyMember) {
  return {
    bankAccounts: member.finance?.bankAccounts ?? null,
    pensionDetails: member.finance?.pensionDetails ?? null,
    insuranceRefs: member.finance?.insuranceRefs ?? "",
  };
}

function toAuditData(member: FamilyMember) {
  return {
    createdAt: member.createdAt ?? null,
    updatedAt: member.updatedAt ?? null,
    lastVerified: member.lastVerified ?? null,
    verifiedBy: member.verifiedBy ?? null,
  };
}

export function createFamilyDrawer(options: FamilyDrawerOptions): FamilyDrawerInstance {
  const titleId = "family-drawer-title";
  const descriptionId = "family-drawer-description";

  let currentMemberId: string | null = null;
  let isSaving = false;
  let destroyed = false;
  const logFn = options.log ?? logUI;
  let pendingCloseReason: DrawerCloseReason | null = null;
  let hasPendingChanges = false;

  const emitLog = (level: UiLogLevel, cmd: string, details: Record<string, unknown>) => {
    if (!ENABLE_FAMILY_EXPANSION) return;
    logFn(level, cmd, details);
  };

  const personalTab = createPersonalTab();
  const documentsTab = createDocumentsTab();
  const renewalsTab = ENABLE_FAMILY_RENEWALS ? createRenewalsTab() : null;
  const financeTab = createFinanceTab();
  const auditTab = createAuditTab();

  type FinanceValidation = ReturnType<typeof financeTab.validate>;

  const tabDefinitions: DrawerTabDefinition[] = [
    { id: "personal", label: "Personal", panel: personalTab.element },
    { id: "documents", label: "Documents", panel: documentsTab.element },
  ];

  if (ENABLE_FAMILY_RENEWALS && renewalsTab) {
    tabDefinitions.push({ id: "renewals", label: "Renewals", panel: renewalsTab.element });
  }

  tabDefinitions.push(
    { id: "finance", label: "Finance", panel: financeTab.element },
    { id: "audit", label: "Audit", panel: auditTab.element },
  );

  const tabs = createDrawerTabs(tabDefinitions);

  const summary = document.createElement("p");
  summary.id = descriptionId;
  summary.className = "family-drawer__summary";
  summary.textContent = "View and edit member details.";

  const modal = createModal({
    open: false,
    titleId,
    descriptionId,
    onOpenChange(open) {
      if (!open) {
        const reason = pendingCloseReason ?? "cancel";
        const memberId = currentMemberId;
        pendingCloseReason = null;
        documentsTab.setMember(null);
        renewalsTab?.setMember(null);
        if (memberId) {
          emitLog("INFO", "family.ui.drawer_closed", { member_id: memberId, reason });
          options.onClose?.(reason);
          currentMemberId = null;
        }
      }
    },
    closeOnOverlayClick: true,
  });

  modal.root.classList.add("family-drawer__overlay");
  modal.dialog.classList.add("family-drawer");
  modal.dialog.setAttribute("aria-label", "Member details");
  modal.dialog.setAttribute("role", "dialog");
  modal.dialog.setAttribute("aria-modal", "true");

  // Prevent the webview from attempting to open dropped files when the drawer is open.
  // Some WebKit builds require this at the overlay level for drag&drop to work reliably.
  const preventDefaultDrop = (e: Event) => {
    e.preventDefault();
  };
  modal.root.addEventListener("dragover", preventDefaultDrop);
  modal.root.addEventListener("drop", preventDefaultDrop);

  const container = document.createElement("div");
  container.className = "family-drawer__container";
  modal.dialog.appendChild(container);

  const header = document.createElement("header");
  header.className = "family-drawer__header";
  container.appendChild(header);

  const heading = document.createElement("h2");
  heading.id = titleId;
  heading.className = "family-drawer__title";
  heading.textContent = "Member details";
  header.appendChild(heading);
  header.appendChild(summary);

  const buttonRow = document.createElement("div");
  buttonRow.className = "family-drawer__actions";
  container.appendChild(buttonRow);

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "family-drawer__primary";
  saveButton.textContent = "Save";
  saveButton.setAttribute("aria-label", "Save member details");
  buttonRow.appendChild(saveButton);

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "family-drawer__ghost";
  cancelButton.textContent = "Cancel";
  cancelButton.setAttribute("aria-label", "Cancel editing member details");
  buttonRow.appendChild(cancelButton);

  container.appendChild(tabs.element);

  const content = document.createElement("div");
  content.className = "family-drawer__content";
  content.appendChild(tabs.panelsHost);
  container.appendChild(content);

  const getVerifierName = async (): Promise<string> => {
    try {
      if (typeof options.resolveVerifierName === "function") {
        const result = await options.resolveVerifierName();
        if (typeof result === "string" && result.trim().length > 0) {
          return result.trim();
        }
      }
    } catch {
      /* ignore */
    }
    return "You";
  };

  const setButtonsDisabled = (disabled: boolean) => {
    saveButton.disabled = disabled || !hasPendingChanges;
    cancelButton.disabled = disabled;
  };

  auditTab.setMarkVerifiedHandler(async () => {
    if (!currentMemberId || isSaving) return;
    const name = await getVerifierName();
    const timestamp = Date.now();
    auditTab.applyVerification({ lastVerified: timestamp, verifiedBy: name });
    emitLog("INFO", "family.ui.mark_verified", { member_id: currentMemberId, tab: "audit", action: "attempt" });
    isSaving = true;
    setButtonsDisabled(true);
    try {
      const saved = await options.saveMember({
        id: currentMemberId,
        lastVerified: timestamp,
        verifiedBy: name,
      });
      toast.show({ kind: "success", message: "Verified." });
      emitLog("INFO", "family.ui.mark_verified", {
        member_id: currentMemberId,
        tab: "audit",
        action: "success",
        success: true,
      });
      syncMember(saved.id);
    } catch (error) {
      const { message, code } = resolveError(error);
      toast.show({ kind: "error", message });
      emitLog("ERROR", "family.ui.mark_verified", {
        member_id: currentMemberId,
        tab: "audit",
        action: "failed",
        success: false,
        error_code: code,
      });
      syncMember(currentMemberId);
    } finally {
      isSaving = false;
      setButtonsDisabled(false);
    }
  });

  const syncMember = (memberId: string) => {
    const member = options.getMember(memberId);
    if (!member) {
      documentsTab.setMember(null);
      renewalsTab?.setMember(null);
      return;
    }
    documentsTab.setMember(member);
    if (ENABLE_FAMILY_RENEWALS && renewalsTab) {
      renewalsTab.setMember(member);
      renewalsTab.updateRenewals(familyStore.renewals.get(member.id));
    }
    documentsTab.updateAttachments(familyStore.attachments.get(member.id));
    personalTab.setData(toPersonalData(member));
    personalTab.setPhotoFromMember(member);
    financeTab.setData(toFinanceData(member));
    auditTab.setData(toAuditData(member));
    hasPendingChanges = false;
    if (!isSaving) {
      setButtonsDisabled(false);
    }
  };

  const markTabError = (id: FamilyDrawerTabId, hasError: boolean) => {
    tabs.setHasError(id, hasError);
  };

  const handleValidation = () => {
    const personalResult = personalTab.validate();
    const financeResult = financeTab.validate();

    markTabError("personal", !personalResult.valid);
    if (ENABLE_FAMILY_RENEWALS && renewalsTab) {
      markTabError("renewals", false);
    }
    markTabError("finance", !financeResult.valid);
    markTabError("audit", false);

    if (!personalResult.valid) {
      personalResult.focus?.();
      return { ok: false, finance: financeResult };
    }
    if (!financeResult.valid) {
      financeResult.focus?.();
      return { ok: false, finance: financeResult };
    }
    return {
      ok: true,
      finance: financeResult,
    };
  };

  const buildPatch = (member: FamilyMember, financeResult: FinanceValidation): Partial<FamilyMember> => {
    const personal = personalTab.getData();
    const financeState = financeResult;
    const financeData = financeTab.getData();

    const phone = {
      mobile: toNullable(personal.phoneMobile),
      home: toNullable(personal.phoneHome),
      work: toNullable(personal.phoneWork),
    };

    const socialLinks = personal.socialLinks.reduce<Record<string, string>>((acc, entry) => {
      if (entry.key && entry.value) {
        acc[entry.key] = entry.value;
      }
      return acc;
    }, {});

    const patch: Partial<FamilyMember> = {
      id: member.id,
      nickname: toNullable(personal.nickname),
      fullName: toNullable(personal.fullName),
      relationship: toNullable(personal.relationship),
      address: toNullable(personal.address),
      personalWebsite: toNullable(personal.website),
      email: personal.emails.length > 0 ? personal.emails[0] : null,
      phone,
      socialLinks: Object.keys(socialLinks).length > 0 ? socialLinks : null,
      finance: {
        bankAccounts: financeState.bankAccounts ?? null,
        pensionDetails: financeState.pensionDetails ?? null,
        insuranceRefs: toNullable(financeData.insuranceRefs),
      },
    };

    if (!patch.nickname) {
      patch.nickname = member.nickname ?? member.name ?? "";
    }

    return patch;
  };

  async function applyPendingPhoto(member: FamilyMember): Promise<string | null | undefined> {
    // Removal takes precedence
    if (typeof personalTab.isPhotoRemoved === "function" && personalTab.isPhotoRemoved()) {
      return null; // explicit null to clear existing photo
    }
    const pending = typeof personalTab.getPendingPhoto === "function" ? personalTab.getPendingPhoto() : null;
    if (!pending) return undefined; // no change

    // Derive a stable name, overwrite if exists
    const name = pending.name || "avatar";
    const extMatch = name.match(/\.([A-Za-z0-9]+)$/);
    const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : (pending.mimeType?.includes("png") ? ".png" : ".jpg");
    const relative = `attachments/${member.householdId}/misc/people/${member.id}/avatar${ext}`;
    const writeRel = `attachments/${member.householdId}/misc/people/${member.id}`;

    try {
      await mkdir(writeRel, "appData", { recursive: true });
      const bytes = await pending.read();
      await writeBinary(relative, "appData", bytes);
      // Best-effort verification: ensure file now exists
      try {
        const { exists } = await import("@files/safe-fs");
        const ok = await exists(relative, "appData");
        if (!ok) {
          toast.show({ kind: "error", message: "Couldn’t verify saved photo." });
        }
      } catch {
        // ignore verification errors
      }
      if (typeof personalTab.clearPendingPhoto === "function") personalTab.clearPendingPhoto();
      // Store DB field as path relative under misc root
      return `people/${member.id}/avatar${ext}`;
    } catch {
      // If writing fails, inform the user and keep previous value unchanged
      toast.show({ kind: "error", message: "Failed to save photo." });
      return undefined;
    }
  }

  const normalizeNullableString = (value: string | null | undefined): string | null => {
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const normalizePhoneForComparison = (
    phone: FamilyMember["phone"] | Partial<FamilyMember["phone"]> | null | undefined,
  ) => {
    if (!phone) {
      return { mobile: null, home: null, work: null } as const;
    }
    return {
      mobile: normalizeNullableString(phone.mobile ?? null),
      home: normalizeNullableString(phone.home ?? null),
      work: normalizeNullableString(phone.work ?? null),
    } as const;
  };

  const normalizeFinanceForComparison = (
    finance: FamilyMember["finance"] | Partial<FamilyMember["finance"]> | null | undefined,
  ) => {
    if (!finance) {
      return {
        bankAccounts: null,
        pensionDetails: null,
        insuranceRefs: null,
      } as const;
    }
    return {
      bankAccounts: finance.bankAccounts ?? null,
      pensionDetails: finance.pensionDetails ?? null,
      insuranceRefs: normalizeNullableString(finance.insuranceRefs ?? null),
    } as const;
  };

  const normalizeSocialLinks = (links: Record<string, string> | null | undefined) => {
    if (!links || typeof links !== "object") return null;
    const normalisedEntries = Object.entries(links as Record<string, unknown>)
      .map(([key, value]) => [key, String(value ?? "").trim()] as const)
      .filter(([, value]) => value.length > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    if (normalisedEntries.length === 0) {
      return null;
    }
    const out: Record<string, string> = {};
    for (const [key, value] of normalisedEntries) {
      out[key] = value;
    }
    return out;
  };

  const stableStringify = (value: unknown): string => {
    if (value === null) return "null";
    if (Array.isArray(value)) {
      return `[${value.map(stableStringify).join(",")}]`;
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      return `{${entries.map(([key, val]) => `${key}:${stableStringify(val)}`).join(",")}}`;
    }
    if (typeof value === "string") {
      return JSON.stringify(value);
    }
    return String(value);
  };

  const pruneUnchangedFields = (
    member: FamilyMember,
    patch: Partial<FamilyMember>,
  ): Partial<FamilyMember> => {
    const trimmed: Partial<FamilyMember> = { ...patch };

    if (
      "nickname" in trimmed &&
      normalizeNullableString(trimmed.nickname ?? null) ===
        normalizeNullableString(member.nickname ?? member.name ?? null)
    ) {
      delete trimmed.nickname;
    }

    if (
      "fullName" in trimmed &&
      normalizeNullableString(trimmed.fullName ?? null) ===
        normalizeNullableString(member.fullName ?? null)
    ) {
      delete trimmed.fullName;
    }

    if (
      "relationship" in trimmed &&
      normalizeNullableString(trimmed.relationship ?? null) ===
        normalizeNullableString(member.relationship ?? null)
    ) {
      delete trimmed.relationship;
    }

    if (
      "address" in trimmed &&
      normalizeNullableString(trimmed.address ?? null) ===
        normalizeNullableString(member.address ?? null)
    ) {
      delete trimmed.address;
    }

    if (
      "personalWebsite" in trimmed &&
      normalizeNullableString(trimmed.personalWebsite ?? null) ===
        normalizeNullableString(member.personalWebsite ?? null)
    ) {
      delete trimmed.personalWebsite;
    }

    if (
      "email" in trimmed &&
      normalizeNullableString(trimmed.email ?? null) === normalizeNullableString(member.email ?? null)
    ) {
      delete trimmed.email;
    }

    if ("phone" in trimmed) {
      const patchPhone = normalizePhoneForComparison(trimmed.phone);
      const memberPhone = normalizePhoneForComparison(member.phone ?? null);
      if (stableStringify(patchPhone) === stableStringify(memberPhone)) {
        delete trimmed.phone;
      }
    }

    if ("socialLinks" in trimmed) {
      const patchLinks = normalizeSocialLinks(trimmed.socialLinks as Record<string, string> | null | undefined);
      const memberLinks = normalizeSocialLinks(member.socialLinks as Record<string, string> | null | undefined);
      if (stableStringify(patchLinks) === stableStringify(memberLinks)) {
        delete trimmed.socialLinks;
      } else {
        trimmed.socialLinks = patchLinks;
      }
    }

    if ("finance" in trimmed) {
      const patchFinance = normalizeFinanceForComparison(trimmed.finance);
      const memberFinance = normalizeFinanceForComparison(member.finance ?? null);
      if (stableStringify(patchFinance) === stableStringify(memberFinance)) {
        delete trimmed.finance;
      } else {
        const financePatch: FamilyMember["finance"] = {
          bankAccounts: trimmed.finance?.bankAccounts ?? null,
          pensionDetails: trimmed.finance?.pensionDetails ?? null,
          insuranceRefs: normalizeNullableString(trimmed.finance?.insuranceRefs ?? null),
        };
        trimmed.finance = financePatch;
      }
    }

    return trimmed;
  };

  const handleSave = async () => {
    if (!currentMemberId) return;
    if (isSaving) return;
    const member = options.getMember(currentMemberId);
    if (!member) return;

    const validation = handleValidation();
    if (!validation.ok) {
      emitLog("WARN", "family.ui.validation_blocked", { member_id: currentMemberId, tab: tabs.activeId });
      toast.show({ kind: "info", message: "Please correct highlighted fields." });
      return;
    }

    emitLog("INFO", "family.ui.save_clicked", { member_id: currentMemberId, tab: tabs.activeId });

    const photoPathPatch = await applyPendingPhoto(member);
    const rawPatch = {
      ...buildPatch(member, validation.finance),
      ...(photoPathPatch !== undefined ? { photoPath: photoPathPatch } : {}),
    };
    const patch = pruneUnchangedFields(member, rawPatch);
    const hasChanges = Object.keys(patch).some((key) => key !== "id");
    hasPendingChanges = hasChanges;
    if (!isSaving) {
      setButtonsDisabled(false);
    }
    if (!hasChanges) {
      toast.show({ kind: "info", message: "No changes to save." });
      return;
    }
    isSaving = true;
    hasPendingChanges = false;
    setButtonsDisabled(true);

    try {
      const saved = await options.saveMember(patch);
      toast.show({ kind: "success", message: "Member details saved." });
      emitLog("INFO", "family.ui.save_completed", { member_id: currentMemberId, tab: tabs.activeId });
      pendingCloseReason = "save";
      modal.setOpen(false);
      syncMember(saved.id);
    } catch (error) {
      const { message, code } = resolveError(error);
      hasPendingChanges = true;
      toast.show({ kind: "error", message });
      emitLog("ERROR", "family.ui.save_failed", { member_id: currentMemberId, tab: tabs.activeId, error_code: code });
    } finally {
      isSaving = false;
      setButtonsDisabled(false);
    }
  };

  const handleCancel = () => {
    if (!currentMemberId) {
      modal.setOpen(false);
      return;
    }
    emitLog("INFO", "family.ui.cancel_clicked", { member_id: currentMemberId, tab: tabs.activeId });
    pendingCloseReason = "cancel";
    modal.setOpen(false);
  };

  saveButton.addEventListener("click", (event) => {
    event.preventDefault();
    void handleSave();
  });

  cancelButton.addEventListener("click", (event) => {
    event.preventDefault();
    handleCancel();
  });

  const handleKeydown = (event: KeyboardEvent) => {
    if (!modal.isOpen()) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "s") {
      event.preventDefault();
      if (!isSaving) {
        void handleSave();
      }
    }
  };

  const markDirty = (event: Event) => {
    if (destroyed || isSaving) {
      return;
    }
    const target = event.target as Node | null;
    if (ENABLE_FAMILY_RENEWALS && renewalsTab && target && renewalsTab.element.contains(target)) {
      return;
    }
    hasPendingChanges = true;
    setButtonsDisabled(false);
  };

  container.addEventListener("input", markDirty, { capture: true });
  container.addEventListener("change", markDirty, { capture: true });

  modal.dialog.addEventListener("keydown", handleKeydown);

  return {
    open(memberId) {
      if (destroyed) return;
      const member = options.getMember(memberId);
      if (!member) return;
      currentMemberId = memberId;
      syncMember(memberId);
      modal.setOpen(true);
      emitLog("INFO", "family.ui.drawer_opened", { member_id: memberId });
    },
    close(reason = "programmatic") {
      if (!modal.isOpen()) return;
      if (reason === "cancel") {
        handleCancel();
      } else if (reason === "save") {
        void handleSave();
      } else {
        pendingCloseReason = reason;
        modal.setOpen(false);
      }
    },
    destroy() {
      destroyed = true;
      modal.setOpen(false);
      modal.dialog.removeEventListener("keydown", handleKeydown);
      container.removeEventListener("input", markDirty, true);
      container.removeEventListener("change", markDirty, true);
      documentsTab.destroy();
      renewalsTab?.destroy();
      modal.root.remove();
    },
    isOpen() {
      return modal.isOpen();
    },
    sync() {
      if (currentMemberId) {
        syncMember(currentMemberId);
      }
    },
    getActiveMemberId() {
      return currentMemberId;
    },
  };
}
