import settingsData from "./en/settings.json" with { type: "json" };

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

export type SettingsStringKey = Exclude<DotNestedKeys<typeof settingsData>, "">;

type SettingsParams = Record<string, string | number>;

const cache = new Map<SettingsStringKey, string>();

function resolveKey(key: SettingsStringKey): string {
  if (cache.has(key)) {
    return cache.get(key)!;
  }

  const parts = key.split(".");
  let current: unknown = settingsData;

  for (const part of parts) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !(part in current)
    ) {
      throw new Error(`Missing settings string for key "${key}"`);
    }
    // eslint-disable-next-line security/detect-object-injection -- keys are validated via SettingsStringKey
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current !== "string") {
    throw new Error(`Settings string key "${key}" did not resolve to a string.`);
  }

  cache.set(key, current);
  return current;
}

function format(template: string, params?: SettingsParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (_, name: string) => {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      return String(params[name as keyof typeof params] ?? "");
    }
    return "";
  });
}

export function settingsText(
  key: SettingsStringKey,
  params?: SettingsParams,
): string {
  const template = resolveKey(key);
  return format(template, params);
}

export const SETTINGS_STRINGS = settingsData;
