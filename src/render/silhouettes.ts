// Vector ship silhouettes, drawn in ship-local space: +X is the facing axis,
// shapes are ~30 units nose to tail and scaled to the requested pixel size.
// Pure Graphics per the art direction — no sprite assets.
//
// Shapes are keyed by ship classId with a faction fallback (unknown Klingon
// classes get the stock Bird-of-Prey; unknown Federation the delta), so new
// sim ship classes never render as nothing.

import type Phaser from 'phaser'
import type { FactionId } from '../sim/types'
import { COLORS, mix } from './palette'
import { fillGlowDot, strokeGlowCircle, strokeGlowLine, strokeGlowPoly } from './fx'

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
const BOP_HULL: readonly Pt[] = [
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

// K't'inga battlecruiser: bulbous forward hull on a long thin neck boom,
// swelling into an engineering block with broad angular wings.
const KTINGA_HULL: readonly Pt[] = [
  { x: 17, y: 0 },
  { x: 14.5, y: 2.8 },
  { x: 10.5, y: 3.4 },
  { x: 8.5, y: 1.6 },
  { x: 0, y: 1.2 },
  { x: -3, y: 2.8 },
  { x: -6.5, y: 3.8 },
  { x: -14, y: 12.5 },
  { x: -11.5, y: 4.6 },
  { x: -13.5, y: 2 },
  { x: -13.5, y: -2 },
  { x: -11.5, y: -4.6 },
  { x: -14, y: -12.5 },
  { x: -6.5, y: -3.8 },
  { x: -3, y: -2.8 },
  { x: 0, y: -1.2 },
  { x: 8.5, y: -1.6 },
  { x: 10.5, y: -3.4 },
  { x: 14.5, y: -2.8 },
]

// Raptor scout: sharp dagger profile with short swept wing barbs.
const RAPTOR_HULL: readonly Pt[] = [
  { x: 17, y: 0 },
  { x: 7, y: 1.8 },
  { x: 1, y: 5.2 },
  { x: -8.5, y: 8.5 },
  { x: -6, y: 3 },
  { x: -12, y: 2.2 },
  { x: -12, y: -2.2 },
  { x: -6, y: -3 },
  { x: -8.5, y: -8.5 },
  { x: 1, y: -5.2 },
  { x: 7, y: -1.8 },
]

const KTINGA_GREEN = 0x48b357 // deeper than the stock Klingon green
const KTINGA_ACCENT = 0xe05548 // red-hot wing tips and torpedo tube
const RAPTOR_GREEN = 0xa8e060 // lighter yellow-green

// Fixed debris scatter for wrecks (display-only, deterministic).
const DEBRIS = [
  { x: 20, y: -6, r: 1.2 },
  { x: -18, y: 8, r: 1 },
  { x: 8, y: 14, r: 0.8 },
  { x: -4, y: -16, r: 1.1 },
  { x: 24, y: 9, r: 0.7 },
  { x: -22, y: -11, r: 0.9 },
] as const

interface ShipShape {
  hull: readonly Pt[]
  color: number
  /** Visual size multiplier against the ~30-unit base silhouette. */
  scale: number
  /** Extra glowing detail lines, in the same pre-scaled local units. */
  detail: (g: Gfx, s: number, alphaMul: number) => void
}

const SHAPES: Record<string, ShipShape> = {
  'fed-cruiser': {
    hull: FED_HULL,
    color: COLORS.fed,
    scale: 1,
    detail: (g, s, alphaMul) => {
      strokeGlowCircle(g, 4.5 * s, 0, 6 * s, COLORS.fed, 0.7, alphaMul * 0.9)
      strokeGlowLine(g, -6 * s, 6.8 * s, -14 * s, 6.8 * s, COLORS.fed, 0.7, alphaMul * 0.9)
      strokeGlowLine(g, -6 * s, -6.8 * s, -14 * s, -6.8 * s, COLORS.fed, 0.7, alphaMul * 0.9)
    },
  },
  'klingon-bop': {
    hull: BOP_HULL,
    color: COLORS.klingon,
    scale: 1,
    detail: (g, s, alphaMul) => {
      strokeGlowLine(g, -11 * s, 0, 9 * s, 0, COLORS.klingon, 0.5, alphaMul * 0.6)
    },
  },
  'klingon-ktinga': {
    hull: KTINGA_HULL,
    color: KTINGA_GREEN,
    scale: 1.35,
    detail: (g, s, alphaMul) => {
      strokeGlowLine(g, -12 * s, 0, 12 * s, 0, KTINGA_GREEN, 0.5, alphaMul * 0.6)
      // Red accents: wing tips + forward torpedo tube on the bulb.
      strokeGlowLine(g, -14 * s, 12.5 * s, -11.5 * s, 10 * s, KTINGA_ACCENT, 0.6, alphaMul * 0.85)
      strokeGlowLine(g, -14 * s, -12.5 * s, -11.5 * s, -10 * s, KTINGA_ACCENT, 0.6, alphaMul * 0.85)
      fillGlowDot(g, 15 * s, 0, 1.1 * s, KTINGA_ACCENT, alphaMul * 0.9)
    },
  },
  'klingon-raptor': {
    hull: RAPTOR_HULL,
    color: RAPTOR_GREEN,
    scale: 0.8,
    detail: (g, s, alphaMul) => {
      strokeGlowLine(g, -10 * s, 0, 12 * s, 0, RAPTOR_GREEN, 0.45, alphaMul * 0.55)
      // Cockpit chevron just behind the needle nose.
      strokeGlowLine(g, 5 * s, 2 * s, 8.5 * s, 0, RAPTOR_GREEN, 0.5, alphaMul * 0.7)
      strokeGlowLine(g, 5 * s, -2 * s, 8.5 * s, 0, RAPTOR_GREEN, 0.5, alphaMul * 0.7)
    },
  },
}

function shapeFor(classId: string, faction: FactionId): ShipShape {
  return SHAPES[classId] ?? SHAPES[faction === 'federation' ? 'fed-cruiser' : 'klingon-bop']!
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

/** Hull tint for FX (fragments, warp streak) matching the drawn silhouette. */
export function shipColor(classId: string, faction: FactionId): number {
  return shapeFor(classId, faction).color
}

/** Glowing ship outline. sizePx ≈ nose-to-tail length on screen at scale 1. */
export function drawShip(g: Gfx, classId: string, faction: FactionId, sizePx: number, alphaMul = 1): void {
  const shape = shapeFor(classId, faction)
  const s = (sizePx * shape.scale) / 30
  const hull = scalePts(shape.hull, s)
  g.fillStyle(shape.color, 0.07 * alphaMul)
  g.fillPoints(hull, true)
  strokeGlowPoly(g, hull, shape.color, 1, alphaMul)
  shape.detail(g, s, alphaMul)
}

/** Destroyed ship: dim broken outline (every other hull edge) + debris dots. */
export function drawWreck(g: Gfx, classId: string, faction: FactionId, sizePx: number): void {
  const shape = shapeFor(classId, faction)
  const s = (sizePx * shape.scale) / 30
  const pts = scalePts(shape.hull, s)
  const color = mix(shape.color, 0x555566, 0.65)
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
export function hullFragments(classId: string, faction: FactionId, sizePx: number): [Pt, Pt][] {
  const shape = shapeFor(classId, faction)
  const pts = scalePts(shape.hull, (sizePx * shape.scale) / 30)
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
