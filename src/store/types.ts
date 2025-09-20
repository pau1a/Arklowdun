export type FsEntryLite = {
  name: string;
  isDirectory?: boolean;
  isFile?: boolean;
  reminder?: number | null;
  reminder_tz?: string | null;
};

