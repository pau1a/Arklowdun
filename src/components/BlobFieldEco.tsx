import { log } from "@utils/logger";
import {
  AmbientBlobCanvas,
  type AmbientRendererOptions,
  type BlobTone,
  type BlobState,
} from "./SoloBlobEco";

export interface BlobFieldEcoOptions extends AmbientRendererOptions {
  count?: number;
  palette?: BlobTone[];
  maxFps?: number;
}

export class BlobFieldEco extends AmbientBlobCanvas {
  private count: number;
  private palette: BlobTone[];

  constructor(host: HTMLElement, options: BlobFieldEcoOptions) {
    const active = options.maxFps ?? options.activeFps ?? 30;
    super(host, { ...options, activeFps: active });
    this.count = Math.max(1, Math.floor(options.count ?? 8));
    this.palette = options.palette && options.palette.length
      ? [...options.palette]
      : ["teal", "teal2", "aqua", "shade", "coral"];
    this.refresh();
    this.initialisePlayback();
  }

  setCount(count: number): void {
    const next = Math.max(1, Math.floor(count));
    if (next === this.count) return;
    this.count = next;
    this.refresh();
  }

  setPalette(palette: BlobTone[]): void {
    if (!palette.length) return;
    this.palette = [...palette];
    this.refresh();
  }

  protected override buildBlobs(rng: () => number): BlobState[] {
    const palette: BlobTone[] = this.palette.length ? this.palette : ["teal"];
    const blobs: BlobState[] = [];
    for (let index = 0; index < this.count; index += 1) {
      const tone = palette[Math.floor(rng() * palette.length)] ?? palette[0]!;
      const emphasis = tone === "coral" ? 0.6 : tone === "shade" ? 1.3 : 1;
      blobs.push(this.createBlob(tone, rng, emphasis));
    }
    return blobs;
  }
}

export function mountBlobFieldEco(host: HTMLElement, options: BlobFieldEcoOptions): BlobFieldEco {
  try {
    return new BlobFieldEco(host, options);
  } catch (error) {
    log.warn("BlobFieldEco failed to mount", error);
    throw error;
  }
}
