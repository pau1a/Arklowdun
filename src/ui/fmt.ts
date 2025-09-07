export function fmt(ms?: number | null): string {
  return typeof ms === "number" && ms > 0
    ? new Date(ms).toLocaleDateString()
    : "—";
}

