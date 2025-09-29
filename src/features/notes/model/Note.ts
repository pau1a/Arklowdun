export interface Note {
  id: string;
  category_id?: string | null;
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
  deadline?: number | null;
  deadline_tz?: string | null;
}
