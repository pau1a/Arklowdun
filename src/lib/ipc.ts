import { toast } from '@ui/Toast';

export type FsUiError =
  | { code: 'NOT_ALLOWED'; message: string }
  | { code: 'INVALID_INPUT'; message: string }
  | { code: 'IO/GENERIC'; message: string }
  | { code: 'INVALID_CATEGORY'; message: string }
  | { code: 'INVALID_HOUSEHOLD'; message: string }
  | { code: 'PATH_OUT_OF_VAULT'; message: string }
  | { code: 'SYMLINK_DENIED'; message: string }
  | { code: 'FILENAME_INVALID'; message: string }
  | { code: 'NAME_TOO_LONG'; message: string };

export function presentFsError(e: unknown) {
  const any = e as Partial<FsUiError> | undefined;
  const code = any?.code ?? 'IO/GENERIC';
  const title =
    code === 'NOT_ALLOWED'
      ? "That location isn't allowed"
      : code === 'INVALID_INPUT'
      ? 'Invalid path'
      : code === 'INVALID_CATEGORY'
      ? 'Attachment category not supported'
      : code === 'INVALID_HOUSEHOLD'
      ? 'Attachment belongs to another household'
      : code === 'PATH_OUT_OF_VAULT'
      ? 'Attachment path is outside the vault'
      : code === 'SYMLINK_DENIED'
      ? 'Attachments cannot follow symlinks'
      : code === 'FILENAME_INVALID'
      ? 'Attachment name is not allowed'
      : code === 'NAME_TOO_LONG'
      ? 'Attachment name is too long'
      : 'File error';
  toast.show({ kind: 'error', message: title });
  // Optional dev console crumb without paths
  console.debug('[fs-deny]', { code, when: new Date().toISOString() });
}
