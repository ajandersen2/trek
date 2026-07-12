// Vector ship silhouettes, drawn in ship-local space: +X is the facing axis,
// shapes are ~30 units nose to tail and scaled to the requested pixel size.
// Pure Graphics per the art direction — no sprite assets.

import type Phaser from 'phaser'
import type { FactionId } from '../sim/types'
import { COLORS, mix } from './palette'
import { strokeGlowCircle, strokeGlowLine, strokeGlowPoly } from './fx'

type Gfx = Phaser.GameObjects.Graphics

interface Pt {
  x: number
  y: number
}

// Saucer-and-nacelles cruiser simplified to a clean notched delta.
const FED_HULL: readonly Pt[] = [
  { x: 16, y: 0 },
  { x: -10, y: 10 },
  { x: -5, y: 0 },
  { x: -10, y: -10 },
]

// Bird-of-Prey: narrow head, swept angular wings.
const KLINGON_HULL: readonly Pt[] = [
  { x: 16, y: 0 },
  { x: 5, y: 2.4 },
  { x: -1, y: 3.4 },
  { x: -5, y: 11 },
  { x: -13, y: 14 },
  { x: -8, y: 4.6 },
  { x: -12, y: 2.4 },
  { x: -12, y: -2.4 },
  { x: -8, y: -4.6 },
  { x: -13, y: -14 },
  { x: -5, y: -11 },
  { x: -1, y: -3.4 },
  { x: 5, y: -2.4 },
]

// Fixed debris scatter for wrecks (display-only, deterministic).
const DEBRIS = [
  { x: 20, y: -6, r: 1.2 },
  { x: -18, y: 8, r: 1 },
  { x: 8, y: 14, r: 0.8 },
  { x: -4, y: -16, r: 1.1 },
  { x: 24, y: 9, r: 0.7 },
  { x: -22, y: -11, r: 0.9 },
] as const

function hullPoints(faction: FactionId): readonly Pt[] {
  return faction === 'federation' ? FED_HULL : KLINGON_HULL
}

function scalePts(pts: readonly Pt[], s: number): Pt[] {
  return pts.map((p) => ({ x: p.x * s, y: p.y * s }))
}

export function factionColor(faction: FactionId): number {
  return faction === 'federation' ? COLORS.fed : COLORS.klingon
}

export function beamColor(faction: FactionId): number {
  return faction === 'federation' ? COLORS.fedBeam : COLORS.klingonBeam
}

/** Glowing ship outline. sizePx ≈ nose-to-tail length on screen. */
export function drawShip(g: Gfx, faction: FactionId, sizePx: number, alphaMul = 1): void {
  const s = sizePx / 30
  const color = factionColor(faction)
  const hull = scalePts(hullPoints(faction), s)
  g.fillStyle(color, 0.07 * alphaMul)
  g.fillPoints(hull, true)
  strokeGlowPoly(g, hull, color, 1, alphaMul)
  if (faction === 'federation') {
    strokeGlowCircle(g, 4.5 * s, 0, 6 * s, color, 0.7, alphaMul * 0.9)
    strokeGlowLine(g, -6 * s, 6.8 * s, -14 * s, 6.8 * s, color, 0.7, alphaMul * 0.9)
    strokeGlowLine(g, -6 * s, -6.8 * s, -14 * s, -6.8 * s, color, 0.7, alphaMul * 0.9)
  } else {
    strokeGlowLine(g, -11 * s, 0, 9 * s, 0, color, 0.5, alphaMul * 0.6)
  }
}

/** Destroyed ship: dim broken outline (every other hull edge) + debris dots. */
export function drawWreck(g: Gfx, faction: FactionId, sizePx: number): void {
  const s = sizePx / 30
  const pts = scalePts(hullPoints(faction), s)
  const color = mix(factionColor(faction), 0x555566, 0.65)
  g.lineStyle(1, color, 0.5)
  for (let i = 0; i < pts.length; i += 2) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    g.lineBetween(a.x, a.y, b.x, b.y)
  }
  g.fillStyle(color, 0.55)
  for (const d of DEBRIS) g.fillCircle(d.x * s, d.y * s, d.r)
}

/** A few hull edges as segments, for scatter-on-destruction FX. */
export function hullFragments(faction: FactionId, sizePx: number): [Pt, Pt][] {
  const pts = scalePts(hullPoints(faction), sizePx / 30)
  const stride = Math.max(1, Math.floor(pts.length / 3))
  const frags: [Pt, Pt][] = []
  for (let i = 0; i < pts.length && frags.length < 3; i += stride) {
    frags.push([pts[i]!, pts[(i + 1) % pts.length]!])
  }
  return frags
}

/** Small Federation arrowhead used as the sector-map player marker. */
export function drawMarkerArrow(g: Gfx, sizePx: number, color: number): void {
  strokeGlowPoly(g, scalePts(FED_HULL, sizePx / 30), color, 0.8)
}
