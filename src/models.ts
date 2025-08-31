export interface Bill {
  id: number;
  amount: number;
  dueDate: string; // ISO string
  document: string; // file path
  reminder?: number; // timestamp ms
}

export interface Policy {
  id: number;
  amount: number;
  dueDate: string; // ISO string
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
  id: number;
  name: string;
  motDate: string; // ISO string
  serviceDate: string; // ISO string
  motReminder?: number; // timestamp ms
  serviceReminder?: number; // timestamp ms
  maintenance: MaintenanceEntry[];
}

