import { normalizeError } from "@lib/ipc/call";
import { logUI } from "@lib/uiLog";
import { familyRepo } from "../../repos";
import type { FamilyMemberCreateRequest } from "../../repos";
import type {
  FamilyMember,
  FamilyState,
  FamilyStoreSubscriber,
  MemberAttachment,
  MemberRenewal,
} from "./family.types";

type AppError = {
  message: string;
  code?: string;
  id?: string;
  context?: Record<string, string>;
  crash_id?: string;
  cause?: unknown;
};

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function uuid(prefix: string): string {
  const impl = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(16).slice(2);
  return `${prefix}-${impl}`;
}

function getString(source: Record<string, unknown>, ...keys: string[]): string | null | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = source[key];
      if (value === null || value === undefined) return value as null | undefined;
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
    }
  }
  return undefined;
}

function getNumber(source: Record<string, unknown>, ...keys: string[]): number | null | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = source[key];
      if (value === null || value === undefined) return value as null | undefined;
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) return parsed;
      }
    }
  }
  return undefined;
}

function getJson(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = source[key];
      if (value === null || value === undefined) return null;
      if (typeof value === "string") {
        if (value.trim().length === 0) return null;
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    }
  }
  return undefined;
}

const STATUS_VALUES = new Set(["active", "inactive", "deceased"]);

function normalizeMember(raw: Record<string, unknown>, fallbackHouseholdId: string): FamilyMember {
  const householdId =
    getString(raw, "householdId", "household_id") ?? fallbackHouseholdId;

  const keyholderRaw = raw.keyholder ?? raw["keyholder"];
  let keyholder: boolean | undefined;
  if (typeof keyholderRaw === "boolean") keyholder = keyholderRaw;
  else if (typeof keyholderRaw === "number") keyholder = keyholderRaw !== 0;
  else if (typeof keyholderRaw === "string") keyholder = keyholderRaw !== "0";

  const emergencyName = getString(raw, "emergencyContactName", "emergency_contact_name");
  const emergencyPhone = getString(raw, "emergencyContactPhone", "emergency_contact_phone");
  const emergencyContact = emergencyName || emergencyPhone ? { name: emergencyName ?? null, phone: emergencyPhone ?? null } : null;

  const bankAccounts = getJson(raw, "bankAccounts", "bank_accounts", "bank_accounts_json");
  const pensionDetails = getJson(raw, "pensionDetails", "pension_details", "pension_details_json");
  const tags = getJson(raw, "tags", "tags_json");
  const groups = getJson(raw, "groups", "groups_json");
  const socialLinks = getJson(raw, "socialLinks", "social_links", "social_links_json");

  const statusRaw = getString(raw, "status") ?? undefined;
  const status = statusRaw && STATUS_VALUES.has(statusRaw as string) ? (statusRaw as FamilyMember["status"]) : undefined;

  const finance = bankAccounts !== undefined || pensionDetails !== undefined || raw.insurance_refs !== undefined || raw["insuranceRefs"] !== undefined
    ? {
        bankAccounts: bankAccounts === undefined ? null : bankAccounts,
        pensionDetails: pensionDetails === undefined ? null : pensionDetails,
        insuranceRefs: getString(raw, "insuranceRefs", "insurance_refs") ?? null,
      }
    : null;

  return {
    id: getString(raw, "id") ?? uuid("member"),
    householdId,
    name: getString(raw, "name") ?? "",
    nickname: getString(raw, "nickname") ?? null,
    fullName: getString(raw, "fullName", "full_name") ?? null,
    relationship: getString(raw, "relationship") ?? null,
    photoPath: getString(raw, "photoPath", "photo_path") ?? null,
    birthday: getNumber(raw, "birthday") ?? null,
    notes: getString(raw, "notes") ?? null,
    address: getString(raw, "address") ?? null,
    email: getString(raw, "email") ?? null,
    phone:
      getString(raw, "phoneMobile", "phone_mobile") !== undefined ||
      getString(raw, "phoneHome", "phone_home") !== undefined ||
      getString(raw, "phoneWork", "phone_work") !== undefined
        ? {
            mobile: getString(raw, "phoneMobile", "phone_mobile") ?? null,
            home: getString(raw, "phoneHome", "phone_home") ?? null,
            work: getString(raw, "phoneWork", "phone_work") ?? null,
          }
        : undefined,
    personalWebsite: getString(raw, "personalWebsite", "personal_website") ?? null,
    socialLinks: socialLinks === undefined ? null : socialLinks,
    passportNumber: getString(raw, "passportNumber", "passport_number") ?? null,
    passportExpiry: getNumber(raw, "passportExpiry", "passport_expiry") ?? null,
    drivingLicenceNumber: getString(raw, "drivingLicenceNumber", "driving_licence_number") ?? null,
    drivingLicenceExpiry: getNumber(raw, "drivingLicenceExpiry", "driving_licence_expiry") ?? null,
    nhsNumber: getString(raw, "nhsNumber", "nhs_number") ?? null,
    nationalInsuranceNumber: getString(raw, "nationalInsuranceNumber", "national_insurance_number") ?? null,
    taxId: getString(raw, "taxId") ?? null,
    photoIdExpiry: getNumber(raw, "photoIdExpiry", "photo_id_expiry") ?? null,
    bloodGroup: getString(raw, "bloodGroup", "blood_group") ?? null,
    allergies: getString(raw, "allergies") ?? null,
    medicalNotes: getString(raw, "medicalNotes", "medical_notes") ?? null,
    gpContact: getString(raw, "gpContact", "gp_contact") ?? null,
    emergencyContact,
    finance,
    tags: tags === undefined ? null : tags,
    groups: groups === undefined ? null : groups,
    lastVerified: getNumber(raw, "lastVerified", "last_verified") ?? null,
    verifiedBy: getString(raw, "verifiedBy", "verified_by") ?? null,
    keyholder,
    status,
    position: getNumber(raw, "position") ?? null,
    createdAt: getNumber(raw, "createdAt", "created_at") ?? null,
    updatedAt: getNumber(raw, "updatedAt", "updated_at") ?? null,
    deletedAt: getNumber(raw, "deletedAt", "deleted_at") ?? null,
  };
}

function cloneMember(member: FamilyMember): FamilyMember {
  return {
    ...member,
    phone: member.phone ? { ...member.phone } : undefined,
    emergencyContact: member.emergencyContact ? { ...member.emergencyContact } : null,
    finance: member.finance ? { ...member.finance } : null,
  };
}

function cloneAttachment(attachment: MemberAttachment): MemberAttachment {
  return { ...attachment };
}

function cloneRenewal(renewal: MemberRenewal): MemberRenewal {
  return { ...renewal };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function createInitialState(): FamilyState {
  return {
    members: {},
    attachments: {},
    renewals: {},
    hydratedHouseholdId: null,
  };
}

let state: FamilyState = createInitialState();
const subscribers = new Set<FamilyStoreSubscriber>();

function snapshot(): FamilyState {
  const attachments: Record<string, MemberAttachment[]> = {};
  for (const [memberId, list] of Object.entries(state.attachments)) {
    attachments[memberId] = list.map(cloneAttachment);
  }
  const renewals: Record<string, MemberRenewal[]> = {};
  for (const [memberId, list] of Object.entries(state.renewals)) {
    renewals[memberId] = list.map(cloneRenewal);
  }
  const members: Record<string, FamilyMember> = {};
  for (const [id, member] of Object.entries(state.members)) {
    members[id] = cloneMember(member);
  }
  return {
    members,
    attachments,
    renewals,
    hydratedHouseholdId: state.hydratedHouseholdId,
  };
}

function emit(): void {
  const snap = snapshot();
  for (const listener of subscribers) {
    listener(snap);
  }
}

function ensureHydrated(): string {
  if (!state.hydratedHouseholdId) {
    throw new Error("family store not hydrated");
  }
  return state.hydratedHouseholdId;
}

function denormalizeMemberPatch(patch: Partial<FamilyMember>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.nickname !== undefined) out.nickname = patch.nickname;
  if (patch.fullName !== undefined) out.full_name = patch.fullName;
  if (patch.relationship !== undefined) out.relationship = patch.relationship;
  if (patch.photoPath !== undefined) out.photo_path = patch.photoPath;
  if (patch.birthday !== undefined) out.birthday = patch.birthday;
  if (patch.notes !== undefined) out.notes = patch.notes;
  if (patch.address !== undefined) out.address = patch.address;
  if (patch.email !== undefined) out.email = patch.email;
  if (patch.personalWebsite !== undefined) out.personal_website = patch.personalWebsite;
  if (patch.passportNumber !== undefined) out.passport_number = patch.passportNumber;
  if (patch.passportExpiry !== undefined) out.passport_expiry = patch.passportExpiry;
  if (patch.drivingLicenceNumber !== undefined) out.driving_licence_number = patch.drivingLicenceNumber;
  if (patch.drivingLicenceExpiry !== undefined) out.driving_licence_expiry = patch.drivingLicenceExpiry;
  if (patch.nhsNumber !== undefined) out.nhs_number = patch.nhsNumber;
  if (patch.nationalInsuranceNumber !== undefined) out.national_insurance_number = patch.nationalInsuranceNumber;
  if (patch.taxId !== undefined) out.tax_id = patch.taxId;
  if (patch.photoIdExpiry !== undefined) out.photo_id_expiry = patch.photoIdExpiry;
  if (patch.bloodGroup !== undefined) out.blood_group = patch.bloodGroup;
  if (patch.allergies !== undefined) out.allergies = patch.allergies;
  if (patch.medicalNotes !== undefined) out.medical_notes = patch.medicalNotes;
  if (patch.gpContact !== undefined) out.gp_contact = patch.gpContact;
  if (patch.lastVerified !== undefined) out.last_verified = patch.lastVerified;
  if (patch.verifiedBy !== undefined) out.verified_by = patch.verifiedBy;
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.position !== undefined) out.position = patch.position;
  if (patch.createdAt !== undefined) out.created_at = patch.createdAt;
  if (patch.updatedAt !== undefined) out.updated_at = patch.updatedAt;
  if (patch.deletedAt !== undefined) out.deleted_at = patch.deletedAt;
  if (patch.keyholder !== undefined) out.keyholder = patch.keyholder ? 1 : 0;
  if (patch.phone) {
    if (patch.phone.mobile !== undefined) out.phone_mobile = patch.phone.mobile;
    if (patch.phone.home !== undefined) out.phone_home = patch.phone.home;
    if (patch.phone.work !== undefined) out.phone_work = patch.phone.work;
  }
  if (patch.emergencyContact) {
    if (patch.emergencyContact.name !== undefined) out.emergency_contact_name = patch.emergencyContact.name;
    if (patch.emergencyContact.phone !== undefined) out.emergency_contact_phone = patch.emergencyContact.phone;
  }
  if (patch.finance) {
    if (patch.finance.bankAccounts !== undefined)
      out.bank_accounts_json = patch.finance.bankAccounts == null ? null : JSON.stringify(patch.finance.bankAccounts);
    if (patch.finance.pensionDetails !== undefined)
      out.pension_details_json = patch.finance.pensionDetails == null ? null : JSON.stringify(patch.finance.pensionDetails);
    if (patch.finance.insuranceRefs !== undefined)
      out.insurance_refs = patch.finance.insuranceRefs;
  }
  if (patch.tags !== undefined) out.tags_json = patch.tags == null ? null : JSON.stringify(patch.tags);
  if (patch.groups !== undefined) out.groups_json = patch.groups == null ? null : JSON.stringify(patch.groups);
  if (patch.socialLinks !== undefined)
    out.social_links_json = patch.socialLinks == null ? null : JSON.stringify(patch.socialLinks);
  return out;
}

export const familyStore = {
  async load(householdId: string, force = false): Promise<void> {
    const alreadyHydrated = state.hydratedHouseholdId === householdId && Object.keys(state.members).length > 0;
    if (alreadyHydrated && !force) {
      return;
    }

    const start = now();
    if (state.hydratedHouseholdId !== householdId) {
      state = createInitialState();
    }

    try {
      const membersRaw = await familyRepo.list({ householdId, orderBy: "position, created_at, id" });
      const members: Record<string, FamilyMember> = {};
      for (const raw of membersRaw as unknown[]) {
        const normalised = normalizeMember(toRecord(raw), householdId);
        members[normalised.id] = normalised;
      }
      state = {
        members,
        attachments: {},
        renewals: {},
        hydratedHouseholdId: householdId,
      };
      emit();
      logUI("INFO", "ui.family.load", {
        household_id: householdId,
        count: Object.keys(members).length,
        duration_ms: Math.round(now() - start),
      });
    } catch (error) {
      const normalized = normalizeError(error) as AppError;
      logUI("ERROR", "ui.family.error.load", {
        household_id: householdId,
        message: normalized.message,
      });
      throw normalized;
    }
  },

  getAll(): FamilyMember[] {
    const members = Object.values(state.members).map(cloneMember);
    members.sort((a, b) => {
      const posA = a.position ?? Number.MAX_SAFE_INTEGER;
      const posB = b.position ?? Number.MAX_SAFE_INTEGER;
      if (posA === posB) {
        return (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id);
      }
      return posA - posB;
    });
    return members;
  },

  get(id: string): FamilyMember | undefined {
    const member = state.members[id];
    return member ? cloneMember(member) : undefined;
  },

  subscribe(fn: FamilyStoreSubscriber): () => void {
    subscribers.add(fn);
    fn(snapshot());
    return () => {
      subscribers.delete(fn);
    };
  },

  optimisticCreate(patch: Partial<FamilyMember>) {
    const householdId = ensureHydrated();
    const previousMembers = state.members;
    const memberId = patch.id ?? uuid("member-temp");
    const optimistic: FamilyMember = {
      ...normalizeMember({}, householdId),
      ...patch,
      id: memberId,
      householdId,
    };
    const nextMembers = { ...state.members, [memberId]: optimistic };
    state = { ...state, members: nextMembers };
    emit();
    logUI("INFO", "ui.family.optimisticInsert", { member_id: memberId });
    return {
      memberId,
      rollback() {
        state = { ...state, members: previousMembers };
        emit();
        logUI("INFO", "ui.family.rollback", { member_id: memberId });
      },
    };
  },

  commitCreated(tempId: string | null | undefined, raw: unknown): FamilyMember {
    const householdId = ensureHydrated();
    const created = normalizeMember(toRecord(raw), householdId);
    const reconciledMembers = { ...state.members };
    if (tempId && reconciledMembers[tempId]) {
      delete reconciledMembers[tempId];
    }
    reconciledMembers[created.id] = created;
    state = { ...state, members: reconciledMembers };
    emit();
    logUI("INFO", "ui.family.upsert", { member_id: created.id, optimistic: false });
    logUI("INFO", "ui.family.reconciled", { member_id: created.id });
    return cloneMember(created);
  },

  async upsert(patch: Partial<FamilyMember>): Promise<FamilyMember> {
    if (!patch || typeof patch !== "object") {
      throw new Error("familyStore.upsert requires a patch object");
    }
    const householdId = ensureHydrated();
    const existingId = patch.id && state.members[patch.id] ? patch.id : undefined;
    const memberId = existingId ?? patch.id ?? uuid("member-temp");
    const start = now();

    const previousState = state.members;
    const optimistic: FamilyMember = {
      ...(existingId ? cloneMember(state.members[existingId]) : normalizeMember({}, householdId)),
      ...patch,
      id: memberId,
      householdId,
    };

    const nextMembers = { ...state.members, [memberId]: optimistic };
    state = { ...state, members: nextMembers };
    emit();
    logUI("INFO", "ui.family.upsert", { member_id: memberId, optimistic: true });
    if (!existingId) {
      logUI("INFO", "ui.family.optimisticInsert", { member_id: memberId });
    }

    try {
      if (existingId) {
        const payload = denormalizeMemberPatch({ ...patch, id: memberId });
        await familyRepo.update(householdId, memberId, payload);
        const reconciled = state.members[memberId];
        logUI("INFO", "ui.family.upsert", {
          member_id: memberId,
          optimistic: false,
          duration_ms: Math.round(now() - start),
        });
        logUI("INFO", "ui.family.reconciled", { member_id: memberId });
        return cloneMember(reconciled);
      }

      const payload = denormalizeMemberPatch({ ...patch, id: undefined });
      const request = { ...payload, householdId } as FamilyMemberCreateRequest;
      const createdRaw = await familyRepo.create(request);
      const created = normalizeMember(toRecord(createdRaw), householdId);
      const reconciledMembers = { ...state.members };
      delete reconciledMembers[memberId];
      reconciledMembers[created.id] = created;
      state = { ...state, members: reconciledMembers };
      emit();
      logUI("INFO", "ui.family.upsert", {
        member_id: created.id,
        optimistic: false,
        duration_ms: Math.round(now() - start),
      });
      logUI("INFO", "ui.family.reconciled", { member_id: created.id });
      return cloneMember(created);
    } catch (error) {
      state = { ...state, members: previousState };
      emit();
      const normalized = normalizeError(error) as AppError;
      logUI("WARN", "ui.family.rollback", { member_id: memberId });
      logUI("ERROR", "ui.family.error.reconcile", {
        member_id: memberId,
        message: normalized.message,
      });
      throw normalized;
    }
  },

  attachments: {
    async load(memberId: string): Promise<MemberAttachment[]> {
      const householdId = ensureHydrated();
      if (state.attachments[memberId]) {
        return state.attachments[memberId].map(cloneAttachment);
      }
      const start = now();
      try {
        const list = await familyRepo.attachments.list(memberId);
        state = {
          ...state,
          attachments: { ...state.attachments, [memberId]: list },
        };
        emit();
        logUI("INFO", "ui.family.attach.load", {
          member_id: memberId,
          household_id: householdId,
          count: list.length,
          duration_ms: Math.round(now() - start),
        });
        return list.map(cloneAttachment);
      } catch (error) {
        const normalized = normalizeError(error) as AppError;
        logUI("ERROR", "ui.family.error.reconcile", {
          member_id: memberId,
          message: normalized.message,
        });
        throw normalized;
      }
    },

    async add(memberId: string, file: File): Promise<MemberAttachment> {
      const householdId = ensureHydrated();
      const optimistic: MemberAttachment = {
        id: uuid("attach-temp"),
        householdId,
        memberId,
        rootKey: "attachments",
        relativePath: file.name,
        title: file.name,
        mimeHint: file.type || undefined,
        addedAt: Date.now(),
      };
      const previous = state.attachments[memberId] ?? [];
      const nextList = [...previous, optimistic];
      state = {
        ...state,
        attachments: { ...state.attachments, [memberId]: nextList },
      };
      emit();
      logUI("INFO", "ui.family.attach.add", {
        member_id: memberId,
        attachment_id: optimistic.id,
        optimistic: true,
        fileName: file.name,
      });

      try {
        const created = await familyRepo.attachments.add({
          householdId,
          memberId,
          rootKey: "attachments",
          relativePath: file.name,
          title: file.name,
          mimeHint: file.type || undefined,
        });
        const reconciled = [...nextList];
        const index = reconciled.findIndex((item) => item.id === optimistic.id);
        if (index >= 0) {
          reconciled.splice(index, 1, created);
        }
        state = {
          ...state,
          attachments: { ...state.attachments, [memberId]: reconciled },
        };
        emit();
        logUI("INFO", "ui.family.attach.add", {
          member_id: memberId,
          attachment_id: created.id,
          optimistic: false,
        });
        logUI("INFO", "ui.family.reconciled", {
          member_id: memberId,
          attachment_id: created.id,
        });
        return { ...created };
      } catch (error) {
        state = {
          ...state,
          attachments: { ...state.attachments, [memberId]: previous },
        };
        emit();
        const normalized = normalizeError(error) as AppError;
        logUI("WARN", "ui.family.rollback", {
          member_id: memberId,
          attachment_id: optimistic.id,
        });
        logUI("ERROR", "ui.family.error.reconcile", {
          member_id: memberId,
          message: normalized.message,
        });
        throw normalized;
      }
    },

    async remove(memberId: string, attachmentId: string): Promise<void> {
      ensureHydrated();
      const previous = state.attachments[memberId] ?? [];
      const next = previous.filter((item) => item.id !== attachmentId);
      state = {
        ...state,
        attachments: { ...state.attachments, [memberId]: next },
      };
      emit();
      const start = now();
      logUI("INFO", "ui.family.attach.remove", {
        member_id: memberId,
        attachment_id: attachmentId,
        optimistic: true,
      });

      try {
        await familyRepo.attachments.remove(attachmentId);
        logUI("INFO", "ui.family.attach.remove", {
          member_id: memberId,
          attachment_id: attachmentId,
          optimistic: false,
          duration_ms: Math.round(now() - start),
        });
        logUI("INFO", "ui.family.reconciled", {
          member_id: memberId,
          attachment_id: attachmentId,
        });
      } catch (error) {
        state = {
          ...state,
          attachments: { ...state.attachments, [memberId]: previous },
        };
        emit();
        const normalized = normalizeError(error) as AppError;
        logUI("WARN", "ui.family.rollback", {
          member_id: memberId,
          attachment_id: attachmentId,
        });
        logUI("ERROR", "ui.family.error.reconcile", {
          member_id: memberId,
          message: normalized.message,
        });
        throw normalized;
      }
    },
  },

  renewals: {
    async list(memberId: string): Promise<MemberRenewal[]> {
      ensureHydrated();
      if (state.renewals[memberId]) {
        return state.renewals[memberId].map(cloneRenewal);
      }
      const start = now();
      try {
        const renewals = await familyRepo.renewals.list(memberId);
        state = {
          ...state,
          renewals: { ...state.renewals, [memberId]: renewals },
        };
        emit();
        logUI("INFO", "ui.family.renewal.list", {
          member_id: memberId,
          count: renewals.length,
          duration_ms: Math.round(now() - start),
        });
        return renewals.map(cloneRenewal);
      } catch (error) {
        const normalized = normalizeError(error) as AppError;
        logUI("ERROR", "ui.family.error.reconcile", {
          member_id: memberId,
          message: normalized.message,
        });
        throw normalized;
      }
    },

    async upsert(memberId: string, data: Partial<MemberRenewal>): Promise<MemberRenewal> {
      const householdId = ensureHydrated();
      const previous = state.renewals[memberId] ?? [];
      const optimisticId = data.id ?? uuid("renewal-temp");
      const existing = previous.find((item) => item.id === optimisticId);
      if (!existing && (!data.kind || data.expiresAt === undefined)) {
        throw new Error("renewal kind and expiresAt required for new entries");
      }
      const optimistic: MemberRenewal = {
        ...(existing ? { ...existing } : {}),
        id: optimisticId,
        householdId,
        memberId,
        kind: data.kind ?? existing?.kind ?? "passport",
        label: data.label ?? existing?.label,
        expiresAt: data.expiresAt ?? existing?.expiresAt ?? Date.now(),
        remindOnExpiry: data.remindOnExpiry ?? existing?.remindOnExpiry ?? false,
        remindOffsetDays: data.remindOffsetDays ?? existing?.remindOffsetDays ?? 0,
        updatedAt: data.updatedAt ?? Date.now(),
      };
      const existingIndex = previous.findIndex((item) => item.id === optimistic.id);
      const next = [...previous];
      if (existingIndex >= 0) next.splice(existingIndex, 1, optimistic);
      else next.push(optimistic);
      state = {
        ...state,
        renewals: { ...state.renewals, [memberId]: next },
      };
      emit();
      const start = now();
      logUI("INFO", "ui.family.renewal.upsert", {
        member_id: memberId,
        renewal_id: optimistic.id,
        optimistic: true,
      });

      try {
        const payload = {
          ...data,
          kind: optimistic.kind,
          expiresAt: optimistic.expiresAt,
          remindOnExpiry: optimistic.remindOnExpiry,
          remindOffsetDays: optimistic.remindOffsetDays,
          householdId,
          memberId,
          id: data.id,
          label: optimistic.label,
        };
        const saved = await familyRepo.renewals.upsert(payload as any);
        const reconciled = [...next];
        const index = reconciled.findIndex((item) => item.id === optimistic.id);
        if (index >= 0) reconciled.splice(index, 1, saved);
        else reconciled.push(saved);
        state = {
          ...state,
          renewals: { ...state.renewals, [memberId]: reconciled },
        };
        emit();
        logUI("INFO", "ui.family.renewal.upsert", {
          member_id: memberId,
          renewal_id: saved.id,
          optimistic: false,
          duration_ms: Math.round(now() - start),
        });
        logUI("INFO", "ui.family.reconciled", {
          member_id: memberId,
          renewal_id: saved.id,
        });
        return { ...saved };
      } catch (error) {
        state = {
          ...state,
          renewals: { ...state.renewals, [memberId]: previous },
        };
        emit();
        const normalized = normalizeError(error) as AppError;
        logUI("WARN", "ui.family.rollback", {
          member_id: memberId,
          renewal_id: optimistic.id,
        });
        logUI("ERROR", "ui.family.error.reconcile", {
          member_id: memberId,
          message: normalized.message,
        });
        throw normalized;
      }
    },

    async delete(memberId: string, renewalId: string): Promise<void> {
      ensureHydrated();
      const previous = state.renewals[memberId] ?? [];
      const next = previous.filter((item) => item.id !== renewalId);
      state = {
        ...state,
        renewals: { ...state.renewals, [memberId]: next },
      };
      emit();
      const start = now();
      logUI("INFO", "ui.family.renewal.delete", {
        member_id: memberId,
        renewal_id: renewalId,
        optimistic: true,
      });

      try {
        await familyRepo.renewals.delete(renewalId);
        logUI("INFO", "ui.family.renewal.delete", {
          member_id: memberId,
          renewal_id: renewalId,
          optimistic: false,
          duration_ms: Math.round(now() - start),
        });
        logUI("INFO", "ui.family.reconciled", {
          member_id: memberId,
          renewal_id: renewalId,
        });
      } catch (error) {
        state = {
          ...state,
          renewals: { ...state.renewals, [memberId]: previous },
        };
        emit();
        const normalized = normalizeError(error) as AppError;
        logUI("WARN", "ui.family.rollback", {
          member_id: memberId,
          renewal_id: renewalId,
        });
        logUI("ERROR", "ui.family.error.reconcile", {
          member_id: memberId,
          message: normalized.message,
        });
        throw normalized;
      }
    },
  },

  /** @internal test helper */
  __resetForTests(): void {
    state = createInitialState();
    subscribers.clear();
  },
};

export type FamilyStore = typeof familyStore;
