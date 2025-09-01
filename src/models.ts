export interface Bill {
  id: string;
  amount: number;
  dueDate: number; // timestamp ms
  document: string; // file path
  reminder?: number; // timestamp ms
}

export interface Policy {
  id: string;
  amount: number;
  dueDate: number; // timestamp ms
  document: string; // file path
  reminder?: number; // timestamp ms
}

export interface PropertyDocument {
  id: string;
  description: string;
  renewalDate: number; // timestamp ms
  document: string; // file path
  reminder?: number; // timestamp ms
}

export interface MaintenanceEntry {
  date: number; // timestamp ms
  type: string;
  cost: number;
  document: string; // file path
}

export interface Vehicle {
  id: string;
  name: string;
  motDate: number; // timestamp ms
  serviceDate: number; // timestamp ms
  motReminder?: number; // timestamp ms
  serviceReminder?: number; // timestamp ms
  maintenance: MaintenanceEntry[];
}

export interface PetMedicalRecord {
  date: number; // timestamp ms
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
  birthday: number; // timestamp ms
  notes: string;
  documents: string[]; // file paths
}

export interface InventoryItem {
  id: string;
  name: string;
  purchaseDate: number; // timestamp ms
  warrantyExpiry: number; // timestamp ms
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
  date: number; // timestamp ms
  description: string;
}

