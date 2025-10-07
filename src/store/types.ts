export type FsEntryLite = {
  name: string;
  isDirectory?: boolean;
  isFile?: boolean;
  size_bytes?: number | null;
  modified_at?: string | null;
  mime?: string | null;
  reminder?: number | null;
  reminder_tz?: string | null;
};

