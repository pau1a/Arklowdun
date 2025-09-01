export function nowMs(): number {
  return Date.now();
}

export function toDate(ms: number): Date {
  return new Date(ms);
}
