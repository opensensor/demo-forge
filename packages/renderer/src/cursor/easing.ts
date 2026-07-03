/**
 * DemoForge renderer — cubic Bezier easing function.
 *
 * Implements cubic Bezier curve calculation for smooth cursor movement
 * between action points. Uses the standard cubic Bezier formula with
 * Newton-Raphson iteration for parameter solving.
 */

// ─── Cubic Bezier Easing ─────────────────────────────────────────────────────

export function cubicBezier(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): (t: number) => number {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;

  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;

  function sampleCurveX(t: number): number {
    return ((ax * t + bx) * t + cx) * t;
  }

  function sampleCurveY(t: number): number {
    return ((ay * t + by) * t + cy) * t;
  }

  function sampleCurveDerivativeX(t: number): number {
    return (3 * ax * t + 2 * bx) * t + cx;
  }

  function solveCurveX(x: number, epsilon: number = 1e-6): number {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const currentX = sampleCurveX(t) - x;
      if (Math.abs(currentX) < epsilon) {
        return t;
      }
      const d = sampleCurveDerivativeX(t);
      if (Math.abs(d) < 1e-6) {
        break;
      }
      t = t - currentX / d;
    }
    return t;
  }

  return (t: number): number => {
    if (t === 0 || t === 1) {
      return sampleCurveY(t);
    }
    return sampleCurveY(solveCurveX(t));
  };
}

// ─── Preset Easings ──────────────────────────────────────────────────────────

export const easeInOut: (t: number) => number = cubicBezier(0.42, 0, 0.58, 1);
export const easeOut: (t: number) => number = cubicBezier(0, 0, 0.58, 1);
export const easeIn: (t: number) => number = cubicBezier(0.42, 0, 1, 1);
export const easeOutBounce: (t: number) => number = cubicBezier(0.68, -0.55, 0.265, 1.55);
export const linear: (t: number) => number = cubicBezier(0, 0, 1, 1);
