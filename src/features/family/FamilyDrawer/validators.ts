export function isValidEmail(value: string): boolean {
  if (!value) return false;
  const normalized = value.trim();
  if (normalized.length === 0) return false;
  const emailPattern =
    /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\u0001-\u0008\u000b\u000c\u000e-\u001f!#-[^-~]|\\[\u0001-\u0009\u000b\u000c\u000e-\u007f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\u0001-\u0008\u000b\u000c\u000e-\u001f!#-[^-~]|\\[\u0001-\u0009\u000b\u000c\u000e-\u007f])+))$/i;
  return emailPattern.test(normalized);
}

export function isValidPhone(value: string): boolean {
  if (!value) return false;
  const normalized = value.replace(/\s+/g, "");
  if (normalized.length === 0) return false;
  const localPattern = /^(?:\+?[0-9]{7,15}|0[0-9]{9,14})$/;
  return localPattern.test(normalized);
}

export function isValidUrl(value: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function canParseJson(value: string): boolean {
  if (!value) return true;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

export function parseJsonOrNull<T = unknown>(value: string): T | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error("Invalid JSON");
  }
}

export function stringifyJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return trimmed;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function collectNumericFieldErrors(data: unknown): string[] {
  const errors: string[] = [];

  const checkValue = (key: string, value: unknown) => {
    if (typeof value !== "string") return;
    const normalized = value.replace(/[\s-]+/g, "");
    if (normalized.length === 0 || /\D/.test(normalized)) {
      errors.push(`${key} must contain digits only.`);
    }
  };

  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const lower = key.toLowerCase();
        if (lower === "accountnumber" || lower === "account_number") {
          checkValue("Account number", value);
        }
        if (lower === "sortcode" || lower === "sort_code") {
          checkValue("Sort code", value);
        }
        walk(value);
      }
    }
  };

  walk(data);
  return Array.from(new Set(errors));
}
