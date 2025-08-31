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
