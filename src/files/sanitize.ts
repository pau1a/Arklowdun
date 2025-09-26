export function sanitizeRelativePath(p: string): string {
  let norm = p.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts: string[] = [];
  for (const raw of norm.split("/")) {
    const seg = raw.trim();
    if (!seg || seg === ".") continue;
    if (parts.length === 0 && /^[A-Za-z]:$/.test(seg)) continue;
    if (seg === "..") {
      if (parts.length) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}
