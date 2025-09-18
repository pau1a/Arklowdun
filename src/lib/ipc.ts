import { toast } from '@ui/Toast';

export type FsUiError =
  | { code: 'NOT_ALLOWED'; message: string }
  | { code: 'INVALID_INPUT'; message: string }
  | { code: 'IO/GENERIC'; message: string };

export function presentFsError(e: unknown) {
  const any = e as Partial<FsUiError> | undefined;
  const code = any?.code ?? 'IO/GENERIC';
  const title =
    code === 'NOT_ALLOWED'
      ? "That location isn't allowed"
      : code === 'INVALID_INPUT'
      ? 'Invalid path'
      : 'File error';
  toast.show({ kind: 'error', message: title });
  // Optional dev console crumb without paths
  console.debug('[fs-deny]', { code, when: new Date().toISOString() });
}
