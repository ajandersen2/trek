// LCARS palette (hex numbers for Graphics; css() converts for Text styles)
// and the shared display font stack. Render-layer only.

export const COLORS = {
  gold: 0xff9c00,
  peach: 0xffcc99,
  lavender: 0xcc99cc,
  slate: 0x9999cc,
  red: 0xcc6666,
  fed: 0x99ccff,
  fedBeam: 0xffaa55,
  klingon: 0x66dd66,
  klingonBeam: 0x66ff66,
  torpedo: 0xff5533,
  repair: 0x88dd88,
  shieldPlayer: 0x88ddff,
  hullGood: 0x55cc77,
  hullWarn: 0xffaa33,
  hullBad: 0xcc6666,
  grid: 0x8899bb,
  emptySystem: 0x7789aa,
  white: 0xffffff,
} as const

export const FONT_STACK = 'Antonio, "Arial Narrow", sans-serif'

/** 0xRRGGBB → '#rrggbb' for Phaser Text styles. */
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

/** Linear mix of two 0xRRGGBB colors, t in [0, 1]. */
export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number): number => {
    const ca = (a >> shift) & 0xff
    const cb = (b >> shift) & 0xff
    return Math.round(ca + (cb - ca) * t) & 0xff
  }
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/** Hull bar color by remaining fraction: green → amber → red. */
export function hullColor(frac: number): number {
  if (frac > 0.55) return COLORS.hullGood
  if (frac > 0.25) return COLORS.hullWarn
  return COLORS.hullBad
}
