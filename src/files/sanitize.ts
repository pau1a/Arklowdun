const RESERVED_WINDOWS_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export type PathValidationErrorCode =
  | "EMPTY"
  | "PATH_OUT_OF_VAULT"
  | "FILENAME_INVALID"
  | "NAME_TOO_LONG";

export class PathValidationError extends Error {
  readonly code: PathValidationErrorCode;

  constructor(code: PathValidationErrorCode, message: string) {
    super(message);
    this.name = "PathValidationError";
    this.code = code;
  }
}

const MAX_COMPONENT_BYTES = 255;
const MAX_PATH_BYTES = 32 * 1024;

const FORBIDDEN_CHARACTERS = /[<>:"\\|?*]/;

const textEncoder = new TextEncoder();

function assertComponent(segment: string): string {
  const trimmed = segment.trim();
  if (trimmed.length === 0) {
    throw new PathValidationError(
      "FILENAME_INVALID",
      "Attachment path segments cannot be empty.",
    );
  }

  if (trimmed === "." || trimmed === "..") {
    throw new PathValidationError(
      "PATH_OUT_OF_VAULT",
      "Attachment paths may not include traversal segments.",
    );
  }

  if (FORBIDDEN_CHARACTERS.test(trimmed) || /[\u0000-\u001f]/.test(trimmed)) {
    throw new PathValidationError(
      "FILENAME_INVALID",
      "Attachment names contain unsupported characters.",
    );
  }

  if (trimmed.trimEnd().length !== trimmed.length) {
    throw new PathValidationError(
      "FILENAME_INVALID",
      "Attachment names may not end with spaces.",
    );
  }

  const upper = trimmed.toUpperCase();
  if (RESERVED_WINDOWS_NAMES.has(upper)) {
    throw new PathValidationError(
      "FILENAME_INVALID",
      "Attachment names may not use reserved Windows names.",
    );
  }

  const byteLength = textEncoder.encode(trimmed).length;
  if (byteLength > MAX_COMPONENT_BYTES) {
    throw new PathValidationError(
      "NAME_TOO_LONG",
      "Attachment name is too long.",
    );
  }

  return trimmed;
}

export function sanitizeRelativePath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new PathValidationError("EMPTY", "Attachment path is required.");
  }

  const normalized = trimmed.normalize("NFC").replace(/\\/g, "/");
  let candidate = normalized.replace(/^\/+/, "");

  if (/^[A-Za-z]:/.test(candidate)) {
    throw new PathValidationError(
      "PATH_OUT_OF_VAULT",
      "Absolute drives are not allowed.",
    );
  }

  const segments = candidate.split("/");
  if (segments.length === 0) {
    throw new PathValidationError(
      "FILENAME_INVALID",
      "Attachment path segments cannot be empty.",
    );
  }

  const validated: string[] = [];
  let totalBytes = 0;
  for (const segment of segments) {
    const clean = assertComponent(segment);
    totalBytes += textEncoder.encode(clean).length;
    if (totalBytes > MAX_PATH_BYTES) {
      throw new PathValidationError(
        "NAME_TOO_LONG",
        "Attachment path is too long.",
      );
    }
    validated.push(clean);
  }

  if (validated.length === 0) {
    throw new PathValidationError(
      "FILENAME_INVALID",
      "Attachment path segments cannot be empty.",
    );
  }

  candidate = validated.join("/");
  if (candidate.length === 0) {
    throw new PathValidationError(
      "FILENAME_INVALID",
      "Attachment path segments cannot be empty.",
    );
  }

  return candidate;
}
