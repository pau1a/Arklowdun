declare module "flubber" {
  export interface FlubberOptions {
    maxSegmentLength?: number;
  }

  export function interpolate(
    from: string,
    to: string,
    options?: FlubberOptions,
  ): (t: number) => string;
}
