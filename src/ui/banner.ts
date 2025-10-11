const imports = import.meta.glob("/src/assets/banners/*/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

type BannerVariant = {
  default?: string;
  light?: string;
  dark?: string;
  [variant: string]: string | undefined;
};

function parseBannerPath(path: string): { key: string; variant: string } | null {
  const match = path.match(/\/banners\/([^/]+)\/([^/]+)\.png$/);
  if (!match) return null;
  const [, key, file] = match;
  if (file === key) return { key, variant: "default" };
  if (file === `${key}-light` || file === "light") return { key, variant: "light" };
  if (file === `${key}-dark` || file === "dark") return { key, variant: "dark" };
  return { key, variant: file };
}

const BANNERS: Record<string, BannerVariant> = {};
for (const [path, url] of Object.entries(imports)) {
  const parsed = parseBannerPath(path);
  if (!parsed) continue;
  const entry = (BANNERS[parsed.key] ??= {});
  if (parsed.variant === "default") {
    entry.default = url;
    if (!entry.light) entry.light = url;
  } else {
    entry[parsed.variant] = url;
    if (!entry.default) entry.default = url;
  }
}

export function bannerFor(pageKey: string, theme?: "light" | "dark"): string | undefined {
  const entry = BANNERS[pageKey];
  if (!entry) return undefined;
  if (theme === "dark") {
    return entry.dark ?? entry.default ?? entry.light;
  }
  if (theme === "light") {
    return entry.light ?? entry.default ?? entry.dark;
  }
  return entry.default ?? entry.light ?? entry.dark;
}
