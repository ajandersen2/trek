// Glow-drawing primitives. Every shape is stroked/filled in layered passes
// (wide + faint under narrow + bright) so vectors read as luminous on the
// near-black viewport — the LCARS art direction, no sprite assets.

import type Phaser from 'phaser'
import { COLORS, mix } from './palette'

type Gfx = Phaser.GameObjects.Graphics

interface Pt {
  x: number
  y: number
}

// Outer halo → inner core; `lift` mixes the pass color toward white.
const GLOW_PASSES = [
  { width: 4.5, alpha: 0.14, lift: 0 },
  { width: 2.2, alpha: 0.34, lift: 0.15 },
  { width: 1, alpha: 0.95, lift: 0.55 },
] as const

export function strokeGlowPoly(
  g: Gfx,
  pts: readonly Pt[],
  color: number,
  weight = 1,
  alphaMul = 1,
  close = true,
): void {
  const first = pts[0]
  if (!first) return
  for (const pass of GLOW_PASSES) {
    g.lineStyle(pass.width * weight, mix(color, COLORS.white, pass.lift), pass.alpha * alphaMul)
    g.beginPath()
    g.moveTo(first.x, first.y)
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y)
    if (close) g.closePath()
    g.strokePath()
  }
}

export function strokeGlowCircle(
  g: Gfx,
  x: number,
  y: number,
  r: number,
  color: number,
  weight = 1,
  alphaMul = 1,
): void {
  for (const pass of GLOW_PASSES) {
    g.lineStyle(pass.width * weight, mix(color, COLORS.white, pass.lift), pass.alpha * alphaMul)
    g.strokeCircle(x, y, r)
  }
}

export function strokeGlowLine(
  g: Gfx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: number,
  weight = 1,
  alphaMul = 1,
): void {
  for (const pass of GLOW_PASSES) {
    g.lineStyle(pass.width * weight, mix(color, COLORS.white, pass.lift), pass.alpha * alphaMul)
    g.lineBetween(x1, y1, x2, y2)
  }
}

/** Glowing dot: halo, corona, white-hot core. */
export function fillGlowDot(g: Gfx, x: number, y: number, r: number, color: number, alphaMul = 1): void {
  g.fillStyle(color, 0.16 * alphaMul)
  g.fillCircle(x, y, r * 2.6)
  g.fillStyle(color, 0.45 * alphaMul)
  g.fillCircle(x, y, r * 1.5)
  g.fillStyle(mix(color, COLORS.white, 0.7), alphaMul)
  g.fillCircle(x, y, r)
}

/** Weapon beam: wide soft glow under a bright near-white core. */
export function drawBeam(g: Gfx, x1: number, y1: number, x2: number, y2: number, color: number): void {
  g.lineStyle(7, color, 0.16)
  g.lineBetween(x1, y1, x2, y2)
  g.lineStyle(3.5, color, 0.4)
  g.lineBetween(x1, y1, x2, y2)
  g.lineStyle(1.4, mix(color, COLORS.white, 0.75), 1)
  g.lineBetween(x1, y1, x2, y2)
}

/**
 * Stroke one arc segment of a circle, centered on `centerRad` and spanning
 * ±halfRad (screen radians: 0 = +X, positive toward +Y/down).
 */
export function strokeArcSegment(
  g: Gfx,
  x: number,
  y: number,
  r: number,
  centerRad: number,
  halfRad: number,
  width: number,
  color: number,
  alpha: number,
): void {
  g.lineStyle(width, color, alpha)
  g.beginPath()
  g.arc(x, y, r, centerRad - halfRad, centerRad + halfRad, false)
  g.strokePath()
}
