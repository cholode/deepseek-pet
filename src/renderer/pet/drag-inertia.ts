import type { DragSample } from '../../shared/contracts';

export interface DragSway { swing: number; trailing: number }
const clamp = (n: number, limit: number) => Math.max(-limit, Math.min(limit, n));
const referenceAngle = 40 * Math.PI / 180;
const pendulumLength = 320; // Effective pivot-to-mass length in screen DIP.
const frequency = 5.5, dampingRatio = .36;

/** Gesture-scoped pendulum. Finite action loops can restart without losing momentum. */
export class DragInertia {
  private sample?: DragSample;
  private active = false;
  private ageMs = 0;
  private targetVelocity = 0;
  private velocity = 0;
  private angle = 0;
  private angularVelocity = 0;
  private trailing = 0;
  private trailingVelocity = 0;

  receive(active: boolean, sample?: DragSample) {
    if (!active) { this.reset(); return; }
    this.active = true;
    if (!sample) return;
    if (![sample.x, sample.timeMs, sample.gestureId].every(Number.isFinite)) { this.reset(); return; }
    const previous = this.sample;
    if (!previous || previous.gestureId !== sample.gestureId) {
      this.clearMotion(); this.sample = {...sample}; this.ageMs = 0; return;
    }
    const elapsed = sample.timeMs - previous.timeMs;
    // Repeated broadcasts during resize/settings must not inject another impulse.
    if (elapsed < 8) return;
    if (elapsed > 250) this.clearMotion();
    else this.targetVelocity = clamp((sample.x - previous.x) * 1000 / elapsed, 6000);
    this.sample = {...sample}; this.ageMs = 0;
  }

  step(deltaMs: number): DragSway {
    if (!this.active) return {swing:0, trailing:0};
    if (!Number.isFinite(deltaMs) || deltaMs < 0 || deltaMs > 250) {
      this.clearMotion(); this.sample = undefined; return {swing:0, trailing:0};
    }
    let remaining = deltaMs / 1000;
    while (remaining > 1e-8) {
      const dt = Math.min(remaining, 1 / 240); remaining -= dt; this.ageMs += dt * 1000;
      const target = this.ageMs > 140 ? 0 : this.targetVelocity;
      const previousVelocity = this.velocity;
      this.velocity += (target - this.velocity) * (1 - Math.exp(-dt / .04));
      const acceleration = clamp((this.velocity - previousVelocity) / dt, 30000);
      // Moving-pivot pendulum: θ'' = (a/L)cosθ - (g/L)sinθ - damping*θ'.
      // Screen Y points down, so positive θ trails a rightward acceleration.
      // Constant velocity adds no force; braking/reversal retains angular momentum.
      const overtravel = Math.max(0, Math.abs(this.angle) - referenceAngle * .8);
      const softStop = Math.sign(this.angle) * 160 * overtravel ** 3;
      this.angularVelocity += (acceleration / pendulumLength * Math.cos(this.angle)
        - frequency ** 2 * Math.sin(this.angle)
        - 2 * dampingRatio * frequency * this.angularVelocity - softStop) * dt;
      this.angle += this.angularVelocity * dt;
      // Smooth visual compression at large angles, never a hard snap at the limit.
      const swing = Math.tanh(this.angle / referenceAngle);
      this.trailingVelocity += (6.5 ** 2 * (swing * .7 - this.trailing) - 2 * .55 * 6.5 * this.trailingVelocity) * dt;
      this.trailing = clamp(this.trailing + this.trailingVelocity * dt, 1);
    }
    return {swing:Math.tanh(this.angle / referenceAngle), trailing:this.trailing};
  }

  private clearMotion() {
    this.targetVelocity = this.velocity = this.angle = this.angularVelocity = this.trailing = this.trailingVelocity = 0;
  }
  reset() { this.clearMotion(); this.sample = undefined; this.active = false; this.ageMs = 0; }
}
