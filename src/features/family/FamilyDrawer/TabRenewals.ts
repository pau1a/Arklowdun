import { normalizeError } from "@lib/ipc/call";
import { RenewalKindSchema, type RenewalKind } from "@lib/ipc/contracts";
import { toast } from "@ui/Toast";
import { familyStore } from "../family.store";
import type { FamilyMember, MemberRenewal } from "../family.types";

const RENEWAL_KIND_LABELS: Record<RenewalKind, string> = {
  passport: "Passport",
  driving_licence: "Driving licence",
  photo_id: "Photo ID",
  insurance: "Insurance",
  pension: "Pension",
};

const RENEWAL_KINDS = RenewalKindSchema.options.map((value) => ({
  value: value as MemberRenewal["kind"],
  label: RENEWAL_KIND_LABELS[value],
}));

const SAVE_DEBOUNCE_MS = 420;
const MAX_OFFSET_DAYS = 365;

type RenewalDraft = {
  id: string;
  householdId: string;
  memberId: string;
  kind: MemberRenewal["kind"];
  label?: string;
  expiresAt: number;
  remindOnExpiry: boolean;
  remindOffsetDays: number;
  updatedAt: number;
};

interface RowController {
  id: string;
  readonly element: HTMLTableRowElement;
  isDraft: boolean;
  setServerState(renewal: MemberRenewal): void;
  flush(): Promise<void>;
  dispose(): void;
}

function alignToLocalNoon(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(12, 0, 0, 0);
  return date.getTime();
}

function toDateInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateInput(value: string, fallback: number): number {
  if (!value || value.split("-").length !== 3) {
    return fallback;
  }
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return fallback;
  }
  const date = new Date();
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date.getTime();
}

function buildEmptyDraft(member: FamilyMember): RenewalDraft {
  const now = Date.now();
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2);
  return {
    id: `renewal-temp-${random}`,
    householdId: member.householdId,
    memberId: member.id,
    kind: "passport",
    label: undefined,
    expiresAt: alignToLocalNoon(now + 90 * 24 * 60 * 60 * 1000),
    remindOnExpiry: false,
    remindOffsetDays: 30,
    updatedAt: now,
  };
}

function describeSchedule(draft: RenewalDraft): string {
  if (!draft.remindOnExpiry) {
    return "Reminders off";
  }
  if (draft.remindOffsetDays === 0) {
    return "Remind on expiry";
  }
  return `Remind ${draft.remindOffsetDays} days before`;
}

function describeExpiry(draft: RenewalDraft): { label: string; variant: "default" | "soon" | "past" } | null {
  const now = Date.now();
  const diff = draft.expiresAt - now;
  if (diff < 0) {
    return { label: "Past date", variant: "past" };
  }
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days <= 30) {
    return { label: "Due soon", variant: "soon" };
  }
  return null;
}

function clampOffset(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(0, Math.round(value)), MAX_OFFSET_DAYS);
}

export interface RenewalsTabInstance {
  element: HTMLElement;
  setMember(member: FamilyMember | null): void;
  updateRenewals(list: MemberRenewal[]): void;
  flushPending(): Promise<void>;
  destroy(): void;
}

export function createRenewalsTab(): RenewalsTabInstance {
  const element = document.createElement("div");
  element.className = "family-drawer__panel family-renewals";
  element.id = "family-drawer-panel-renewals";

  const toolbar = document.createElement("div");
  toolbar.className = "family-renewals__toolbar";

  const heading = document.createElement("h3");
  heading.className = "family-renewals__heading";
  heading.textContent = "Renewals";
  toolbar.appendChild(heading);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "family-drawer__add family-renewals__add";
  addButton.textContent = "Add";
  addButton.setAttribute("aria-label", "Add renewal");
  addButton.disabled = true;
  toolbar.appendChild(addButton);

  element.appendChild(toolbar);

  const table = document.createElement("table");
  table.className = "family-renewals__table";
  table.setAttribute("role", "grid");

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const headings = ["Kind", "Label", "Expiry", "Reminder", "Offset", "Actions"];
  for (const label of headings) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  element.appendChild(table);

  const emptyState = document.createElement("p");
  emptyState.className = "family-renewals__empty";
  emptyState.textContent = "No renewals yet. Add passport, licence, policy or pension.";
  element.appendChild(emptyState);

  const loadingState = document.createElement("p");
  loadingState.className = "family-renewals__loading";
  loadingState.textContent = "Loading renewals…";
  loadingState.hidden = true;
  element.appendChild(loadingState);

  const statusRegion = document.createElement("div");
  statusRegion.className = "family-renewals__live";
  statusRegion.setAttribute("role", "status");
  statusRegion.setAttribute("aria-live", "polite");
  element.appendChild(statusRegion);

  let currentMember: FamilyMember | null = null;
  let loadToken = 0;
  let destroyed = false;
  const controllers = new Map<string, RowController>();

  const clearRows = () => {
    for (const controller of controllers.values()) {
      controller.dispose();
    }
    controllers.clear();
    tbody.innerHTML = "";
  };

  const setStatus = (message: string) => {
    statusRegion.textContent = message;
  };

  const setLoading = (value: boolean) => {
    loadingState.hidden = !value;
    table.classList.toggle("family-renewals__table--loading", value);
  };

  const syncEmptyState = () => {
    emptyState.hidden = controllers.size > 0 || loadingState.hidden === false;
  };

  const getMember = () => currentMember;

  const removeController = (id: string) => {
    const controller = controllers.get(id);
    if (!controller) return;
    controller.dispose();
    controllers.delete(id);
    syncEmptyState();
  };

  const commitDelete = async (id: string, isDraft: boolean) => {
    const member = currentMember;
    if (!member) return;
    if (isDraft) {
      removeController(id);
      setStatus("Draft renewal removed.");
      return;
    }
    const confirmed = window.confirm("Remove this renewal?");
    if (!confirmed) return;
    try {
      await familyStore.renewals.delete(member.id, id);
      toast.show({ kind: "success", message: "Deleted." });
      setStatus("Renewal deleted.");
    } catch (error) {
      const normalized = normalizeError(error);
      toast.show({ kind: "error", message: normalized.message ?? "Could not delete renewal." });
      setStatus("Failed to delete renewal.");
    }
  };

  class RenewalRow implements RowController {
    id: string;
    readonly element: HTMLTableRowElement;
    isDraft: boolean;
    private draft: RenewalDraft;
    private committed: RenewalDraft;
    private timer: number | null = null;
    private saving = false;
    private disposed = false;
    private error: string | null = null;
    private readonly kindSelect: HTMLSelectElement;
    private readonly labelInput: HTMLInputElement;
    private readonly expiryInput: HTMLInputElement;
    private readonly remindToggle: HTMLInputElement;
    private readonly offsetInput: HTMLInputElement;
    private readonly statusCell: HTMLTableCellElement;
    private readonly errorCell: HTMLDivElement;

    constructor(initial: RenewalDraft, options?: { isDraft?: boolean }) {
      this.id = initial.id;
      this.draft = { ...initial };
      this.committed = { ...initial };
      this.isDraft = Boolean(options?.isDraft);
      this.element = document.createElement("tr");
      this.element.className = "family-renewals__row";
      this.element.dataset.renewalId = this.id;

      this.kindSelect = document.createElement("select");
      this.kindSelect.className = "family-renewals__select";
      this.kindSelect.setAttribute("aria-label", "Renewal type");
      for (const option of RENEWAL_KINDS) {
        const el = document.createElement("option");
        el.value = option.value;
        el.textContent = option.label;
        this.kindSelect.appendChild(el);
      }

      this.labelInput = document.createElement("input");
      this.labelInput.type = "text";
      this.labelInput.className = "family-renewals__input";
      this.labelInput.placeholder = "Optional label";
      this.labelInput.setAttribute("aria-label", "Renewal label");
      this.labelInput.maxLength = 120;

      this.expiryInput = document.createElement("input");
      this.expiryInput.type = "date";
      this.expiryInput.className = "family-renewals__date";
      this.expiryInput.setAttribute("aria-label", "Expiry date");

      this.remindToggle = document.createElement("input");
      this.remindToggle.type = "checkbox";
      this.remindToggle.className = "family-renewals__checkbox";
      this.remindToggle.setAttribute("aria-label", "Enable reminder");

      this.offsetInput = document.createElement("input");
      this.offsetInput.type = "number";
      this.offsetInput.className = "family-renewals__number";
      this.offsetInput.min = "0";
      this.offsetInput.max = `${MAX_OFFSET_DAYS}`;
      this.offsetInput.setAttribute("aria-label", "Reminder offset (days)");

      this.statusCell = document.createElement("td");
      this.statusCell.className = "family-renewals__status";

      this.errorCell = document.createElement("div");
      this.errorCell.className = "family-renewals__error";
      this.errorCell.id = `family-renewal-error-${this.id}`;
      this.errorCell.setAttribute("role", "status");
      this.errorCell.setAttribute("aria-live", "polite");

      this.kindSelect.addEventListener("change", () => {
        if (this.disposed) return;
        this.draft.kind = this.kindSelect.value as MemberRenewal["kind"];
        this.queueSave();
      });

      this.labelInput.addEventListener("input", () => {
        if (this.disposed) return;
        const trimmed = this.labelInput.value.trim();
        this.draft.label = trimmed.length > 0 ? trimmed : undefined;
        this.queueSave();
      });

      this.expiryInput.addEventListener("change", () => {
        if (this.disposed) return;
        this.draft.expiresAt = fromDateInput(this.expiryInput.value, this.draft.expiresAt);
        this.queueSave();
      });

      this.remindToggle.addEventListener("change", () => {
        if (this.disposed) return;
        this.draft.remindOnExpiry = this.remindToggle.checked;
        this.queueSave();
      });

      this.offsetInput.addEventListener("change", () => {
        if (this.disposed) return;
        const parsed = Number(this.offsetInput.value);
        const clamped = clampOffset(parsed);
        if (clamped !== parsed) {
          this.offsetInput.value = `${clamped}`;
          setStatus("Offset must be between 0 and 365 days.");
        }
        this.draft.remindOffsetDays = clamped;
        this.queueSave();
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "family-drawer__ghost family-renewals__delete";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        if (this.disposed) return;
        void commitDelete(this.id, this.isDraft);
      });

      const cells: (HTMLElement | ((td: HTMLTableCellElement) => void))[] = [
        (td) => td.appendChild(this.kindSelect),
        (td) => td.appendChild(this.labelInput),
        (td) => {
          td.appendChild(this.expiryInput);
          td.appendChild(this.errorCell);
        },
        (td) => {
          td.classList.add("family-renewals__remind");
          td.appendChild(this.remindToggle);
          td.appendChild(this.statusCell);
        },
        (td) => td.appendChild(this.offsetInput),
        (td) => td.appendChild(deleteButton),
      ];

      for (const render of cells) {
        const cell = document.createElement("td");
        cell.className = "family-renewals__cell";
        if (typeof render === "function") {
          render(cell);
        }
        this.element.appendChild(cell);
      }

      this.applyDraft();
    }

    dispose(): void {
      this.disposed = true;
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.element.remove();
    }

    setServerState(renewal: MemberRenewal): void {
      if (this.disposed) return;
      const updated: RenewalDraft = {
        id: renewal.id,
        householdId: renewal.householdId,
        memberId: renewal.memberId,
        kind: renewal.kind,
        label: renewal.label,
        expiresAt: renewal.expiresAt,
        remindOnExpiry: renewal.remindOnExpiry,
        remindOffsetDays: renewal.remindOffsetDays,
        updatedAt: renewal.updatedAt,
      };
      this.committed = { ...updated };
      if (!this.saving) {
        this.draft = { ...updated };
        this.applyDraft();
      }
      this.isDraft = false;
      if (this.id !== renewal.id) {
        controllers.delete(this.id);
        this.id = renewal.id;
        this.element.dataset.renewalId = this.id;
        controllers.set(this.id, this);
      }
    }

    private queueSave(): void {
      if (this.disposed) return;
      if (this.timer !== null) {
        clearTimeout(this.timer);
      }
      this.timer = window.setTimeout(() => {
        this.timer = null;
        void this.commit();
      }, SAVE_DEBOUNCE_MS);
      this.updateDisplay();
    }

    private applyDraft(): void {
      this.kindSelect.value = this.draft.kind;
      this.labelInput.value = this.draft.label ?? "";
      this.expiryInput.value = toDateInputValue(this.draft.expiresAt);
      this.remindToggle.checked = this.draft.remindOnExpiry;
      this.offsetInput.value = `${this.draft.remindOffsetDays}`;
      this.offsetInput.disabled = !this.draft.remindOnExpiry;
      this.updateDisplay();
    }

    async flush(): Promise<void> {
      if (this.disposed) return;
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
        await this.commit();
      }
    }

    private updateDisplay(): void {
      this.offsetInput.disabled = !this.draft.remindOnExpiry;
      const schedule = describeSchedule(this.draft);
      this.statusCell.textContent = schedule;
      const badge = describeExpiry(this.draft);
      if (badge) {
        this.statusCell.setAttribute("data-badge", "true");
        this.statusCell.setAttribute("data-badge-variant", badge.variant);
        this.statusCell.dataset.badgeLabel = badge.label;
      } else {
        this.statusCell.removeAttribute("data-badge");
        this.statusCell.removeAttribute("data-badge-variant");
        delete this.statusCell.dataset.badgeLabel;
      }
      this.element.classList.toggle("family-renewals__row--saving", this.saving);
      this.setError(this.error);
    }

    private setError(message: string | null): void {
      this.error = message;
      if (message) {
        this.errorCell.textContent = message;
        this.errorCell.hidden = false;
        this.expiryInput.setAttribute("aria-invalid", "true");
      } else {
        this.errorCell.textContent = "";
        this.errorCell.hidden = true;
        this.expiryInput.removeAttribute("aria-invalid");
      }
    }

    private validate(): { ok: true } | { ok: false; message: string } {
      const now = Date.now();
      if (!RENEWAL_KINDS.some((item) => item.value === this.draft.kind)) {
        return { ok: false, message: "Choose a valid renewal type." };
      }
      if (this.draft.expiresAt <= now) {
        return { ok: false, message: "Expiry must be in the future." };
      }
      if (this.draft.remindOnExpiry) {
        const offset = clampOffset(this.draft.remindOffsetDays);
        if (offset !== this.draft.remindOffsetDays) {
          this.draft.remindOffsetDays = offset;
        }
      }
      return { ok: true };
    }

    private async commit(): Promise<void> {
      if (this.disposed) return;
      const member = getMember();
      if (!member) return;

      const validation = this.validate();
      if (!validation.ok) {
        this.setError(validation.message);
        setStatus(validation.message);
        return;
      }
      this.setError(null);

      this.saving = true;
      this.updateDisplay();

      const payload = {
        id: this.isDraft ? undefined : this.id,
        kind: this.draft.kind,
        label: this.draft.label,
        expiresAt: this.draft.expiresAt,
        remindOnExpiry: this.draft.remindOnExpiry,
        remindOffsetDays: this.draft.remindOffsetDays,
      } satisfies Partial<MemberRenewal>;

      try {
        const saved = await familyStore.renewals.upsert(member.id, payload);
        this.saving = false;
        this.setServerState(saved);
        this.draft = {
          id: saved.id,
          householdId: saved.householdId,
          memberId: saved.memberId,
          kind: saved.kind,
          label: saved.label,
          expiresAt: saved.expiresAt,
          remindOnExpiry: saved.remindOnExpiry,
          remindOffsetDays: saved.remindOffsetDays,
          updatedAt: saved.updatedAt,
        };
        this.applyDraft();
        toast.show({ kind: "success", message: "Saved." });
        setStatus("Renewal saved.");
      } catch (error) {
        this.saving = false;
        this.draft = { ...this.committed };
        this.applyDraft();
        const normalized = normalizeError(error);
        const message = normalized.message ?? "Could not save renewal.";
        this.setError(message);
        toast.show({ kind: "error", message });
        setStatus(message);
      }
    }
  }

  const ensureRow = (draft: RenewalDraft, options?: { isDraft?: boolean }): RenewalRow => {
    const existing = controllers.get(draft.id);
    if (existing instanceof RenewalRow) {
      existing.setServerState({
        id: draft.id,
        householdId: draft.householdId,
        memberId: draft.memberId,
        kind: draft.kind,
        label: draft.label,
        expiresAt: draft.expiresAt,
        remindOnExpiry: draft.remindOnExpiry,
        remindOffsetDays: draft.remindOffsetDays,
        updatedAt: draft.updatedAt,
      });
      return existing as RenewalRow;
    }
    const row = new RenewalRow(draft, options);
    controllers.set(row.id, row);
    return row;
  };

  const applyRenewals = (list: MemberRenewal[]) => {
    if (!currentMember) return;
    const sorted = [...list].sort((a, b) => {
      if (a.expiresAt !== b.expiresAt) {
        return a.expiresAt - b.expiresAt;
      }
      return a.id.localeCompare(b.id);
    });
    const used = new Set<string>();
    const fragment = document.createDocumentFragment();
    for (const renewal of sorted) {
      const draft: RenewalDraft = {
        id: renewal.id,
        householdId: renewal.householdId,
        memberId: renewal.memberId,
        kind: renewal.kind,
        label: renewal.label,
        expiresAt: renewal.expiresAt,
        remindOnExpiry: renewal.remindOnExpiry,
        remindOffsetDays: renewal.remindOffsetDays,
        updatedAt: renewal.updatedAt,
      };
      const row = ensureRow(draft);
      row.isDraft = false;
      row.setServerState(renewal);
      fragment.appendChild(row.element);
      used.add(row.id);
    }

    for (const [id, controller] of controllers) {
      if ((controller as RenewalRow).isDraft) {
        fragment.appendChild(controller.element);
        continue;
      }
      if (!used.has(id)) {
        controller.dispose();
        controllers.delete(id);
      }
    }

    tbody.innerHTML = "";
    tbody.appendChild(fragment);
    syncEmptyState();
  };

  const handleAdd = () => {
    const member = currentMember;
    if (!member) return;
    const draft = buildEmptyDraft(member);
    const row = ensureRow(draft, { isDraft: true });
    tbody.insertBefore(row.element, tbody.firstChild);
    row.isDraft = true;
    row.setServerState({
      id: draft.id,
      householdId: draft.householdId,
      memberId: draft.memberId,
      kind: draft.kind,
      label: draft.label,
      expiresAt: draft.expiresAt,
      remindOnExpiry: draft.remindOnExpiry,
      remindOffsetDays: draft.remindOffsetDays,
      updatedAt: draft.updatedAt,
    });
    row.element.querySelector("select")?.focus();
    syncEmptyState();
  };

  addButton.addEventListener("click", (event) => {
    event.preventDefault();
    handleAdd();
  });

  const loadForMember = async (member: FamilyMember) => {
    const token = ++loadToken;
    setLoading(true);
    try {
      const renewals = await familyStore.renewals.list(member.id);
      if (destroyed || token !== loadToken) return;
      applyRenewals(renewals);
    } catch (error) {
      const normalized = normalizeError(error);
      const message = normalized.message ?? "Could not load renewals.";
      toast.show({ kind: "error", message });
      setStatus(message);
    } finally {
      if (token === loadToken) {
        setLoading(false);
        syncEmptyState();
      }
    }
  };

  return {
    element,
    setMember(member) {
      if (destroyed) return;
      if (!member) {
        currentMember = null;
        clearRows();
        setLoading(false);
        syncEmptyState();
        addButton.disabled = true;
        return;
      }
      const isSame = currentMember?.id === member.id;
      currentMember = member;
      addButton.disabled = false;
      if (!isSame) {
        clearRows();
        syncEmptyState();
        void loadForMember(member);
      }
    },
    updateRenewals(list) {
      if (destroyed || !currentMember) return;
      applyRenewals(list);
    },
    async flushPending() {
      await Promise.all(
        Array.from(controllers.values(), (controller) => controller.flush()),
      );
    },
    destroy() {
      destroyed = true;
      clearRows();
      element.remove();
    },
  };
}

