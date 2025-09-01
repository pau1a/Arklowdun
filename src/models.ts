export interface Bill {
  id: string;
  amount: number;
  dueDate: number; // timestamp ms
  document: string; // file path
  reminder?: number; // timestamp ms
  household_id?: string;
}

export interface Policy {
  id: string;
  amount: number;
  dueDate: number; // timestamp ms
  document: string; // file path
  reminder?: number; // timestamp ms
  household_id?: string;
}

export interface PropertyDocument {
  id: string;
  description: string;
  renewalDate: number; // timestamp ms
  document: string; // file path
  reminder?: number; // timestamp ms
  household_id?: string;
}

export interface MaintenanceEntry {
  date: number; // timestamp ms
  type: string;
  cost: number;
  document: string; // file path
  household_id?: string;
}

export interface Vehicle {
  id: string;
  name: string;
  motDate: number; // timestamp ms
  serviceDate: number; // timestamp ms
  motReminder?: number; // timestamp ms
  serviceReminder?: number; // timestamp ms
  maintenance: MaintenanceEntry[];
  household_id?: string;
}

export interface PetMedicalRecord {
  date: number; // timestamp ms
  description: string;
  document: string; // file path
  reminder?: number; // timestamp ms
  household_id?: string;
}

export interface Pet {
  id: string;
  name: string;
  type: string;
  medical: PetMedicalRecord[];
  household_id?: string;
}

export interface FamilyMember {
  id: string;
  name: string;
  birthday: number; // timestamp ms
  notes: string;
  documents: string[]; // file paths
  household_id?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  purchaseDate: number; // timestamp ms
  warrantyExpiry: number; // timestamp ms
  document: string; // file path
  reminder?: number; // timestamp ms
  household_id?: string;
}

export interface BudgetCategory {
  id: string;
  name: string;
  monthlyBudget: number;
  household_id?: string;
}

export interface Expense {
  id: string;
  categoryId: string;
  amount: number;
  date: number; // timestamp ms
  description: string;
  household_id?: string;
}

