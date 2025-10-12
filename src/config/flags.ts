const envRecord =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

function readBoolean(key: string, fallback: boolean): boolean {
  const value = envRecord[key];
  if (typeof value === "string") {
    if (value === "1" || value.toLowerCase() === "true") return true;
    if (value === "0" || value.toLowerCase() === "false") return false;
  }
  return fallback;
}

export const ENABLE_FAMILY_EXPANSION = readBoolean("VITE_ENABLE_FAMILY_EXPANSION", true);
export const ENABLE_FAMILY_RENEWALS = true;
// Modal is now part of the base Family expansion; keep the export for compatibility.
export const ENABLE_FAMILY_ADD_MEMBER_MODAL = true;

const devFallback =
  typeof import.meta !== "undefined" &&
  Boolean((import.meta as unknown as { env?: Record<string, unknown> }).env?.DEV);

export const ENABLE_PETS_HARD_DELETE = readBoolean("VITE_ENABLE_PETS_HARD_DELETE", devFallback);
