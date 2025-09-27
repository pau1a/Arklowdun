import { interpolate } from "flubber";
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
  "M0 395L21.5 392.3C43 389.7 86 384.3 128.8 379.5C171.7 374.7 214.3 370.3 257.2 379.7C300 389 343 412 385.8 422.7C428.7 433.3 471.3 431.7 514.2 429.3C557 427 600 424 642.8 424.5C685.7 425 728.3 429 771.2 427C814 425 857 417 878.5 413L900 409L900 620L878.5 620C857 620 814 620 771.2 620C728.3 620 685.7 620 642.8 620C600 620 557 620 514.2 620C471.3 620 428.7 620 385.8 620C343 620 300 620 257.2 620C214.3 620 171.7 620 128.8 620C86 620 43 620 21.5 620L0 620Z",
  "M0 463L21.5 452.7C43 442.3 86 421.7 128.8 417.3C171.7 413 214.3 425 257.2 430C300 435 343 433 385.8 438C428.7 443 471.3 455 514.2 449.2C557 443.3 600 419.7 642.8 413.2C685.7 406.7 728.3 417.3 771.2 418C814 418.7 857 409.3 878.5 404.7L900 400L900 620L878.5 620C857 620 814 620 771.2 620C728.3 620 685.7 620 642.8 620C600 620 557 620 514.2 620C471.3 620 428.7 620 385.8 620C343 620 300 620 257.2 620C214.3 620 171.7 620 128.8 620C86 620 43 620 21.5 620L0 620Z",
  "M0 503L21.5 496.2C43 489.3 86 475.7 128.8 474.7C171.7 473.7 214.3 485.3 257.2 487C300 488.7 343 480.3 385.8 480.3C428.7 480.3 471.3 488.7 514.2 484.3C557 480 600 463 642.8 453.7C685.7 444.3 728.3 442.7 771.2 452.8C814 463 857 485 878.5 496L900 507L900 620L878.5 620C857 620 814 620 771.2 620C728.3 620 685.7 620 642.8 620C600 620 557 620 514.2 620C471.3 620 428.7 620 385.8 620C343 620 300 620 257.2 620C214.3 620 171.7 620 128.8 620C86 620 43 620 21.5 620L0 620Z",
  "M0 501L21.5 507.8C43 514.7 86 528.3 128.8 525.2C171.7 522 214.3 502 257.2 494C300 486 343 490 385.8 490C428.7 490 471.3 486 514.2 491.8C557 497.7 600 513.3 642.8 517.2C685.7 521 728.3 513 771.2 508.5C814 504 857 503 878.5 502.5L900 502L900 620L878.5 620C857 620 814 620 771.2 620C728.3 620 685.7 620 642.8 620C600 620 557 620 514.2 620C471.3 620 428.7 620 385.8 620C343 620 300 620 257.2 620C214.3 620 171.7 620 128.8 620C86 620 43 620 21.5 620L0 620Z",
  "M0 547L21.5 546.8C43 546.7 86 546.3 128.8 550.3C171.7 554.3 214.3 562.7 257.2 561.8C300 561 343 551 385.8 550.7C428.7 550.3 471.3 559.7 514.2 564.7C557 569.7 600 570.3 642.8 567.3C685.7 564.3 728.3 557.7 771.2 555.2C814 552.7 857 554.3 878.5 555.2L900 556L900 620L878.5 620C857 620 814 620 771.2 620C728.3 620 685.7 620 642.8 620C600 620 557 620 514.2 620C471.3 620 428.7 620 385.8 620C343 620 300 620 257.2 620C214.3 620 171.7 620 128.8 620C86 620 43 620 21.5 620L0 620Z",
] as const;

const PATHS_ALT = [
  "M0 420L32 408C64 396 128 372 185 360C242 348 293 348 338 368C383 388 422 428 468 438C514 448 566 428 612 420C658 412 698 416 744 422C790 428 842 436 871 438L900 440L900 620L0 620Z",
  "M0 470L30 458C60 446 120 422 176 414C232 406 284 414 330 424C376 434 416 446 462 452C508 458 560 458 604 448C648 438 684 418 732 414C780 410 840 422 870 430L900 438L900 620L0 620Z",
  "M0 520L28 508C56 496 112 472 164 468C216 464 264 480 312 488C360 496 408 496 452 492C496 488 536 480 582 470C628 460 680 448 726 456C772 464 812 492 856 506L900 520L900 620L0 620Z",
  "M0 512L34 520C68 528 136 544 190 536C244 528 284 496 332 488C380 480 436 496 486 500C536 504 580 496 630 506C680 516 736 544 780 546C824 548 856 524 878 514L900 504L900 620L0 620Z",
  "M0 560L36 558C72 556 144 552 202 556C260 560 304 572 352 574C400 576 452 568 502 566C552 564 600 568 650 566C700 564 752 556 796 552C840 548 876 548 898 548L900 548L900 620L0 620Z",
] as const;

const FILL_PALETTES: Record<AnimatedWavesVariant, readonly [string, string, string, string, string]> = {
  dark: ["#fa7268", "#ef5f67", "#e34c67", "#d53867", "#c62368"],
  light: ["#ffd1cc", "#ffb3bd", "#ff95ad", "#ff789e", "#ff5a8e"],
};

const strengths = [1, 0.7, 0.5, 0.3, 0.15] as const;
const DURATION_MS = 20000;

const reduceMotionQuery = (): MediaQueryList | null =>
  typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? null
    : window.matchMedia("(prefers-reduced-motion: reduce)");

const tokenizeClassName = (value?: string): string[] =>
  value ? value.split(/\s+/).map(token => token.trim()).filter(Boolean) : [];

const applyPalette = (paths: SVGPathElement[], palette: readonly string[]): void => {
  paths.forEach((path, index) => {
    const next = palette[index];
    if (next) path.setAttribute("fill", next);
  });
};

export default function createAnimatedWaves(options: AnimatedWavesOptions = {}): AnimatedWavesElement {
  const { className = "", morph = false, variant = "dark" } = options;

  const svg = document.createElementNS(SVG_NS, "svg") as AnimatedWavesElement;
  svg.classList.add("ark-waves");
  svg.setAttribute("viewBox", "0 0 900 600");
  svg.setAttribute("preserveAspectRatio", "xMidYMax slice");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  let currentVariant: AnimatedWavesVariant = variant;
  let currentMorph = morph;
  let customClassTokens = tokenizeClassName(className);
  if (customClassTokens.length) {
    svg.classList.add(...customClassTokens);
  }

  const motionGroup = document.createElementNS(SVG_NS, "g");
  motionGroup.classList.add("ark-waves__motion");
  svg.appendChild(motionGroup);

  const pathElements = PATHS.map((d, index) => {
    const path = document.createElementNS(SVG_NS, "path");
    path.classList.add("ark-waves__layer");
    path.id = `ark-waves-path-${index + 1}`;
    path.setAttribute("d", d);
    motionGroup.appendChild(path);
    return path;
  });

  applyPalette(pathElements, FILL_PALETTES[currentVariant]);

  let raf: number | null = null;
  let interpolators: (((t: number) => string) | null)[] = [null, null, null, null, null];

  const resetShapes = () => {
    pathElements.forEach((path, index) => {
      path.setAttribute("d", PATHS[index]);
    });
  };

  const stopMorph = () => {
    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    resetShapes();
  };

  const reduceMotion = reduceMotionQuery();

  const startMorph = () => {
    if (raf !== null || !currentMorph || reduceMotion?.matches) return;

    interpolators = PATHS.map((d, index) => interpolate(d, PATHS_ALT[index], { maxSegmentLength: 3 }));
    let start = performance.now();

    const tick = (now: number) => {
      if (!currentMorph || reduceMotion?.matches) {
        stopMorph();
        return;
      }

      const elapsed = ((now - start) % DURATION_MS) / DURATION_MS;
      const pingPong = elapsed < 0.5 ? elapsed * 2 : (1 - elapsed) * 2;

      for (let index = 0; index < pathElements.length; index += 1) {
        const interpolatePath = interpolators[index];
        if (!interpolatePath) continue;
        const local = Math.min(1, pingPong * strengths[index]);
        pathElements[index].setAttribute("d", interpolatePath(local));
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
  };

  const handleMotionChange = () => {
    if (reduceMotion?.matches) {
      stopMorph();
    } else if (currentMorph) {
      startMorph();
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
    startMorph();
  }

  svg.update = next => {
    if (next.className !== undefined) {
      if (customClassTokens.length) {
        svg.classList.remove(...customClassTokens);
      }
      customClassTokens = tokenizeClassName(next.className);
      if (customClassTokens.length) {
        svg.classList.add(...customClassTokens);
      }
    }

    if (next.variant && next.variant !== currentVariant) {
      currentVariant = next.variant;
      applyPalette(pathElements, FILL_PALETTES[currentVariant]);
    }

    if (typeof next.morph === "boolean" && next.morph !== currentMorph) {
      currentMorph = next.morph;
      if (currentMorph) {
        startMorph();
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

export { createAnimatedWaves };
