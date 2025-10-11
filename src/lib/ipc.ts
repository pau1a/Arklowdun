import { toast } from '@ui/Toast';

export type FsUiError =
  | { code: 'NOT_ALLOWED'; message: string }
  | { code: 'INVALID_INPUT'; message: string }
  | { code: 'IO/GENERIC'; message: string }
  | { code: 'INVALID_CATEGORY'; message: string }
  | { code: 'INVALID_HOUSEHOLD'; message: string }
  | { code: 'PATH_OUT_OF_VAULT'; message: string }
  | { code: 'SYMLINK_DENIED' | 'PATH_SYMLINK_REJECTED'; message: string }
  | { code: 'FILENAME_INVALID'; message: string }
  | { code: 'ROOT_KEY_NOT_SUPPORTED'; message: string }
  | { code: 'NAME_TOO_LONG'; message: string };

export function presentFsError(e: unknown) {
  const any = e as Partial<FsUiError> | undefined;
  const rawCode = any?.code ?? 'IO/GENERIC';
  const code = rawCode === 'SYMLINK_DENIED' ? 'PATH_SYMLINK_REJECTED' : rawCode;
  const message =
    code === 'NOT_ALLOWED'
      ? "That location isn't allowed"
      : code === 'INVALID_INPUT'
      ? 'Invalid path'
      : code === 'INVALID_CATEGORY'
      ? 'Attachment category not supported'
      : code === 'INVALID_HOUSEHOLD'
      ? 'Attachment belongs to another household'
      : code === 'PATH_OUT_OF_VAULT'
      ? "That file isn’t inside the app’s attachments folder."
      : code === 'PATH_SYMLINK_REJECTED'
      ? 'Links aren’t allowed. Choose the real file.'
      : code === 'FILENAME_INVALID'
      ? 'That name can’t be used. Try letters, numbers, dashes or underscores.'
      : code === 'ROOT_KEY_NOT_SUPPORTED'
      ? 'This location isn’t allowed for Pets documents.'
      : code === 'NAME_TOO_LONG'
      ? 'That name is too long for the filesystem.'
      : 'File error';
  toast.show({ kind: 'error', message });
  // Optional dev console crumb without paths
  console.debug('[fs-deny]', { code, when: new Date().toISOString() });
}
