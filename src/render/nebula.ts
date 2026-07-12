// Procedural nebula backdrop shared by both scenes: a few dozen large, very
// faint blobs faked as concentric Graphics fills (2-5% alpha per circle) in
// deep violet / teal / faint orange. Blobs cluster around a few anchors so the
// haze reads as nebulae, not uniform fog. Display-only randomness via the
// local mulberry32 — the sim RNG is never touched — and everything is drawn
// once per seed/resize, behind the starfield/grid.

import type Phaser from 'phaser'
import { mulberry32 } from './prng'

type Gfx = Phaser.GameObjects.Graphics

export interface NebulaHue {
  color: number
  /** Relative pick weight; faint orange should stay rare. */
  weight: number
}

export interface NebulaBlob {
  /** Normalized canvas position; may spill slightly past the edges. */
  nx: number
  ny: number
  /** Radius as a fraction of min(canvas w, h). */
  rf: number
  color: number
  alpha: number
}

export const SECTOR_NEBULA_HUES: readonly NebulaHue[] = [
  { color: 0x5a35a8, weight: 4 }, // deep violet
  { color: 0x1f7a7a, weight: 4 }, // teal
  { color: 0x9a5a26, weight: 1.5 }, // faint orange
]

// Tactical board leans cooler and even quieter — readability first.
export const TACTICAL_NEBULA_HUES: readonly NebulaHue[] = [
  { color: 0x4a2f95, weight: 4 },
  { color: 0x226e77, weight: 3.5 },
  { color: 0x8a5527, weight: 1 },
]

export function makeNebula(seed: number, hues: readonly NebulaHue[], count = 30): NebulaBlob[] {
  const rand = mulberry32(seed)
  const totalWeight = hues.reduce((sum, h) => sum + h.weight, 0)
  const pickHue = (): number => {
    let ticket = rand() * totalWeight
    for (const hue of hues) {
      ticket -= hue.weight
      if (ticket < 0) return hue.color
    }
    return hues[hues.length - 1]!.color
  }
  // 2-3 loose cluster anchors, kept off dead center.
  const anchorCount = 2 + Math.floor(rand() * 2)
  const anchors = Array.from({ length: anchorCount }, () => ({
    x: 0.12 + rand() * 0.76,
    y: 0.12 + rand() * 0.76,
  }))
  return Array.from({ length: count }, () => {
    const anchor = anchors[Math.floor(rand() * anchors.length)]!
    // Sum of two uniforms ≈ triangular falloff around the anchor.
    const dx = (rand() + rand() - 1) * 0.42
    const dy = (rand() + rand() - 1) * 0.42
    return {
      nx: anchor.x + dx,
      ny: anchor.y + dy,
      rf: 0.1 + rand() * 0.18,
      color: pickHue(),
      alpha: 0.015 + rand() * 0.02,
    }
  })
}

/** Draw all blobs scaled to the canvas. Three fills per blob fake a soft radial gradient. */
export function drawNebula(g: Gfx, blobs: readonly NebulaBlob[], w: number, h: number): void {
  g.clear()
  const base = Math.min(w, h)
  for (const blob of blobs) {
    const x = blob.nx * w
    const y = blob.ny * h
    const r = blob.rf * base
    g.fillStyle(blob.color, blob.alpha)
    g.fillCircle(x, y, r)
    g.fillStyle(blob.color, blob.alpha * 0.85)
    g.fillCircle(x, y, r * 0.62)
    g.fillStyle(blob.color, blob.alpha * 0.7)
    g.fillCircle(x, y, r * 0.36)
  }
}
