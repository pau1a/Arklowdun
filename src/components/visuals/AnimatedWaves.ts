import "./animated-waves.css";

export type AnimatedWavesVariant = "light" | "dark";

export interface AnimatedWavesOptions {
  className?: string;
  morph?: boolean;
  variant?: AnimatedWavesVariant;
}

export type AnimatedWavesElement = SVGSVGElement & {
  update: (options: Partial<AnimatedWavesOptions>) => void;
  destroy: () => void;
};

const SVG_NS = "http://www.w3.org/2000/svg";
const PATHS = [
  "M0 395L21.5 392.3C43 389.7 86 384.3 128.8 379.5C171.7 374.7 214.3 370.3 257.2 379.7C300 389 343 412 385.8 422.7C428.7 433.3 471.3 431.7 514.2 429.3C557 427 600 424 642.8 424.5C685.7 425 728.3 429 771.2 427C814 425 857 417 878.5 413L900 409L900 601L878.5 601C857 601 814 601 771.2 601C728.3 601 685.7 601 642.8 601C600 601 557 601 514.2 601C471.3 601 428.7 601 385.8 601C343 601 300 601 257.2 601C214.3 601 171.7 601 128.8 601C86 601 43 601 21.5 601L0 601Z",
  "M0 463L21.5 452.7C43 442.3 86 421.7 128.8 417.3C171.7 413 214.3 425 257.2 430C300 435 343 433 385.8 438C428.7 443 471.3 455 514.2 449.2C557 443.3 600 419.7 642.8 413.2C685.7 406.7 728.3 417.3 771.2 418C814 418.7 857 409.3 878.5 404.7L900 400L900 601L878.5 601C857 601 814 601 771.2 601C728.3 601 685.7 601 642.8 601C600 601 557 601 514.2 601C471.3 601 428.7 601 385.8 601C343 601 300 601 257.2 601C214.3 601 171.7 601 128.8 601C86 601 43 601 21.5 601L0 601Z",
  "M0 503L21.5 496.2C43 489.3 86 475.7 128.8 474.7C171.7 473.7 214.3 485.3 257.2 487C300 488.7 343 480.3 385.8 480.3C428.7 480.3 471.3 488.7 514.2 484.3C557 480 600 463 642.8 453.7C685.7 444.3 728.3 442.7 771.2 452.8C814 463 857 485 878.5 496L900 507L900 601L878.5 601C857 601 814 601 771.2 601C728.3 601 685.7 601 642.8 601C600 601 557 601 514.2 601C471.3 601 428.7 601 385.8 601C343 601 300 601 257.2 601C214.3 601 171.7 601 128.8 601C86 601 43 601 21.5 601L0 601Z",
  "M0 501L21.5 507.8C43 514.7 86 528.3 128.8 525.2C171.7 522 214.3 502 257.2 494C300 486 343 490 385.8 490C428.7 490 471.3 486 514.2 491.8C557 497.7 600 513.3 642.8 517.2C685.7 521 728.3 513 771.2 508.5C814 504 857 503 878.5 502.5L900 502L900 601L878.5 601C857 601 814 601 771.2 601C728.3 601 685.7 601 642.8 601C600 601 557 601 514.2 601C471.3 601 428.7 601 385.8 601C343 601 300 601 257.2 601C214.3 601 171.7 601 128.8 601C86 601 43 601 21.5 601L0 601Z",
  "M0 547L21.5 546.8C43 546.7 86 546.3 128.8 550.3C171.7 554.3 214.3 562.7 257.2 561.8C300 561 343 551 385.8 550.7C428.7 550.3 471.3 559.7 514.2 564.7C557 569.7 600 570.3 642.8 567.3C685.7 564.3 728.3 557.7 771.2 555.2C814 552.7 857 554.3 878.5 555.2L900 556L900 601L878.5 601C857 601 814 601 771.2 601C728.3 601 685.7 601 642.8 601C600 601 557 601 514.2 601C471.3 601 428.7 601 385.8 601C343 601 300 601 257.2 601C214.3 601 171.7 601 128.8 601C86 601 43 601 21.5 601L0 601Z",
] as const;

const PATH3_ALTERNATE = PATHS[2]
  .replace("M0 503", "M0 497")
  .replace("21.5 496.2", "21.5 490.2")
  .replace("86 475.7", "86 470.3")
  .replace(/480\.3/g, "474.3")
  .replace("878.5 496L", "878.5 500.5L")
  .replace("900 507L", "900 511L");

const FILL_PALETTES: Record<AnimatedWavesVariant, readonly [string, string, string, string, string]> = {
  dark: ["#fa7268", "#ef5f67", "#e34c67", "#d53867", "#c62368"],
  light: ["#ffd1cc", "#ffb3bd", "#ff95ad", "#ff789e", "#ff5a8e"],
};

const reduceMotionQuery = (): MediaQueryList | null => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)");
};

const tokenizeClassName = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
};

const applyPalette = (paths: SVGPathElement[], palette: readonly string[]): void => {
  paths.forEach((path, index) => {
    const next = palette[index];
    if (next) path.setAttribute("fill", next);
  });
};

export function createAnimatedWaves(options: AnimatedWavesOptions = {}): AnimatedWavesElement {
  const {
    className = "",
    morph = false,
    variant = "dark",
  } = options;

  const svg = document.createElementNS(SVG_NS, "svg") as AnimatedWavesElement;
  svg.classList.add("ark-waves");
  svg.setAttribute("viewBox", "0 0 900 600");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  let customClassTokens = tokenizeClassName(className);
  customClassTokens.forEach(token => svg.classList.add(token));

  const pathElements = PATHS.map((d, index) => {
    const path = document.createElementNS(SVG_NS, "path");
    path.classList.add("ark-waves__layer");
    path.setAttribute("d", d);
    path.setAttribute("id", `ark-waves-path-${index + 1}`);
    svg.appendChild(path);
    return path;
  });

  let currentVariant: AnimatedWavesVariant = variant;
  let currentMorph = morph;
  let morphFrame: number | null = null;
  let morphLoading = false;

  svg.dataset.variant = currentVariant;
  applyPalette(pathElements, FILL_PALETTES[currentVariant]);

  const pathThree = pathElements[2] ?? null;
  const resetMorphShape = () => {
    if (pathThree) pathThree.setAttribute("d", PATHS[2]);
  };

  const stopMorph = () => {
    if (morphFrame !== null) {
      cancelAnimationFrame(morphFrame);
      morphFrame = null;
    }
    resetMorphShape();
  };

  const reduceMotion = reduceMotionQuery();

  const runMorph = () => {
    if (!currentMorph || !pathThree) return;
    if (reduceMotion?.matches) {
      stopMorph();
      return;
    }
    if (morphFrame !== null || morphLoading) return;
    morphLoading = true;
    import("flubber")
      .then(({ interpolate }) => {
        morphLoading = false;
        if (!currentMorph || reduceMotion?.matches || !pathThree) {
          stopMorph();
          return;
        }
        const interpolator = interpolate(PATHS[2], PATH3_ALTERNATE, { maxSegmentLength: 3 });
        const duration = 18000;
        let start = performance.now();

        const tick = (now: number) => {
          if (!currentMorph || reduceMotion?.matches || !pathThree) {
            stopMorph();
            return;
          }
          const elapsed = ((now - start) % duration) / duration;
          const progress = elapsed < 0.5 ? elapsed * 2 : (1 - elapsed) * 2;
          pathThree.setAttribute("d", interpolator(progress));
          morphFrame = requestAnimationFrame(tick);
        };

        morphFrame = requestAnimationFrame(tick);
      })
      .catch(error => {
        morphLoading = false;
        if (import.meta.env?.DEV) {
          console.warn("AnimatedWaves: failed to start morph animation", error);
        }
      });
  };

  const handleMotionChange = () => {
    if (reduceMotion?.matches) {
      stopMorph();
    } else if (currentMorph) {
      runMorph();
    }
  };

  if (reduceMotion) {
    if (typeof reduceMotion.addEventListener === "function") {
      reduceMotion.addEventListener("change", handleMotionChange);
    } else if (typeof reduceMotion.addListener === "function") {
      reduceMotion.addListener(handleMotionChange);
    }
  }

  if (currentMorph) {
    runMorph();
  }

  svg.update = next => {
    if (next.className !== undefined) {
      customClassTokens.forEach(token => svg.classList.remove(token));
      customClassTokens = tokenizeClassName(next.className);
      customClassTokens.forEach(token => svg.classList.add(token));
    }

    if (next.variant && next.variant !== currentVariant) {
      currentVariant = next.variant;
      svg.dataset.variant = currentVariant;
      applyPalette(pathElements, FILL_PALETTES[currentVariant]);
    }

    if (typeof next.morph === "boolean" && next.morph !== currentMorph) {
      currentMorph = next.morph;
      if (currentMorph) {
        runMorph();
      } else {
        stopMorph();
      }
    }
  };

  svg.destroy = () => {
    stopMorph();
    if (reduceMotion) {
      if (typeof reduceMotion.removeEventListener === "function") {
        reduceMotion.removeEventListener("change", handleMotionChange);
      } else if (typeof reduceMotion.removeListener === "function") {
        reduceMotion.removeListener(handleMotionChange);
      }
    }
  };

  return svg;
}

export default createAnimatedWaves;
