import recoveryData from "./en/recovery.json";

type DotNestedKeys<
  T,
  Prefix extends string = "",
> = T extends string
  ? Prefix
  : T extends Record<string, unknown>
    ? {
        [K in Extract<keyof T, string>]: DotNestedKeys<
          T[K],
          Prefix extends "" ? K : `${Prefix}.${K}`
        >;
      }[Extract<keyof T, string>]
    : never;

export type RecoveryStringKey = Exclude<DotNestedKeys<typeof recoveryData>, "">;

const cache = new Map<RecoveryStringKey, string>();

function resolveKey(key: RecoveryStringKey): string {
  if (cache.has(key)) {
    return cache.get(key)!;
  }

  const parts = key.split(".");
  let current: unknown = recoveryData;

  for (const part of parts) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !(part in current)
    ) {
      throw new Error(`Missing recovery string for key "${key}"`);
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current !== "string") {
    throw new Error(`Recovery string key "${key}" did not resolve to a string.`);
  }

  cache.set(key, current);
  return current;
}

function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (_, name: string) => {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      return String(params[name as keyof typeof params] ?? "");
    }
    return "";
  });
}

export function recoveryText(
  key: RecoveryStringKey,
  params?: Record<string, string | number>,
): string {
  const template = resolveKey(key);
  return format(template, params);
}

export const RECOVERY_STRINGS = recoveryData;
