import {
  getAmbientMode,
  getRotationMode,
  getStoreValue,
  setStoreValue,
  type RotationMode,
} from "./store";

const rotationEvents = new EventTarget();

const LONDON_TZ = "Europe/London";
const londonDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

export type PeriodMode = RotationMode;

function extractPart(parts: Intl.DateTimeFormatPart[], type: string): number {
  const value = parts.find((part) => part.type === type)?.value ?? "";
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Unable to parse ${type} from London time`);
  }
  return parsed;
}

function londonMidnight(date: Date): Date {
  const parts = londonDateFormatter.formatToParts(date);
  const year = extractPart(parts, "year");
  const month = extractPart(parts, "month");
  const day = extractPart(parts, "day");
  return new Date(Date.UTC(year, month - 1, day));
}

function isoWeekParts(date: Date): { year: number; week: number } {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const year = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year, week };
}

function londonMonthParts(date: Date): { year: number; month: number } {
  const parts = londonDateFormatter.formatToParts(date);
  const year = extractPart(parts, "year");
  const month = extractPart(parts, "month");
  return { year, month };
}

export function formatIsoWeekKey(date: Date): string {
  const midnight = londonMidnight(date);
  const { year, week } = isoWeekParts(midnight);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function formatLondonMonthKey(date: Date): string {
  const { year, month } = londonMonthParts(date);
  return `${year}-M${String(month).padStart(2, "0")}`;
}

export function getPeriodKey(mode: RotationMode, date: Date = new Date()): string {
  switch (mode) {
    case "weekly":
      return formatIsoWeekKey(date);
    case "monthly":
      return formatLondonMonthKey(date);
    case "manual":
      return `manual-${formatIsoWeekKey(date)}`;
    case "off":
    default:
      return "static";
  }
}

export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function randomSeed(): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0]!;
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

let fallbackInstallId: string | null = null;

function generateInstallId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.floor(Math.random() * 1e8)
    .toString(16)
    .padStart(8, "0")}`;
}

export async function getInstallId(): Promise<string> {
  const existing = await getStoreValue("installId");
  if (typeof existing === "string" && existing.length > 0) {
    fallbackInstallId = existing;
    return existing;
  }
  if (fallbackInstallId) return fallbackInstallId;
  const next = generateInstallId();
  fallbackInstallId = next;
  await setStoreValue("installId", next);
  return next;
}

async function persistSeed(seed: number, periodKey: string): Promise<void> {
  await setStoreValue("blobSeed", seed);
  await setStoreValue("blobWeekKey", periodKey);
  await setStoreValue("blobLastGeneratedAt", new Date().toISOString());
}

function emitSeedChange(seed: number): void {
  rotationEvents.dispatchEvent(new CustomEvent<number>("seed", { detail: seed }));
}

export function onBlobSeedChange(listener: (seed: number) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<number>).detail);
  rotationEvents.addEventListener("seed", handler);
  return () => rotationEvents.removeEventListener("seed", handler);
}

export async function getBlobSeedForPeriod(mode: RotationMode): Promise<number> {
  const now = new Date();
  const periodKey = getPeriodKey(mode, now);
  const storedSeed = await getStoreValue("blobSeed");
  const storedKey = await getStoreValue("blobWeekKey");
  if ((mode === "weekly" || mode === "monthly") && periodKey !== storedKey) {
    const installId = await getInstallId();
    const derived = fnv1a32(`${installId}:${periodKey}:arklowdun`);
    await persistSeed(derived, periodKey);
    emitSeedChange(derived);
    return derived;
  }
  if (typeof storedSeed === "number") {
    return storedSeed;
  }
  const installId = await getInstallId();
  const effectiveKey = storedKey ?? periodKey;
  const derived = fnv1a32(`${installId}:${effectiveKey}:arklowdun`);
  await persistSeed(derived, effectiveKey);
  emitSeedChange(derived);
  return derived;
}

export async function forceNewBlobUniverse(): Promise<number> {
  const rotation = await getRotationMode();
  // ensure install id persisted even if rotation is off
  await getInstallId();
  const periodKey = getPeriodKey(rotation, new Date());
  const seed = randomSeed();
  await persistSeed(seed, periodKey);
  emitSeedChange(seed);
  return seed;
}

export async function ensureAmbientSeed(): Promise<number> {
  const mode = await getRotationMode();
  return getBlobSeedForPeriod(mode);
}

export async function ensureAmbientMode(): Promise<{ mode: string; seed: number }> {
  const [ambientMode, rotationMode] = await Promise.all([getAmbientMode(), getRotationMode()]);
  const seed = await getBlobSeedForPeriod(rotationMode);
  return { mode: ambientMode, seed };
}
