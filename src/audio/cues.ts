// Cue recipes: every one-shot sound in the game as a small synthesis program
// over a Voice. Each recipe comments its intent; DEBUG.md carries the full
// audit sheet (recipe → expected character) for tuning by ear.
//
// All frequencies in Hz, all times in seconds relative to the voice start.
// `vary(x)` gives ±x% micro-variation so repeated shots never sound identical.

import type { SoundCue, UiBeep } from './api'
import { rand, vary, type Voice } from './synth'

type Recipe = (v: Voice) => void

// --- shared builders ---------------------------------------------------------

/**
 * Impact boom: noise through a lowpass sweeping down (the "blast") plus a
 * low sine body thump; `punch` adds a mid-band crack at the onset.
 */
const boom = (v: Voice, bright: number, size: number, punch: number): void => {
  const j = vary(0.05)
  const blast = v.env(0.85, 0, size, 0.004)
  const blastLp = v.filter('lowpass', bright * j, 0.8, blast)
  v.sweep(blastLp.frequency, bright * j, 160, 0, size * 0.9)
  v.noise(blastLp, { stop: size + 0.03 })
  const body = v.env(0.6, 0, size * 0.75, 0.006)
  const sub = v.osc('sine', 92 * j, body, { stop: size * 0.75 + 0.02 })
  v.sweep(sub.frequency, 92 * j, 50 * j, 0, size * 0.55)
  if (punch > 0) {
    const crack = v.env(punch, 0, 0.09, 0.002)
    const crackBp = v.filter('bandpass', 1100, 2, crack)
    v.noise(crackBp, { stop: 0.11 })
  }
}

/**
 * Detuned three-oscillator stack sweeping `from → to` through a moving
 * lowpass — the shimmer engine behind warp/cloak. `spreadTo` widens (or
 * narrows) the detune over the sweep for a chorus that blooms or focuses.
 */
const shimmerStack = (
  v: Voice,
  o: {
    type: OscillatorType
    from: number
    to: number
    dur: number
    total: number
    lpFrom: number
    lpTo: number
    peak: number
    attack: number
    hold: number
    spread: number
    spreadTo?: number
  }
): void => {
  const e = v.env(o.peak, 0, o.total, o.attack, o.hold)
  const lp = v.filter('lowpass', o.lpFrom, 1, e)
  v.sweep(lp.frequency, o.lpFrom, o.lpTo, 0, o.dur)
  for (const d of [-o.spread, 0, o.spread]) {
    const osc = v.osc(o.type, o.from, lp, { stop: o.total + 0.03, detune: d })
    v.sweep(osc.frequency, o.from, o.to, 0, o.dur)
    if (o.spreadTo !== undefined && d !== 0) {
      v.sweep(osc.detune, d, Math.sign(d) * o.spreadTo, 0, o.dur, 'lin')
    }
  }
}

/** One enveloped note into `dest` — sustains ~half its length, then releases. */
const note = (
  v: Voice,
  dest: AudioNode,
  type: OscillatorType,
  freq: number,
  at: number,
  dur: number,
  peak: number,
  detune = 0
): OscillatorNode => {
  const e = v.env(peak, at, dur, 0.02, dur * 0.5, dest)
  return v.osc(type, freq, e, { at, stop: at + dur + 0.02, detune })
}

// --- UI beeps ------------------------------------------------------------------

export const beepRecipes: Record<UiBeep, Recipe> = {
  // Soft console blip: short triangle with a subtle downward flick. <80 ms.
  tap: v => {
    const j = vary(0.05)
    v.tone({ type: 'triangle', freq: 1500 * j, glideTo: 1340 * j, dur: 0.06, attack: 0.004, peak: 0.22 })
  },

  // Two-note rising chirp (perfect fifth) — "accepted".
  confirm: v => {
    const j = vary(0.03)
    v.tone({ type: 'triangle', freq: 1050 * j, dur: 0.07, attack: 0.004, peak: 0.2 })
    v.tone({ type: 'triangle', freq: 1575 * j, at: 0.075, dur: 0.09, attack: 0.004, peak: 0.24 })
  },

  // Low buzz: square through a lowpass, sagging pitch — "not possible".
  deny: v => {
    const j = vary(0.04)
    const e = v.env(0.4, 0, 0.15, 0.006, 0.08)
    const lp = v.filter('lowpass', 480, 1, e)
    const o = v.osc('square', 150 * j, lp, { stop: 0.17 })
    v.sweep(o.frequency, 150 * j, 118 * j, 0, 0.13, 'lin')
  },

  // Authoritative three-note ascending sequence (quartal — very LCARS),
  // with a faint octave sparkle on the last note. ~330 ms.
  execute: v => {
    const j = vary(0.02)
    const seq: [number, number, number, number][] = [
      [587, 0, 0.085, 0.2],
      [784, 0.095, 0.085, 0.22],
      [1046, 0.19, 0.14, 0.26],
    ]
    for (const [f, at, dur, peak] of seq) {
      v.tone({ type: 'triangle', freq: f * j, at, dur, attack: 0.004, peak })
    }
    v.tone({ type: 'sine', freq: 2092 * j, at: 0.19, dur: 0.12, attack: 0.004, peak: 0.06 })
  },
}

// --- diegetic cues ---------------------------------------------------------------

export const cueRecipes: Record<SoundCue, Recipe> = {
  // Sustained beam: sawtooth sweeping 1400→900 through a resonant bandpass
  // with fast vibrato, plus a soft noise sheen on the same sweep. ~750 ms.
  'phaser-fed': v => {
    const j = vary(0.04)
    const e = v.env(0.5, 0, 0.72, 0.02, 0.45)
    const bp = v.filter('bandpass', 1600 * j, 7, e)
    v.sweep(bp.frequency, 1600 * j, 1000 * j, 0, 0.6)
    const beam = v.osc('sawtooth', 1400 * j, bp, { stop: 0.75 })
    v.sweep(beam.frequency, 1400 * j, 900 * j, 0, 0.65)
    v.lfo(24, 28, beam.frequency)
    const sheen = v.env(0.12, 0, 0.7, 0.03, 0.4)
    const sheenBp = v.filter('bandpass', 1900 * j, 3, sheen)
    v.sweep(sheenBp.frequency, 1900 * j, 1100 * j, 0, 0.6)
    v.noise(sheenBp, { stop: 0.72 })
  },

  // Meaner, lower growl: square + sub-octave saw through a tanh shaper and a
  // closing lowpass, with a 43 Hz amplitude wobble for menace. ~520 ms.
  disruptor: v => {
    const j = vary(0.05)
    const e = v.env(0.5, 0, 0.5, 0.008, 0.18)
    const lp = v.filter('lowpass', 1400 * j, 1.2, e)
    v.sweep(lp.frequency, 1400 * j, 480 * j, 0, 0.42)
    const ws = v.shaper(4.5, lp)
    const pre = v.gain(0.8, ws)
    v.lfo(43, 0.22, pre.gain)
    const a = v.osc('square', 500 * j, pre, { stop: 0.52 })
    v.sweep(a.frequency, 500 * j, 220 * j, 0, 0.4)
    const b = v.osc('sawtooth', 250 * j, pre, { stop: 0.52 })
    v.sweep(b.frequency, 250 * j, 110 * j, 0, 0.4)
  },

  // Low tube thump at release, a mechanical snap, then a rising noise whoosh
  // (bandpass 350→2100 + playback-rate ramp) as the torpedo departs. ~640 ms.
  'torpedo-launch': v => {
    const j = vary(0.04)
    const thump = v.env(0.65, 0, 0.3, 0.005)
    const th = v.osc('sine', 130 * j, thump, { stop: 0.32 })
    v.sweep(th.frequency, 130 * j, 48 * j, 0, 0.12)
    const snap = v.env(0.18, 0, 0.04, 0.002)
    const snapBp = v.filter('bandpass', 2600, 1.5, snap)
    v.noise(snapBp, { stop: 0.06 })
    const whoosh = v.env(0.4, 0.02, 0.6, 0.15, 0.15)
    const whooshBp = v.filter('bandpass', 350 * j, 1.1, whoosh)
    v.sweep(whooshBp.frequency, 350 * j, 2100 * j, 0.02, 0.5)
    const n = v.noise(whooshBp, { at: 0.02, stop: 0.64, rate: 0.8 })
    v.sweep(n.playbackRate, 0.8, 1.4, 0.02, 0.5, 'lin')
  },

  // Sharp detonation: bright noise blast sweeping down + body thump + mid crack.
  'torpedo-hit': v => boom(v, 4200, 0.62, 0.35),

  // Same family, darker and a touch longer, no crack.
  'explosion-small': v => boom(v, 3000, 0.8, 0),

  // Ship destruction: pre-blast swell, huge downsweeping blast, two sub
  // thumps, a fluttering low rumble tail, and falling debris pings. ~2.6 s.
  'explosion-ship': v => {
    const swell = v.env(0.32, 0, 0.24, 0.17, 0.02)
    const swellLp = v.filter('lowpass', 750, 1, swell)
    v.noise(swellLp, { stop: 0.26 })

    const blast = v.env(0.95, 0.18, 2.1, 0.006, 0.12)
    const blastLp = v.filter('lowpass', 4800, 0.7, blast)
    v.sweep(blastLp.frequency, 4800, 110, 0.18, 1.9)
    v.noise(blastLp, { at: 0.18, stop: 2.32 })

    const sub1 = v.env(0.85, 0.18, 1.3, 0.008)
    const s1 = v.osc('sine', 64, sub1, { at: 0.18, stop: 1.5 })
    v.sweep(s1.frequency, 64, 34, 0.18, 0.9)
    const sub2 = v.env(0.4, 0.72, 0.9, 0.01)
    const s2 = v.osc('sine', 52, sub2, { at: 0.72, stop: 1.65 })
    v.sweep(s2.frequency, 52, 30, 0.72, 0.7)

    const rumble = v.env(0.5, 0.3, 2.3, 0.25, 0.4)
    const rumbleLp = v.filter('lowpass', 160, 0.6, rumble)
    const flutter = v.gain(1, rumbleLp)
    v.lfo(5.5, 0.3, flutter.gain)
    v.noise(flutter, { at: 0.3, stop: 2.62 })

    let at = 0.9
    for (const f of [1750, 1180, 790]) {
      at += rand(-0.06, 0.1)
      v.tone({ type: 'triangle', freq: f * vary(0.06), glideTo: f * 0.93, at, dur: 0.22, attack: 0.002, peak: 0.07 })
      at += 0.42
    }
  },

  // Energy on a forcefield: FM bell strike (inharmonic 2.76 ratio, index
  // collapsing 480→8 Hz) + a rising second partial + a spark of noise. ~450 ms.
  'shield-hit': v => {
    const j = vary(0.05)
    const ring = v.env(0.5, 0, 0.42, 0.002)
    const carrier = v.osc('sine', 520 * j, ring, { stop: 0.45 })
    v.fmod(carrier, 520 * j * 2.76, 480 * j, 8, 0, 0.32)
    const partial = v.env(0.16, 0, 0.3, 0.002)
    const p = v.osc('sine', 972 * j, partial, { stop: 0.33 })
    v.sweep(p.frequency, 972 * j, 1002 * j, 0, 0.3)
    const spark = v.env(0.14, 0, 0.05, 0.002)
    const sparkHp = v.filter('highpass', 3000, 0.7, spark)
    v.noise(sparkHp, { stop: 0.07 })
  },

  // Duller structural clank: low FM strike with a sagging fundamental and a
  // lowpassed thud — shorter and darker than shield-hit. ~310 ms.
  'hull-hit': v => {
    const j = vary(0.05)
    const clank = v.env(0.55, 0, 0.28, 0.002)
    const carrier = v.osc('sine', 175 * j, clank, { stop: 0.31 })
    v.sweep(carrier.frequency, 175 * j, 150 * j, 0, 0.25, 'lin')
    v.fmod(carrier, 245 * j, 170 * j, 4, 0, 0.18)
    const thud = v.env(0.4, 0, 0.14, 0.003)
    const thudLp = v.filter('lowpass', 380, 1, thud)
    v.noise(thudLp, { stop: 0.16 })
  },

  // Quiet doppler pass: bandpass noise rising 500→2300 then falling to 380,
  // with the playback rate sliding down through the pass. ~470 ms.
  'miss-whoosh': v => {
    const j = vary(0.06)
    const e = v.env(0.16, 0, 0.45, 0.1, 0.08)
    const bp = v.filter('bandpass', 500 * j, 1.4, e)
    v.sweep(bp.frequency, 500 * j, 2300 * j, 0, 0.16)
    v.rampExp(bp.frequency, 380 * j, 0.45)
    const n = v.noise(bp, { stop: 0.47, rate: 1.35 })
    v.sweep(n.playbackRate, 1.35, 0.75, 0, 0.45, 'lin')
  },

  // Sensor sweep: rising sine ping 600→2400 with two fading, shortening
  // echo repeats. ~760 ms.
  scan: v => {
    const j = vary(0.03)
    const pings: [number, number, number][] = [
      [0, 0.3, 0.24],
      [0.26, 0.14, 0.2],
      [0.52, 0.06, 0.17],
    ]
    for (const [at, peak, dur] of pings) {
      const e = v.env(peak, at, dur, 0.008)
      const o = v.osc('sine', 600 * j, e, { at, stop: at + dur + 0.02 })
      v.sweep(o.frequency, 600 * j, 2400 * j, at, dur * 0.9)
    }
  },

  // Friendly comms chirp: two soft sine sweeps that converge on the same
  // pitch (up 920→1380, then down 1720→1385 with a gentle warble). ~540 ms.
  hail: v => {
    const j = vary(0.03)
    v.tone({ type: 'sine', freq: 920 * j, glideTo: 1380 * j, dur: 0.24, attack: 0.02, peak: 0.24 })
    const b = v.tone({ type: 'sine', freq: 1720 * j, glideTo: 1385 * j, at: 0.24, dur: 0.3, attack: 0.02, hold: 0.12, peak: 0.22 })
    v.lfo(6, 12, b.frequency, { at: 0.24 })
  },

  // Tool ratchet: four fast high-Q noise ticks alternating between two
  // pitches, then a soft two-note "fixed" chime. ~490 ms.
  repair: v => {
    const j = vary(0.04)
    let at = 0
    for (const f of [2300, 1850, 2300, 1850]) {
      const tick = v.env(0.3, at, 0.04, 0.002)
      const tickBp = v.filter('bandpass', f * j, 9, tick)
      v.noise(tickBp, { at, stop: at + 0.06 })
      at += 0.07
    }
    v.tone({ type: 'triangle', freq: 1175 * j, at: 0.33, dur: 0.15, attack: 0.01, peak: 0.16 })
    v.tone({ type: 'triangle', freq: 1760 * j, at: 0.37, dur: 0.12, attack: 0.01, peak: 0.08 })
  },

  // Escape riser: detuned saw stack sweeping 220→880 with the chorus
  // widening and the lowpass opening, then a noise whoosh tail. ~1.3 s.
  'warp-out': v => {
    const j = vary(0.03)
    shimmerStack(v, {
      type: 'sawtooth',
      from: 220 * j,
      to: 880 * j,
      dur: 1.05,
      total: 1.25,
      lpFrom: 900,
      lpTo: 6500,
      peak: 0.4,
      attack: 0.25,
      hold: 0.55,
      spread: 9,
      spreadTo: 26,
    })
    const whoosh = v.env(0.28, 0.85, 0.45, 0.1)
    const whooshBp = v.filter('bandpass', 1200, 1.2, whoosh)
    v.sweep(whooshBp.frequency, 1200, 3800, 0.85, 0.35)
    v.noise(whooshBp, { at: 0.85, stop: 1.32 })
  },

  // Sector-map jump: statelier version — slower, lower stack with a quiet
  // fifth above, longer whoosh. ~1.55 s.
  'warp-travel': v => {
    const j = vary(0.03)
    shimmerStack(v, {
      type: 'sawtooth',
      from: 165 * j,
      to: 660 * j,
      dur: 1.3,
      total: 1.5,
      lpFrom: 700,
      lpTo: 5200,
      peak: 0.42,
      attack: 0.35,
      hold: 0.6,
      spread: 8,
      spreadTo: 20,
    })
    const fifth = v.env(0.13, 0.1, 1.3, 0.3, 0.5)
    const f = v.osc('triangle', 248 * j, fifth, { at: 0.1, stop: 1.42 })
    v.sweep(f.frequency, 248 * j, 990 * j, 0.1, 1.2)
    const whoosh = v.env(0.3, 1.05, 0.5, 0.12, 0.1)
    const whooshBp = v.filter('bandpass', 900, 1.2, whoosh)
    v.sweep(whooshBp.frequency, 900, 3000, 1.05, 0.4)
    v.noise(whooshBp, { at: 1.05, stop: 1.57 })
  },

  // Fading away: triangle stack sweeping down 720→175 under a closing
  // lowpass, chorus widening as it dissolves, with a faint noise wash. ~900 ms.
  cloak: v => {
    const j = vary(0.03)
    shimmerStack(v, {
      type: 'triangle',
      from: 720 * j,
      to: 175 * j,
      dur: 0.8,
      total: 0.9,
      lpFrom: 4200,
      lpTo: 260,
      peak: 0.38,
      attack: 0.05,
      hold: 0.35,
      spread: 10,
      spreadTo: 22,
    })
    const wash = v.env(0.1, 0, 0.8, 0.2)
    const washLp = v.filter('lowpass', 1200, 1, wash)
    v.sweep(washLp.frequency, 1200, 300, 0, 0.7)
    v.noise(washLp, { stop: 0.82 })
  },

  // The reverse: stack rising 185→740 as the lowpass opens (chorus focusing
  // = "solidifying"), plus a bright glint once fully visible. ~700 ms.
  decloak: v => {
    const j = vary(0.03)
    shimmerStack(v, {
      type: 'triangle',
      from: 185 * j,
      to: 740 * j,
      dur: 0.6,
      total: 0.7,
      lpFrom: 320,
      lpTo: 5000,
      peak: 0.36,
      attack: 0.03,
      hold: 0.3,
      spread: 18,
      spreadTo: 8,
    })
    v.tone({ type: 'sine', freq: 1480 * j, glideTo: 1570 * j, at: 0.5, dur: 0.18, attack: 0.01, peak: 0.1 })
  },

  // Docking clamps: low thud + short FM contact clank + latch click, then a
  // gentle two-note welcome chime. ~660 ms.
  dock: v => {
    const j = vary(0.04)
    const thud = v.env(0.55, 0, 0.25, 0.004)
    const t = v.osc('sine', 90 * j, thud, { stop: 0.27 })
    v.sweep(t.frequency, 90 * j, 52 * j, 0, 0.1)
    const clank = v.env(0.35, 0, 0.18, 0.002)
    const c = v.osc('sine', 240 * j, clank, { stop: 0.21 })
    v.fmod(c, 240 * j * 1.33, 200 * j, 6, 0, 0.12)
    const latch = v.env(0.2, 0.09, 0.03, 0.002)
    const latchBp = v.filter('bandpass', 3200, 2, latch)
    v.noise(latchBp, { at: 0.09, stop: 0.13 })
    v.tone({ type: 'triangle', freq: 880 * j, at: 0.3, dur: 0.18, attack: 0.012, peak: 0.15 })
    v.tone({ type: 'triangle', freq: 1318 * j, at: 0.42, dur: 0.22, attack: 0.012, peak: 0.13 })
  },
}

// --- stingers --------------------------------------------------------------------

export const stingerRecipes: Record<'victory' | 'defeat' | 'missionComplete', Recipe> = {
  // Triumphant rising fanfare: C-E-G-C-E in detuned saw pairs through a warm
  // lowpass, timpani-ish downbeat, vibrato blooming on the held top note. ~2 s.
  victory: v => {
    const lp = v.filter('lowpass', 2400, 0.7, v.out)
    const notes: [number, number, number][] = [
      [262, 0, 0.24],
      [330, 0.2, 0.24],
      [392, 0.4, 0.24],
      [523, 0.6, 0.3],
    ]
    for (const [f, at, dur] of notes) {
      note(v, lp, 'sawtooth', f, at, dur, 0.14, -7)
      note(v, lp, 'sawtooth', f, at, dur, 0.14, 7)
    }
    note(v, lp, 'sawtooth', 659, 0.88, 1.05, 0.15, -7)
    const top = note(v, lp, 'sawtooth', 659, 0.88, 1.05, 0.15, 7)
    v.lfo(5.5, 6, top.frequency, { at: 1.15 })
    const drum = v.env(0.35, 0, 0.5, 0.005)
    const d = v.osc('sine', 98, drum, { stop: 0.55 })
    v.sweep(d.frequency, 98, 62, 0, 0.3)
  },

  // Somber descent: A-F-D-A in dark sine/triangle pairs, the final low note
  // sagging a whole step as it dies. ~2.5 s.
  defeat: v => {
    const lp = v.filter('lowpass', 900, 0.6, v.out)
    const notes: [number, number, number][] = [
      [220, 0, 0.55],
      [175, 0.5, 0.55],
      [147, 1.0, 0.55],
    ]
    for (const [f, at, dur] of notes) {
      note(v, lp, 'sine', f, at, dur, 0.24)
      note(v, lp, 'triangle', f * 2.003, at, dur, 0.07)
    }
    const last = note(v, lp, 'sine', 110, 1.5, 1.0, 0.26)
    v.sweep(last.frequency, 110, 99, 1.5, 1.0, 'lin')
    const shade = note(v, lp, 'triangle', 220.7, 1.5, 1.0, 0.07)
    v.sweep(shade.frequency, 220.7, 198, 1.5, 1.0, 'lin')
  },

  // Bright resolved fanfare: G-C-E-G with a major chord shimmer under the
  // held note and a high sparkle ping — "mission accomplished". ~2.3 s.
  missionComplete: v => {
    const lp = v.filter('lowpass', 3200, 0.7, v.out)
    const notes: [number, number, number][] = [
      [392, 0, 0.22],
      [523, 0.18, 0.22],
      [659, 0.36, 0.24],
    ]
    for (const [f, at, dur] of notes) {
      note(v, lp, 'sawtooth', f, at, dur, 0.13, -6)
      note(v, lp, 'triangle', f * 2, at, dur, 0.05)
    }
    note(v, lp, 'sawtooth', 784, 0.6, 1.6, 0.14, -6)
    const top = note(v, lp, 'sawtooth', 784, 0.6, 1.6, 0.14, 6)
    v.lfo(5.2, 5, top.frequency, { at: 0.95 })
    note(v, lp, 'triangle', 988, 0.62, 1.35, 0.08)
    note(v, lp, 'triangle', 1175, 0.62, 1.35, 0.07)
    v.tone({ type: 'sine', freq: 2093, at: 0.78, dur: 0.3, attack: 0.01, peak: 0.06 })
  },
}
