const imports = import.meta.glob("/src/assets/banners/*/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function keyFrom(path: string): string | null {
  const match = path.match(/\/banners\/([^/]+)\/\1\.png$/);
  return match ? match[1] : null;
}

const BANNERS: Record<string, string> = {};
for (const [path, url] of Object.entries(imports)) {
  const key = keyFrom(path);
  if (key) {
    BANNERS[key] = url;
  }
}

export function bannerFor(pageKey: string): string | undefined {
  return BANNERS[pageKey];
}
