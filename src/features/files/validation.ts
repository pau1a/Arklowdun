const RESERVED_WINDOWS_NAMES = new Set(
  [
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'COM5',
    'COM6',
    'COM7',
    'COM8',
    'COM9',
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'LPT5',
    'LPT6',
    'LPT7',
    'LPT8',
    'LPT9',
  ].map((name) => name.toLowerCase()),
);

const FORBIDDEN_CHARS = new Set('<>:"/\\|?*'.split(''));

const MAX_COMPONENT_BYTES = 255;
const MAX_PATH_BYTES = 4096;

export type FilenameValidationErrorCode =
  | 'empty'
  | 'relative-segment'
  | 'reserved-name'
  | 'trailing-dot-or-space'
  | 'forbidden-character'
  | 'component-too-long'
  | 'path-too-long';

export interface FilenameValidationError {
  code: FilenameValidationErrorCode;
  message: string;
}

export type FilenameValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; error: FilenameValidationError };

export interface FilenameValidationOptions {
  parent?: string | null;
}

const textEncoder = new TextEncoder();

function hasForbiddenCharacters(value: string): boolean {
  for (const char of value) {
    if (FORBIDDEN_CHARS.has(char) || /[\u0000-\u001f]/.test(char)) {
      return true;
    }
  }
  return false;
}

function isReservedName(value: string): boolean {
  const [stem = value] = value.split('.', 1);
  return RESERVED_WINDOWS_NAMES.has(stem.toLowerCase());
}

function hasTrailingDotOrSpace(value: string): boolean {
  return value.length !== value.replace(/[.\s]+$/u, '').length;
}

function includesRelativeSegment(value: string): boolean {
  return value === '.' || value === '..';
}

function computePathBytes(parent: string | null | undefined, segment: string): number {
  const parts: string[] = [];
  if (parent && parent !== '.') {
    parts.push(...parent.replace(/\\/g, '/').split('/').filter(Boolean));
  }
  parts.push(segment);
  let total = 0;
  for (const part of parts) {
    total += textEncoder.encode(part).length;
  }
  return total;
}

export function validateFilename(
  raw: string,
  options: FilenameValidationOptions = {},
): FilenameValidationResult {
  const value = raw.normalize('NFC');
  if (!value) {
    return {
      ok: false,
      error: { code: 'empty', message: 'Enter a name before continuing.' },
    };
  }

  if (includesRelativeSegment(value)) {
    return {
      ok: false,
      error: {
        code: 'relative-segment',
        message: 'Names cannot be "." or "..".',
      },
    };
  }

  if (isReservedName(value)) {
    return {
      ok: false,
      error: {
        code: 'reserved-name',
        message: 'This name is reserved on Windows. Choose another.',
      },
    };
  }

  if (hasTrailingDotOrSpace(value)) {
    return {
      ok: false,
      error: {
        code: 'trailing-dot-or-space',
        message: 'Names cannot end with spaces or dots.',
      },
    };
  }

  if (hasForbiddenCharacters(value)) {
    return {
      ok: false,
      error: {
        code: 'forbidden-character',
        message: 'Names cannot contain control characters or < > : " / \\ | ? *.',
      },
    };
  }

  if (textEncoder.encode(value).length > MAX_COMPONENT_BYTES) {
    return {
      ok: false,
      error: {
        code: 'component-too-long',
        message: 'Each name must be 255 bytes or fewer.',
      },
    };
  }

  if (computePathBytes(options.parent ?? null, value) > MAX_PATH_BYTES) {
    return {
      ok: false,
      error: {
        code: 'path-too-long',
        message: 'This path is too long for the vault.',
      },
    };
  }

  return { ok: true, normalized: value };
}

