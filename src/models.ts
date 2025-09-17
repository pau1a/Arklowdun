export interface Bill {
  id: string;
  amount: number; // minor currency units
  due_date: number; // timestamp ms
  root_key: string;
  relative_path: string;
  reminder?: number; // timestamp ms
  household_id?: string;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}

export interface Policy {
  id: string;
  amount: number; // minor currency units
  due_date: number; // timestamp ms
  root_key: string;
  relative_path: string;
  reminder?: number; // timestamp ms
  household_id?: string;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}

export interface PropertyDocument {
  id: string;
  description: string;
  renewal_date: number; // timestamp ms
  root_key: string;
  relative_path: string;
  reminder?: number; // timestamp ms
  household_id?: string;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}

export interface MaintenanceEntry {
  id: string;
  vehicle_id: string;
  date: number; // timestamp ms
  type: string;
  cost: number;
  root_key: string;
  relative_path: string;
  household_id?: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}

export interface Vehicle {
  id: string;
  name: string;
  mot_date: number; // timestamp ms
  service_date: number; // timestamp ms
  mot_reminder?: number; // timestamp ms
  service_reminder?: number; // timestamp ms
  maintenance: MaintenanceEntry[];
  household_id?: string;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}

export interface PetMedicalRecord {
  id: string;
  pet_id: string;
  date: number; // timestamp ms
  description: string;
  root_key: string;
  relative_path: string;
  reminder?: number; // timestamp ms
  household_id?: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}

export interface Pet {
  id: string;
  name: string;
  type: string;
  medical: PetMedicalRecord[];
  household_id?: string;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}

export interface FamilyMember {
  id: string;
  name: string;
  birthday: number; // timestamp ms
  notes: string;
  documents: { root_key: string; relative_path: string }[];
  household_id?: string;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  purchase_date: number; // timestamp ms
  warranty_expiry: number; // timestamp ms
  root_key: string;
  relative_path: string;
  reminder?: number; // timestamp ms
  household_id?: string;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}

export interface BudgetCategory {
  id: string;
  name: string;
  monthly_budget: number;
  household_id?: string;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}

export interface Expense {
  id: string;
  category_id: string;
  amount: number;
  date: number; // timestamp ms
  description: string;
  household_id?: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}

export interface Note {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
  z?: number;
  household_id?: string;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
}

export interface ShoppingItem {
  id: string;
  text: string;
  completed: boolean;
  household_id?: string;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}

export type { Event } from "./bindings/Event";

