// World→screen projections. Tactical sim space is +Y up while the canvas is
// +Y down, so the tactical projection flips Y. The sector map (0-100 map
// space) is authored screen-oriented and only needs fit + margin, no flip.

import type { Vec2 } from '../sim/geometry'

export interface Projection {
  /** Pixels per world unit. */
  scale: number
  ox: number
  oy: number
}

/** Tactical projection: screen = (ox + x·scale, oy − y·scale). */
export function project(p: Projection, v: Vec2): Vec2 {
  return { x: p.ox + v.x * p.scale, y: p.oy - v.y * p.scale }
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function boundsOf(points: readonly Vec2[], pad: number): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  if (!Number.isFinite(minX)) {
    minX = 0
    minY = 0
    maxX = 0
    maxY = 0
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

/**
 * Uniform-scale fit of world bounds into a w×h canvas, centered, with a pixel
 * margin. maxScale keeps two point-blank ships from zooming into soup.
 */
export function fitProjection(
  b: Bounds,
  w: number,
  h: number,
  marginPx: number,
  maxScale: number,
): Projection {
  const bw = Math.max(b.maxX - b.minX, 1)
  const bh = Math.max(b.maxY - b.minY, 1)
  const fit = Math.min((w - 2 * marginPx) / bw, (h - 2 * marginPx) / bh, maxScale)
  const scale = Math.max(fit, 0.01)
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  // Center of bounds lands at canvas center (with the tactical Y flip).
  return { scale, ox: w / 2 - cx * scale, oy: h / 2 + cy * scale }
}

/** Sector map: fit the 0-100 map square with a fractional margin, letterboxed. */
export function fitMapProjection(w: number, h: number, marginFrac: number): Projection {
  const m = marginFrac * Math.min(w, h)
  const scale = Math.max(Math.min((w - 2 * m) / 100, (h - 2 * m) / 100), 0.01)
  return { scale, ox: (w - 100 * scale) / 2, oy: (h - 100 * scale) / 2 }
}

/** Sector map points are screen-oriented already: no Y flip. */
export function projectMap(p: Projection, v: Vec2): Vec2 {
  return { x: p.ox + v.x * p.scale, y: p.oy + v.y * p.scale }
}

/**
 * Sim heading (16 steps of 22.5°, CCW with +Y up) → Phaser rotation in
 * radians (+Y down makes screen rotation the negation). Accepts fractional
 * steps so headings can tween.
 */
export function headingToRotation(steps: number): number {
  return (-steps * Math.PI) / 8
}
