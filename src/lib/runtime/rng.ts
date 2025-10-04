export interface Rng {
  next(): number;
}

export class SeededRng implements Rng {
  private state: number;

  constructor(seed = 1) {
    this.state = seed >>> 0;
  }

  next(): number {
    // xorshift32
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return (this.state & 0xffffffff) / 0x100000000;
  }
}

export class SystemRng implements Rng {
  next(): number {
    return Math.random();
  }
}
