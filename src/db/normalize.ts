export function toMs(v: number | string | null | undefined): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : undefined;
}
