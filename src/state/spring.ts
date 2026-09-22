/**
 * v4's damped spring: `a = k·(target − x) − c·v`, integrated per frame, snapped
 * to the target once within 1e-6. Sizes use (180, 24); the anchor (40, 13).
 */
export class Spring {
  /** Current value. */
  x: number;
  /** Where the spring is heading. */
  target: number;
  private v = 0;

  constructor(
    x: number,
    private readonly k: number,
    private readonly c: number,
  ) {
    this.x = x;
    this.target = x;
  }

  /**
   * Advance by `dt` seconds.
   *
   * @param dt - Frame delta in seconds (v4 clamps to 0.05).
   * @returns The new value.
   */
  step(dt: number): number {
    const a = this.k * (this.target - this.x) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    if (Math.abs(this.x - this.target) < 1e-6 && Math.abs(this.v) < 1e-6) {
      this.x = this.target;
      this.v = 0;
    }
    return this.x;
  }

  /** Jump to `value` with no motion (init, reduced motion, tab return). */
  snap(value: number): void {
    this.x = value;
    this.target = value;
    this.v = 0;
  }

  /** True while the spring has not settled on its target. */
  get moving(): boolean {
    return Math.abs(this.x - this.target) > 1e-6;
  }
}
