import { log } from "@utils/logger";

export type BlobTone = "teal" | "aqua" | "coral" | "teal2" | "shade";

interface ToneDefinition {
  colorVar: string;
  alphaVar: string;
}

const TONES: Record<BlobTone, ToneDefinition> = {
  teal: { colorVar: "--blob-main", alphaVar: "--blob-alpha-main" },
  teal2: { colorVar: "--blob-tint", alphaVar: "--blob-alpha-tint" },
  shade: { colorVar: "--blob-shade", alphaVar: "--blob-alpha-shade" },
  aqua: { colorVar: "--blob-aqua", alphaVar: "--blob-alpha-aqua" },
  coral: { colorVar: "--blob-coral", alphaVar: "--blob-alpha-coral" },
};

export interface BlobState {
  tone: BlobTone;
  color: string;
  sprite: HTMLCanvasElement;
  alpha: number;
  shapeSeed: number;
  shapeSpeed: number;
  morphPhase: number;
  radiusFactor: number;
  freqX: number;
  freqY: number;
  freqX2: number;
  freqY2: number;
  amplitudeX: number;
  amplitudeY: number;
  altAmplitudeX: number;
  altAmplitudeY: number;
  phaseX: number;
  phaseY: number;
  phaseX2: number;
  phaseY2: number;
  offsetX: number;
  offsetY: number;
  timeOffset: number;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readCssVar(name: string, fallback = ""): string {
  if (typeof window === "undefined") return fallback;
  const style = getComputedStyle(document.documentElement);
  const value = style.getPropertyValue(name).trim();
  return value || fallback;
}

function parseAlpha(name: string): number {
  const raw = readCssVar(name);
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) return 0.05;
  return Math.max(0, Math.min(1, parsed));
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.trim().replace(/^#/, "");
  if (value.length === 3) {
    const r = value[0] ?? "0";
    const g = value[1] ?? "0";
    const b = value[2] ?? "0";
    return [Number.parseInt(r + r, 16), Number.parseInt(g + g, 16), Number.parseInt(b + b, 16)];
  }
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return [Number.isNaN(r) ? 0 : r, Number.isNaN(g) ? 0 : g, Number.isNaN(b) ? 0 : b];
}

function parseRgbTuple(color: string): [number, number, number] {
  const match = color.trim().match(/rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/i);
  if (!match) return [0, 200, 150];
  const r = Math.max(0, Math.min(255, Number.parseInt(match[1] ?? "0", 10)));
  const g = Math.max(0, Math.min(255, Number.parseInt(match[2] ?? "0", 10)));
  const b = Math.max(0, Math.min(255, Number.parseInt(match[3] ?? "0", 10)));
  return [r, g, b];
}

function toRgb(color: string): [number, number, number] {
  if (color.trim().startsWith("#")) {
    return hexToRgb(color);
  }
  return parseRgbTuple(color);
}

const spriteCache = new Map<string, HTMLCanvasElement>();
const SHAPE_BUCKETS = 240; // higher bucket count for smoother morphing

function quantizeAlpha(alpha: number, step = 0.02): number {
  const quantized = Math.round(alpha / step) * step;
  return Math.max(0, Math.min(1, quantized));
}

// Draw an irregular, haikei-style blob directly to the target context.
function drawIrregularBlob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  alpha: number,
  shapeSeed: number,
  phase: number,
): void {
  const [r0, g0, b0] = toRgb(color);
  // Lighten color towards white by a configurable factor (default 0.5)
  const lighten = Math.max(0, Math.min(1, parseAlpha("--blob-lighten") || 0.5));
  const r = Math.round(r0 + (255 - r0) * lighten);
  const g = Math.round(g0 + (255 - g0) * lighten);
  const b = Math.round(b0 + (255 - b0) * lighten);
  const edgeHard = Math.max(0, Math.min(1, parseAlpha("--blob-edge-hardness") || 0.95));
  const innerScale = 0.72 + 0.15 * edgeHard;
  const midScale = innerScale + (1 - innerScale) * 0.45;
  const outerScale = 1.0;
  const twoPi = Math.PI * 2;
  const points = 160; // higher resolution outline to avoid aliasing/jitter
  const rng = mulberry32(((shapeSeed * 1_000_003) ^ 0x9e3779b9) >>> 0);
  const f1 = 1 + Math.floor(rng() * 3);
  const f2 = 2 + Math.floor(rng() * 4);
  const f3 = 3 + Math.floor(rng() * 5);
  const p1 = rng() * twoPi;
  const p2 = rng() * twoPi;
  const p3 = rng() * twoPi;
  const morph = (phase % 1) * twoPi;
  const a1 = 0.18 + rng() * 0.08;
  const a2 = 0.10 + rng() * 0.06;
  const a3 = 0.06 + rng() * 0.04;

  const build = (scale: number) => {
    ctx.beginPath();
    for (let i = 0; i <= points; i += 1) {
      const t = (i % points) / points;
      const ang = t * twoPi;
      const noise = (a1 * (0.85 + 0.15 * Math.sin(morph))) * Math.sin(f1 * ang + p1 + morph * 0.6)
        + (a2 * (0.85 + 0.15 * Math.cos(morph * 1.2))) * Math.sin(f2 * ang + p2 + morph * 1.1)
        + (a3 * (0.85 + 0.15 * Math.sin(morph * 0.8))) * Math.sin(f3 * ang + p3 - morph * 0.9);
      const rad = Math.max(1, radius * scale * (1 + noise));
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  build(innerScale);
  ctx.fill();

  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.45})`;
  build(midScale);
  ctx.fill();

  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.18})`;
  build(outerScale);
  ctx.fill();
}

// Compute per-angle radii for a phase (used for temporal smoothing)
function computeRadii(
  baseRadius: number,
  shapeSeed: number,
  phase: number,
  points: number,
): Float32Array {
  const twoPi = Math.PI * 2;
  const rng = mulberry32(((shapeSeed * 1_000_003) ^ 0x9e3779b9) >>> 0);
  const f1 = 1 + Math.floor(rng() * 3);
  const f2 = 2 + Math.floor(rng() * 4);
  const f3 = 3 + Math.floor(rng() * 5);
  const p1 = rng() * twoPi;
  const p2 = rng() * twoPi;
  const p3 = rng() * twoPi;
  const morph = (phase % 1) * twoPi;
  const a1 = 0.18 + rng() * 0.08;
  const a2 = 0.10 + rng() * 0.06;
  const a3 = 0.06 + rng() * 0.04;
  const out = new Float32Array(points);
  for (let i = 0; i < points; i += 1) {
    const t = i / points;
    const ang = t * twoPi;
    const noise = (a1 * (0.85 + 0.15 * Math.sin(morph))) * Math.sin(f1 * ang + p1 + morph * 0.6)
      + (a2 * (0.85 + 0.15 * Math.cos(morph * 1.2))) * Math.sin(f2 * ang + p2 + morph * 1.1)
      + (a3 * (0.85 + 0.15 * Math.sin(morph * 0.8))) * Math.sin(f3 * ang + p3 - morph * 0.9);
    out[i] = Math.max(1, baseRadius * (1 + noise));
  }
  return out;
}

// Fill a blob from a precomputed radii array (three feathered layers)
function fillFromRadii(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radii: Float32Array,
  color: string,
  alpha: number,
): void {
  const [r0, g0, b0] = toRgb(color);
  const lighten = Math.max(0, Math.min(1, parseAlpha("--blob-lighten") || 0.5));
  const r = Math.round(r0 + (255 - r0) * lighten);
  const g = Math.round(g0 + (255 - g0) * lighten);
  const b = Math.round(b0 + (255 - b0) * lighten);
  const edgeHard = Math.max(0, Math.min(1, parseAlpha("--blob-edge-hardness") || 0.95));
  const innerScale = 0.72 + 0.15 * edgeHard;
  const twoPi = Math.PI * 2;
  const points = radii.length;

  // Crisp, non-glowing edge: fill only the inner body and skip any outer rings
  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const idx = i % points;
    const ang = (idx / points) * twoPi;
    const rad = Math.max(1, radii[idx] * innerScale);
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  ctx.fill();
}

function pathFromRadii(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radii: Float32Array,
  scale: number,
): void {
  const twoPi = Math.PI * 2;
  const points = radii.length;
  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const idx = i % points;
    const ang = (idx / points) * twoPi;
    const rad = Math.max(1, radii[idx] * scale);
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function makeSprite(
  tone: BlobTone,
  color: string,
  alpha: number,
  size = 512,
  shapeSeed = 0.5,
  shapePhase = 0,
): HTMLCanvasElement {
  const qa = quantizeAlpha(alpha);
  // Quantize size to reduce cache churn
  const qSize = Math.max(128, Math.min(2048, Math.ceil(size / 64) * 64));
  const shapeKey = Math.round(shapeSeed * 1000); // quantize shape
  const phaseBucket = Math.round(shapePhase * SHAPE_BUCKETS);
  const key = `${tone}:${color}:${qa.toFixed(2)}:${qSize}:s${shapeKey}:p${phaseBucket}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = qSize;
  canvas.height = qSize;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, qSize, qSize);
    const [r, g, b] = toRgb(color);
    const centerX = qSize / 2;
    const centerY = qSize / 2;
    // Leave generous padding so shapes never touch canvas edges
    const baseR = qSize * 0.40;
    const edgeHard = Math.max(0, Math.min(1, parseAlpha("--blob-edge-hardness") || 0.95));

    // Build irregular outline using band-limited noise from summed sines
    const srng = mulberry32((shapeKey ^ 0x9e3779b9) >>> 0);
    const points = 80;
    const twoPi = Math.PI * 2;
    const f1 = 1 + Math.floor(srng() * 3); // 1..3
    const f2 = 2 + Math.floor(srng() * 4); // 2..5
    const f3 = 3 + Math.floor(srng() * 5); // 3..7
    const p1 = srng() * twoPi;
    const p2 = srng() * twoPi;
    const p3 = srng() * twoPi;
    // Morph the outline by slowly modulating phases/amplitudes over time
    const morph = shapePhase * twoPi;
    const a1 = 0.18 + srng() * 0.08;
    const a2 = 0.10 + srng() * 0.06;
    const a3 = 0.06 + srng() * 0.04;

    const buildPath = (scale: number) => {
      ctx.beginPath();
      for (let i = 0; i <= points; i += 1) {
        const t = (i % points) / points;
        const ang = t * twoPi;
        const noise = (a1 * (0.85 + 0.15 * Math.sin(morph))) * Math.sin(f1 * ang + p1 + morph * 0.6)
          + (a2 * (0.85 + 0.15 * Math.cos(morph * 1.2))) * Math.sin(f2 * ang + p2 + morph * 1.1)
          + (a3 * (0.85 + 0.15 * Math.sin(morph * 0.8))) * Math.sin(f3 * ang + p3 - morph * 0.9);
        // Clamp radius so outline never hits the canvas edge
        const maxR = qSize * 0.46;
        const radius = Math.min(baseR * scale * (1 + noise), maxR);
        const x = centerX + Math.cos(ang) * radius;
        const y = centerY + Math.sin(ang) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    // Layered fills to create a feathered edge on irregular shapes
    const innerScale = 0.72 + 0.15 * edgeHard; // ~0.86 at 0.95
    const midScale = innerScale + (1 - innerScale) * 0.45;
    const outerScale = 1.0;

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${qa})`;
    buildPath(innerScale);
    ctx.fill();

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${qa * 0.45})`;
    buildPath(midScale);
    ctx.fill();

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${qa * 0.18})`;
    buildPath(outerScale);
    ctx.fill();

    // Safety fade near the outermost 4% to guarantee no hard edges
    const mask = ctx.createRadialGradient(centerX, centerY, qSize * 0.30, centerX, centerY, qSize * 0.50);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = mask as unknown as string;
    ctx.fillRect(0, 0, qSize, qSize);
    ctx.globalCompositeOperation = 'source-over';
  }
  spriteCache.set(key, canvas);
  return canvas;
}

export interface AmbientRendererOptions {
  seed: number;
  activeFps?: number;
  idleFps?: number;
  idleMs?: number;
  renderScale?: number;
  edgeBias?: number;
  zIndex?: number;
  paused?: boolean;
}

const INTERACTION_EVENTS: (keyof WindowEventMap)[] = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
];

export abstract class AmbientBlobCanvas {
  readonly element: HTMLCanvasElement;
  protected seed: number;
  protected blobs: BlobState[] = [];
  protected readonly host: HTMLElement;
  protected readonly ctx: CanvasRenderingContext2D | null;
  protected readonly renderScale: number;
  protected readonly activeFps: number;
  protected readonly idleFps: number;
  protected readonly idleMs: number;
  protected readonly edgeBias: number;
  private readonly resizeObserver: ResizeObserver | null;
  private frameHandle: number | null = null;
  private readonly motionQuery: MediaQueryList | null = null;
  private readonly onMotionChangeBound: ((event: MediaQueryListEvent) => void) | null = null;
  private readonly onVisibilityChangeBound: () => void;
  private readonly onInteractionBound: () => void;
  private readonly onWindowResizeBound: (() => void) | null = null;
  private pausedManually: boolean;
  private reduceMotion = false;
  private isHidden = false;
  private reducedSince: number | null = null;
  private hiddenSince: number | null = null;
  private lastInteraction = performance.now();
  private lastRender = 0;
  private hasFrame = false;
  private startTime = performance.now();
  private readonly autoStart: boolean;
  private cssWidth = 0;
  private cssHeight = 0;

  constructor(host: HTMLElement, options: AmbientRendererOptions) {
    this.host = host;
    this.seed = options.seed >>> 0;
    this.renderScale = Math.min(1, Math.max(0.1, options.renderScale ?? 0.75));
    this.activeFps = Math.max(0, options.activeFps ?? 20);
    this.idleFps = Math.max(0, options.idleFps ?? 8);
    this.idleMs = Math.max(1000, options.idleMs ?? 10000);
    this.edgeBias = Math.max(0, Math.min(1, options.edgeBias ?? 0.75));

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    if (typeof options.zIndex === "number") {
      canvas.style.zIndex = String(options.zIndex);
    }
    this.element = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
    if (this.ctx) {
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = "high";
    }
    host.appendChild(canvas);

    // Canvas background remains transparent in production

    this.resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => this.handleResize())
      : null;
    this.resizeObserver?.observe(host);
    if (!this.resizeObserver) {
      this.onWindowResizeBound = () => this.handleResize();
      window.addEventListener("resize", this.onWindowResizeBound, { passive: true });
    }
    this.handleResize();

    this.motionQuery = typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    if (this.motionQuery) {
      this.reduceMotion = this.motionQuery.matches;
      const handler = (event: MediaQueryListEvent) => {
        this.reduceMotion = event.matches;
        if (this.reduceMotion) {
          // Start grace period; don't stop immediately
          this.reducedSince = performance.now();
          this.renderOnce();
        } else {
          this.reducedSince = null;
          if (!this.pausedManually && !this.isHidden) {
            this.start();
          }
        }
      };
      this.onMotionChangeBound = handler;
      if (typeof this.motionQuery.addEventListener === "function") {
        this.motionQuery.addEventListener("change", handler);
      } else if (typeof this.motionQuery.addListener === "function") {
        this.motionQuery.addListener(handler);
      }
    }

    this.onVisibilityChangeBound = () => {
      this.isHidden = document.hidden;
      if (this.isHidden) {
        // Start grace period; don't stop immediately
        this.hiddenSince = performance.now();
      } else {
        this.hiddenSince = null;
        if (!this.pausedManually && !this.reduceMotion) {
          this.start();
        }
      }
    };
    document.addEventListener("visibilitychange", this.onVisibilityChangeBound);

    this.onInteractionBound = () => {
      this.lastInteraction = performance.now();
    };
    INTERACTION_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, this.onInteractionBound, { passive: true });
    });

    this.autoStart = !options.paused;
    this.pausedManually = !!options.paused;
    this.isHidden = document.hidden;
  }

  protected abstract buildBlobs(rng: () => number): BlobState[];

  protected initialisePlayback(): void {
    if (this.autoStart && !this.reduceMotion && !this.isHidden) {
      this.start();
    } else {
      this.renderOnce();
    }
  }

  protected refresh(): void {
    const rng = mulberry32(this.seed || 1);
    const blobs = this.buildBlobs(rng);
    this.blobs = [...blobs].sort((a, b) => a.alpha - b.alpha);
    this.renderOnce();
  }

  protected createBlob(tone: BlobTone, rng: () => number, emphasis = 1): BlobState {
    const def = TONES[tone] ?? TONES.teal;
    const color = readCssVar(def.colorVar, "#00C896");
    const baseAlpha = parseAlpha(def.alphaVar);
    // Narrow opacity range: keep min (0.8x) but lower max to 1.0x (was 1.2x)
    const alpha = Math.max(0, Math.min(1, baseAlpha * (0.8 + rng() * 0.2) * emphasis));
    // Start with a reasonably large sprite; upscale avoided below
    const shapeSeed = rng();
    // Narrow morph-speed range and lower the maximum; keep the minimum
    const shapeSpeed = 0.03 + rng() * 0.015; // was 0.03..0.06, now 0.03..0.045
    const sprite = makeSprite(tone, color, alpha, 512, shapeSeed, 0);

    // Make blobs larger overall (~24%–48% of min viewport side)
    const radiusFactor = 0.24 + rng() * 0.24;
    // Slow down motion by another half (~25% of original)
    const speed = 0.25;
    // Narrow travel-speed range and lower the maximum; keep the minimum
    // Denominator controls speed: higher denominator => slower.
    // Old: 20..40  => faster range. New: 32..40  => slower, narrower range.
    let freqX = (Math.PI * 2) / (32 + rng() * 8);
    let freqY = (Math.PI * 2) / (32 + rng() * 8);
    freqX *= speed;
    freqY *= speed;
    // Secondary modulation range narrowed to reduce fast outliers (min held)
    const freqX2 = freqX * (0.2 + rng() * 0.6);
    const freqY2 = freqY * (0.2 + rng() * 0.6);
    // Wider amplitude variation for more organic paths
    const amplitudeX = 0.20 + rng() * 0.28;
    const amplitudeY = 0.16 + rng() * 0.26;
    const altAmplitudeX = amplitudeX * (0.25 + rng() * 0.6);
    const altAmplitudeY = amplitudeY * (0.25 + rng() * 0.6);
    const offsetX = (rng() - 0.5) * 0.6 * this.edgeBias;
    const offsetY = (rng() - 0.5) * 0.6 * this.edgeBias;
    const phaseX = rng() * Math.PI * 2;
    const phaseY = rng() * Math.PI * 2;
    const phaseX2 = rng() * Math.PI * 2;
    const phaseY2 = rng() * Math.PI * 2;
    const timeOffset = rng() * 120;

    return {
      tone,
      color,
      shapeSeed,
      sprite,
      alpha,
      shapeSpeed,
      morphPhase: rng(),
      radiusFactor,
      freqX,
      freqY,
      freqX2,
      freqY2,
      amplitudeX,
      amplitudeY,
      altAmplitudeX,
      altAmplitudeY,
      phaseX,
      phaseY,
      phaseX2,
      phaseY2,
      offsetX,
      offsetY,
      timeOffset,
    };
  }

  private handleResize(): void {
    // Prefer client sizes, but fixed/absolute hosts can sometimes report 0.
    let width = this.host.clientWidth;
    let height = this.host.clientHeight;
    if (width === 0 || height === 0) {
      const rect = this.host.getBoundingClientRect();
      width = Math.max(width, Math.floor(rect.width));
      height = Math.max(height, Math.floor(rect.height));
    }
    if ((width === 0 || height === 0) && typeof window !== "undefined") {
      width = Math.max(width, window.innerWidth || 0);
      height = Math.max(height, window.innerHeight || 0);
    }
    this.cssWidth = width;
    this.cssHeight = height;
    if (width === 0 || height === 0) return;
    // Respect device pixel ratio up to 2x for crisper rendering without overkill
    // Use device pixel ratio up to 2x for crispness
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 3) : 1;
    const scaledWidth = Math.max(1, Math.floor(width * dpr * this.renderScale));
    const scaledHeight = Math.max(1, Math.floor(height * dpr * this.renderScale));
    if (this.element.width !== scaledWidth || this.element.height !== scaledHeight) {
      this.element.width = scaledWidth;
      this.element.height = scaledHeight;
    }
    if (this.ctx) {
      this.ctx.setTransform(this.element.width / width, 0, 0, this.element.height / height, 0, 0);
    }
    this.renderOnce();
  }

  private loop = (timestamp: number) => {
    this.frameHandle = null;
    if (this.pausedManually || this.reduceMotion || this.isHidden) {
      return;
    }
    if (!this.hasFrame) {
      this.startTime = timestamp;
      this.hasFrame = true;
    }
    const fps = this.computeFps(timestamp);
    if (fps > 0) {
      const interval = 1000 / fps;
      if (timestamp - this.lastRender >= interval) {
        this.lastRender = timestamp;
        this.renderFrame(timestamp);
      }
    }
    this.schedule();
  };

  private schedule(): void {
    if (this.frameHandle !== null) return;
    this.frameHandle = requestAnimationFrame(this.loop);
  }

  private computeFps(now: number): number {
    const GRACE_MS = 3600 * 1000; // 1 hour
    if (this.pausedManually) return 0;
    // After grace, honor reduced-motion/hidden by stopping
    if (this.reduceMotion && this.reducedSince && (now - this.reducedSince) > GRACE_MS) {
      return 0;
    }
    if (this.isHidden && this.hiddenSince && (now - this.hiddenSince) > GRACE_MS) {
      return 0;
    }
    if (this.activeFps <= 0) return 0;
    if (now - this.lastInteraction > this.idleMs) {
      return this.idleFps;
    }
    return this.activeFps;
  }

  private renderFrame(now: number): void {
    if (!this.ctx) return;
    const width = this.cssWidth;
    const height = this.cssHeight;
    if (width === 0 || height === 0) return;
    this.ctx.clearRect(0, 0, width, height);
    const elapsed = (now - this.startTime) / 1000;
    // Limit dt so morph never jumps on frame hitches
    const dt = Math.min(1 / 60, Math.max(0, (now - (this as any)._lastMorphUpdate || 0) / 1000)) || 1 / 60;
    (this as any)._lastMorphUpdate = now;
    const minSize = Math.min(width, height);
    const alphaMult = Math.max(0, Math.min(1, parseAlpha("--blob-alpha-mult") || 1));
    // Draw without image smoothing to avoid extra blur when scaling
    this.ctx.imageSmoothingEnabled = false;
    for (const blob of this.blobs) {
      const t = elapsed + blob.timeOffset;
      const crossX = 0.035 * Math.sin(blob.freqY * t * 0.5 + blob.phaseY2);
      const crossY = 0.035 * Math.cos(blob.freqX * t * 0.5 + blob.phaseX2);
      const x = width * (0.5 + blob.offsetX + crossX + blob.amplitudeX * Math.sin(blob.freqX * t + blob.phaseX)
        + blob.altAmplitudeX * Math.sin(blob.freqX2 * t + blob.phaseX2));
      const y = height * (0.5 + blob.offsetY + crossY + blob.amplitudeY * Math.cos(blob.freqY * t + blob.phaseY)
        + blob.altAmplitudeY * Math.cos(blob.freqY2 * t + blob.phaseY2));
      const radius = minSize * blob.radiusFactor;
      // Advance morph phase using elapsed time for continuity across FPS changes
      blob.morphPhase = (blob.morphPhase + blob.shapeSpeed * dt) % 1;
      // Temporal smoothing of shape radii to eliminate any perceptible snap
      const POINTS = 180;
      const newR = computeRadii(radius, blob.shapeSeed, blob.morphPhase, POINTS);
      const k = Math.min(1, (dt || 0.016) / 0.12); // ~120ms smoothing window
      const prev = (blob as any).prevR as Float32Array | undefined;
      let smoothed: Float32Array;
      if (!prev || prev.length !== POINTS) {
        smoothed = newR;
      } else {
        smoothed = new Float32Array(POINTS);
        for (let i = 0; i < POINTS; i += 1) {
          smoothed[i] = prev[i]! + (newR[i]! - prev[i]!) * k;
        }
      }
      (blob as any).prevR = smoothed;
      const effectiveAlpha = Math.max(0, Math.min(1, blob.alpha * alphaMult));
      // Non-additive compositing: clear exactly the inner fill region,
      // then fill it at the target alpha (avoids any cleared "ring").
      const edgeHard = Math.max(0, Math.min(1, parseAlpha("--blob-edge-hardness") || 0.95));
      const innerScale = 0.72 + 0.15 * edgeHard;
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.fillStyle = 'rgba(0,0,0,1)';
      pathFromRadii(this.ctx, x, y, smoothed, innerScale);
      this.ctx.fill();
      this.ctx.restore();
      // Draw the blob
      fillFromRadii(this.ctx, x, y, smoothed, blob.color, effectiveAlpha);
    }
    this.ctx.globalAlpha = 1;
    this.ctx.imageSmoothingEnabled = true;

    // Optional debugging aid: overlay solid tint when enabled via CSS var
    // Enable at runtime: document.documentElement.style.setProperty('--ambient-debug-overlay', '0.15')
    const debugAlpha = parseAlpha("--ambient-debug-overlay");
    if (debugAlpha > 0) {
      this.ctx.globalAlpha = Math.min(1, debugAlpha);
      this.ctx.fillStyle = "#ff00aa";
      this.ctx.fillRect(0, 0, width, height);
      this.ctx.globalAlpha = 1;
    }
  }

  renderOnce(): void {
    this.renderFrame(performance.now());
  }

  setSeed(seed: number): void {
    if (this.seed === (seed >>> 0)) return;
    this.seed = seed >>> 0;
    this.refresh();
  }

  setPaused(paused: boolean): void {
    this.pausedManually = paused;
    if (paused) {
      this.stop();
    } else if (!this.reduceMotion && !this.isHidden) {
      this.start();
    }
  }

  start(): void {
    if (this.frameHandle !== null) return;
    this.lastRender = 0;
    this.schedule();
  }

  stop(): void {
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  destroy(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibilityChangeBound);
    INTERACTION_EVENTS.forEach((eventName) => {
      window.removeEventListener(eventName, this.onInteractionBound);
    });
    if (this.motionQuery && this.onMotionChangeBound) {
      if (typeof this.motionQuery.removeEventListener === "function") {
        this.motionQuery.removeEventListener("change", this.onMotionChangeBound);
      } else if (typeof this.motionQuery.removeListener === "function") {
        this.motionQuery.removeListener(this.onMotionChangeBound);
      }
    }
    if (this.element.parentElement === this.host) {
      this.host.removeChild(this.element);
    }
    if (this.onWindowResizeBound) {
      window.removeEventListener("resize", this.onWindowResizeBound);
    }
  }
}

export interface SoloBlobEcoOptions extends AmbientRendererOptions {
  mode?: BlobTone;
  secondMode?: BlobTone | null;
}

export class SoloBlobEco extends AmbientBlobCanvas {
  private tone: BlobTone;
  private secondary: BlobTone | null;

  constructor(host: HTMLElement, options: SoloBlobEcoOptions) {
    super(host, options);
    this.tone = options.mode ?? "teal";
    this.secondary = options.secondMode ?? null;
    this.refresh();
    this.initialisePlayback();
  }

  setModes(primary: BlobTone, secondary: BlobTone | null): void {
    this.tone = primary;
    this.secondary = secondary;
    this.refresh();
  }

  protected override buildBlobs(rng: () => number): BlobState[] {
    const tones: BlobTone[] = [this.tone ?? "teal"];
    if (this.secondary) {
      tones.push(this.secondary);
    }
    return tones.map((tone, index) => this.createBlob(tone, rng, index === tones.length - 1 ? 1.1 : 1));
  }
}

export function mountSoloBlobEco(host: HTMLElement, options: SoloBlobEcoOptions): SoloBlobEco {
  try {
    return new SoloBlobEco(host, options);
  } catch (error) {
    log.warn("SoloBlobEco failed to mount", error);
    throw error;
  }
}
