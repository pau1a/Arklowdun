import { listen } from "@tauri-apps/api/event";
import { log } from "@utils/logger";
import {
  mountSoloBlobEco,
  SoloBlobEco,
  type SoloBlobEcoOptions,
} from "../components/SoloBlobEco";
import { BlobFieldEco, mountBlobFieldEco, type BlobFieldEcoOptions } from "../components/BlobFieldEco";
import {
  getAmbientMode,
  getRotationMode,
  onAmbientModeChange,
  onRotationModeChange,
  type AmbientMode,
  type RotationMode,
} from "@lib/store";
import {
  getBlobSeedForPeriod,
  onBlobSeedChange,
  forceNewBlobUniverse,
} from "@lib/blobRotation";

export interface AmbientBackgroundController {
  destroy(): void;
  refreshNow(): Promise<number>;
}

class AmbientBackgroundManager implements AmbientBackgroundController {
  private renderer: SoloBlobEco | BlobFieldEco | null = null;
  private mode: AmbientMode = "eco";
  private rotation: RotationMode = "weekly";
  private seed = 0;
  private unlistenAmbient: (() => void) | null = null;
  private unlistenRotation: (() => void) | null = null;
  private unlistenSeed: (() => void) | null = null;
  private unlistenFocus: (() => void) | null = null;
  private unlistenBlur: (() => void) | null = null;

  constructor(private readonly host: HTMLElement) {}

  async init(): Promise<void> {
    this.rotation = await getRotationMode();
    this.mode = await getAmbientMode();
    this.seed = await getBlobSeedForPeriod(this.rotation);
    this.applyRenderer();
    this.attachListeners();
    log.debug("ambient:init", { mode: this.mode, rotation: this.rotation, seed: this.seed });
  }

  private attachListeners(): void {
    this.unlistenAmbient = onAmbientModeChange(async (mode) => {
      this.mode = mode;
      this.applyRenderer();
      log.debug("ambient:mode", { mode });
    });
    this.unlistenRotation = onRotationModeChange(async (rotation) => {
      this.rotation = rotation;
      await this.ensureSeedForRotation();
      log.debug("ambient:rotation", { rotation });
    });
    this.unlistenSeed = onBlobSeedChange((seed) => {
      this.applySeed(seed);
    });

    void listen("tauri://focus", () => {
      void this.ensureSeedForRotation();
      if (this.mode !== "off") {
        this.renderer?.setPaused(false);
      }
    }).then((unlisten) => {
      this.unlistenFocus = unlisten;
    }).catch(() => {});

    void listen("tauri://blur", () => {
      this.renderer?.setPaused(true);
    }).then((unlisten) => {
      this.unlistenBlur = unlisten;
    }).catch(() => {});
  }

  private teardownRenderer(): void {
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
    this.host.querySelectorAll("canvas").forEach((el) => el.remove());
  }

  private applyRenderer(): void {
    this.teardownRenderer();
    const seed = this.seed;
    if (this.mode === "full") {
      const options: BlobFieldEcoOptions = {
        seed,
        count: 10,
        maxFps: 30,
        idleFps: 12,
        idleMs: 12000,
        renderScale: 0.7,
        edgeBias: 0.55,
      };
      this.renderer = mountBlobFieldEco(this.host, options);
    } else {
      const soloOptions: SoloBlobEcoOptions = {
        seed,
        mode: "teal",
        secondMode: this.mode === "eco" ? "aqua" : null,
        activeFps: 20,
        idleFps: 8,
        idleMs: 10000,
        renderScale: 0.75,
        edgeBias: 0.75,
        paused: this.mode === "off",
      };
      const solo = mountSoloBlobEco(this.host, soloOptions);
      if (this.mode === "off") {
        solo.renderOnce();
        solo.setPaused(true);
      }
      this.renderer = solo;
    }
  }

  private applySeed(seed: number): void {
    if (seed === this.seed) return;
    this.seed = seed;
    if (this.renderer) {
      this.renderer.setSeed(seed);
      if (this.mode === "off" && this.renderer instanceof SoloBlobEco) {
        this.renderer.renderOnce();
        this.renderer.setPaused(true);
      }
    }
  }

  private async ensureSeedForRotation(): Promise<void> {
    const next = await getBlobSeedForPeriod(this.rotation);
    this.applySeed(next);
  }

  async refreshNow(): Promise<number> {
    const seed = await forceNewBlobUniverse();
    this.applySeed(seed);
    return seed;
  }

  destroy(): void {
    this.teardownRenderer();
    this.unlistenAmbient?.();
    this.unlistenRotation?.();
    this.unlistenSeed?.();
    this.unlistenFocus?.();
    this.unlistenBlur?.();
    this.unlistenAmbient = null;
    this.unlistenRotation = null;
    this.unlistenSeed = null;
    this.unlistenFocus = null;
    this.unlistenBlur = null;
  }
}

export async function initAmbientBackground(host: HTMLElement): Promise<AmbientBackgroundController> {
  const manager = new AmbientBackgroundManager(host);
  await manager.init();
  return manager;
}
