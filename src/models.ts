export interface Bill {
  id: string;
  amount: number;
  dueDate: string; // ISO string
  document: string; // file path
  reminder?: number; // timestamp ms
}

export interface Policy {
  id: string;
  amount: number;
  dueDate: string; // ISO string
  document: string; // file path
  reminder?: number; // timestamp ms
}

export interface PropertyDocument {
  id: string;
  description: string;
  renewalDate: string; // ISO string
  document: string; // file path
  reminder?: number; // timestamp ms
}

export interface MaintenanceEntry {
  date: string; // ISO string
  type: string;
  cost: number;
  document: string; // file path
}

export interface Vehicle {
  id: string;
  name: string;
  motDate: string; // ISO string
  serviceDate: string; // ISO string
  motReminder?: number; // timestamp ms
  serviceReminder?: number; // timestamp ms
  maintenance: MaintenanceEntry[];
}

export interface PetMedicalRecord {
  date: string; // ISO string
  description: string;
  document: string; // file path
  reminder?: number; // timestamp ms
}

export interface Pet {
  id: string;
  name: string;
  type: string;
  medical: PetMedicalRecord[];
}

export interface FamilyMember {
  id: string;
  name: string;
  birthday: string; // ISO string
  notes: string;
  documents: string[]; // file paths
}

export interface InventoryItem {
  id: string;
  name: string;
  purchaseDate: string; // ISO string
  warrantyExpiry: string; // ISO string
  document: string; // file path
  reminder?: number; // timestamp ms
}

export interface BudgetCategory {
  id: string;
  name: string;
  monthlyBudget: number;
}

export interface Expense {
  id: string;
  categoryId: string;
  amount: number;
  date: string; // ISO string
  description: string;
}

