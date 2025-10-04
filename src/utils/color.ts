export type ForegroundTone = "black" | "white";

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const MIN_CONTRAST_AA = 4.5;

export function isHexColor(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return HEX_COLOR_REGEX.test(value.trim());
}

function srgbToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const rLin = srgbToLinear(r);
  const gLin = srgbToLinear(g);
  const bLin = srgbToLinear(b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

function contrastRatio(l1: number, l2: number): number {
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ReadableColor {
  foreground: ForegroundTone;
  contrast: number;
}

export function readableOn(hex: string): ReadableColor {
  const luminance = relativeLuminance(hex);
  const contrastWithWhite = contrastRatio(1, luminance);
  const contrastWithBlack = contrastRatio(luminance, 0);
  if (contrastWithBlack >= contrastWithWhite) {
    return { foreground: "black", contrast: contrastWithBlack };
  }
  return { foreground: "white", contrast: contrastWithWhite };
}
