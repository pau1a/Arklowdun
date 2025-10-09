import type { AttachmentRef, Renewal } from "@lib/ipc/contracts";

export type FamilyMemberStatus = "active" | "inactive" | "deceased";

export interface FamilyContactNumbers {
  mobile?: string | null;
  home?: string | null;
  work?: string | null;
}

export interface FamilyFinanceDetails {
  bankAccounts?: unknown;
  pensionDetails?: unknown;
  insuranceRefs?: string | null;
}

export interface FamilyEmergencyContact {
  name?: string | null;
  phone?: string | null;
}

export interface FamilyMember {
  id: string;
  householdId: string;
  name: string;
  nickname?: string | null;
  fullName?: string | null;
  relationship?: string | null;
  photoPath?: string | null;
  birthday?: number | null;
  notes?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: FamilyContactNumbers;
  personalWebsite?: string | null;
  socialLinks?: unknown;
  passportNumber?: string | null;
  passportExpiry?: number | null;
  drivingLicenceNumber?: string | null;
  drivingLicenceExpiry?: number | null;
  nhsNumber?: string | null;
  nationalInsuranceNumber?: string | null;
  taxId?: string | null;
  photoIdExpiry?: number | null;
  bloodGroup?: string | null;
  allergies?: string | null;
  medicalNotes?: string | null;
  gpContact?: string | null;
  emergencyContact?: FamilyEmergencyContact | null;
  finance?: FamilyFinanceDetails | null;
  tags?: unknown;
  groups?: unknown;
  lastVerified?: number | null;
  verifiedBy?: string | null;
  keyholder?: boolean;
  status?: FamilyMemberStatus;
  position?: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  deletedAt?: number | null;
}

export type MemberAttachment = AttachmentRef;
export type MemberRenewal = Renewal;

export interface FamilyState {
  members: Record<string, FamilyMember>;
  attachments: Record<string, MemberAttachment[]>;
  renewals: Record<string, MemberRenewal[]>;
  hydratedHouseholdId: string | null;
}

export type FamilyStoreSubscriber = (state: FamilyState) => void;
