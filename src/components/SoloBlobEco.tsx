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
  sprite: HTMLCanvasElement;
  alpha: number;
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

function quantizeAlpha(alpha: number, step = 0.02): number {
  const quantized = Math.round(alpha / step) * step;
  return Math.max(0, Math.min(1, quantized));
}

function makeSprite(tone: BlobTone, color: string, alpha: number): HTMLCanvasElement {
  const qa = quantizeAlpha(alpha);
  const key = `${tone}:${color}:${qa.toFixed(2)}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.15, size / 2, size / 2, size / 2);
    const [r, g, b] = toRgb(color);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${qa})`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
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
          this.stop();
          this.renderOnce();
        } else if (!this.pausedManually && !this.isHidden) {
          this.start();
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
        this.stop();
      } else if (!this.pausedManually && !this.reduceMotion) {
        this.start();
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
    const alpha = Math.max(0, Math.min(1, baseAlpha * (0.8 + rng() * 0.4) * emphasis));
    const sprite = makeSprite(tone, color, alpha);

    const radiusFactor = 0.25 + rng() * 0.2;
    const freqX = (Math.PI * 2) / (20 + rng() * 20);
    const freqY = (Math.PI * 2) / (20 + rng() * 20);
    const freqX2 = freqX * (0.4 + rng() * 0.6);
    const freqY2 = freqY * (0.4 + rng() * 0.6);
    const amplitudeX = 0.22 + rng() * 0.2;
    const amplitudeY = 0.18 + rng() * 0.2;
    const altAmplitudeX = amplitudeX * (0.3 + rng() * 0.4);
    const altAmplitudeY = amplitudeY * (0.3 + rng() * 0.4);
    const offsetX = (rng() - 0.5) * 0.6 * this.edgeBias;
    const offsetY = (rng() - 0.5) * 0.6 * this.edgeBias;
    const phaseX = rng() * Math.PI * 2;
    const phaseY = rng() * Math.PI * 2;
    const phaseX2 = rng() * Math.PI * 2;
    const phaseY2 = rng() * Math.PI * 2;
    const timeOffset = rng() * 40;

    return {
      tone,
      sprite,
      alpha,
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
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    this.cssWidth = width;
    this.cssHeight = height;
    if (width === 0 || height === 0) return;
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 1) : 1;
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
    const minSize = Math.min(width, height);
    for (const blob of this.blobs) {
      const t = elapsed + blob.timeOffset;
      const x = width * (0.5 + blob.offsetX + blob.amplitudeX * Math.sin(blob.freqX * t + blob.phaseX)
        + blob.altAmplitudeX * Math.sin(blob.freqX2 * t + blob.phaseX2));
      const y = height * (0.5 + blob.offsetY + blob.amplitudeY * Math.cos(blob.freqY * t + blob.phaseY)
        + blob.altAmplitudeY * Math.cos(blob.freqY2 * t + blob.phaseY2));
      const radius = minSize * blob.radiusFactor;
      this.ctx.globalAlpha = blob.alpha;
      this.ctx.drawImage(blob.sprite, x - radius, y - radius, radius * 2, radius * 2);
    }
    this.ctx.globalAlpha = 1;
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
