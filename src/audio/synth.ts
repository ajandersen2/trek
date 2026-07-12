// Tiny synthesis toolkit over the Web Audio API. Everything the cue recipes
// need — enveloped gains, swept oscillators, filtered noise, FM strikes,
// waveshaping, LFOs — built around a per-cue "voice" that tracks its own
// lifetime and tears its node subgraph down when the last source ends, so a
// long session never leaks nodes.
//
// Presentation layer only: bare Math.random is fine here (never in src/sim).

/** Exponential ramps can never reach 0 — this is our "silent" floor (-80 dB). */
export const EPS = 0.0001

/** ±pct random multiplier — micro-variation so repeated cues don't sound machine-gun identical. */
export const vary = (pct: number): number => 1 + (Math.random() * 2 - 1) * pct

export const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo)

// --- shared noise buffer -----------------------------------------------------

// One 2 s white-noise buffer per context, shared by every cue. Looping white
// noise is seamless (the wrap point is just more noise), and any color we need
// is carved out of it with biquads at play time.
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()

export const noiseBuffer = (ctx: BaseAudioContext): AudioBuffer => {
  let buf = noiseBuffers.get(ctx)
  if (!buf) {
    const len = Math.floor(ctx.sampleRate * 2)
    buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    noiseBuffers.set(ctx, buf)
  }
  return buf
}

// --- waveshaper curves -------------------------------------------------------

// Normalized tanh saturation curve, cached per drive amount.
const shaperCurves = new Map<number, Float32Array<ArrayBuffer>>()

const shaperCurve = (drive: number): Float32Array<ArrayBuffer> => {
  let curve = shaperCurves.get(drive)
  if (!curve) {
    curve = new Float32Array(257)
    const norm = Math.tanh(drive)
    for (let i = 0; i < 257; i++) {
      curve[i] = Math.tanh(drive * (i / 128 - 1)) / norm
    }
    shaperCurves.set(drive, curve)
  }
  return curve
}

// --- voice -------------------------------------------------------------------

export interface ToneSpec {
  type: OscillatorType
  freq: number
  /** Pitch glide target, reached at `at + dur` (exponential unless glideCurve: 'lin'). */
  glideTo?: number
  glideCurve?: 'exp' | 'lin'
  detune?: number
  /** Onset, seconds from voice start (default 0). */
  at?: number
  /** Total sounding length — the envelope hits silence at `at + dur`. */
  dur: number
  attack?: number
  /** Seconds held at peak after the attack before the decay (default 0 = percussive). */
  hold?: number
  peak: number
  dest?: AudioNode
}

export interface Voice {
  readonly ctx: BaseAudioContext
  /** Absolute start time; all voice methods take times relative to this. */
  readonly t0: number
  /** Per-voice output gain, pre-connected to the bus; disconnected on cleanup. */
  readonly out: GainNode
  /** Enveloped gain: 0 →(attack)→ peak →(hold)→ exponential decay to silence at `at + dur`. */
  env(peak: number, at: number, dur: number, attack?: number, hold?: number, dest?: AudioNode): GainNode
  /** Flat utility gain. */
  gain(value: number, dest?: AudioNode): GainNode
  /** Oscillator started at `at`; stopped at `stop` if given, else at voice end. */
  osc(type: OscillatorType, freq: number, dest: AudioNode, o?: { at?: number, stop?: number, detune?: number }): OscillatorNode
  /** Looping white-noise source (random buffer offset per shot for variation). */
  noise(dest: AudioNode, o?: { at?: number, stop?: number, rate?: number }): AudioBufferSourceNode
  filter(type: BiquadFilterType, freq: number, q: number, dest: AudioNode): BiquadFilterNode
  /** tanh saturator for growly, distorted edges. */
  shaper(drive: number, dest: AudioNode): WaveShaperNode
  /** Enveloped oscillator in one call — the workhorse for beeps and note phrases. */
  tone(spec: ToneSpec): OscillatorNode
  /** Schedule param: anchor at `from`, ramp to `to` over `dur` starting at `at`. */
  sweep(param: AudioParam, from: number, to: number, at: number, dur: number, curve?: 'exp' | 'lin'): void
  /** Append an extra exponential ramp segment (for multi-point sweeps). */
  rampExp(param: AudioParam, to: number, at: number): void
  /** Sine LFO into a param (vibrato/tremolo); auto-stopped when the voice ends. */
  lfo(rate: number, depth: number, target: AudioParam, o?: { at?: number }): void
  /** FM strike: sine modulator at `mfreq` into `carrier.frequency`, index decaying `from → to` Hz. */
  fmod(carrier: OscillatorNode, mfreq: number, from: number, to: number, at: number, dur: number): void
  /** Extend the voice lifetime to at least `t` seconds. */
  until(t: number): void
  /** Call once after building: stops open-ended sources, wires cleanup, returns duration (s). */
  finish(): number
}

/**
 * Create a voice routed into `dest`. `startAt` is an absolute context time
 * (defaults to now + 10 ms of scheduling headroom).
 */
export const voice = (ctx: BaseAudioContext, dest: AudioNode, startAt?: number): Voice => {
  const t0 = startAt ?? ctx.currentTime + 0.01
  const out = ctx.createGain()
  out.connect(dest)

  const open: AudioScheduledSourceNode[] = [] // stopped at finish()
  let lastTimed: AudioScheduledSourceNode | null = null
  let lastStop = t0
  let endAt = t0

  const register = (node: AudioScheduledSourceNode, stopAt: number | null): void => {
    if (stopAt === null) {
      open.push(node)
      return
    }
    node.stop(stopAt)
    if (stopAt >= lastStop) {
      lastStop = stopAt
      lastTimed = node
    }
    if (stopAt > endAt) endAt = stopAt
  }

  const v: Voice = {
    ctx,
    t0,
    out,

    env: (peak, at, dur, attack = 0.006, hold = 0, dest2 = out) => {
      const g = ctx.createGain()
      g.connect(dest2)
      const t = t0 + at
      const a = Math.min(attack, dur * 0.5)
      const h = Math.min(hold, dur - a - 0.005)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(peak, t + a)
      if (h > 0) g.gain.setValueAtTime(peak, t + a + h)
      g.gain.exponentialRampToValueAtTime(EPS, t + dur)
      return g
    },

    gain: (value, dest2 = out) => {
      const g = ctx.createGain()
      g.gain.value = value
      g.connect(dest2)
      return g
    },

    osc: (type, freq, dest2, o = {}) => {
      const node = ctx.createOscillator()
      node.type = type
      node.frequency.value = freq
      if (o.detune !== undefined) node.detune.value = o.detune
      node.connect(dest2)
      node.start(t0 + (o.at ?? 0))
      register(node, o.stop !== undefined ? t0 + o.stop : null)
      return node
    },

    noise: (dest2, o = {}) => {
      const node = ctx.createBufferSource()
      node.buffer = noiseBuffer(ctx)
      node.loop = true
      if (o.rate !== undefined) node.playbackRate.value = o.rate
      node.connect(dest2)
      node.start(t0 + (o.at ?? 0), Math.random() * 1.5)
      register(node, o.stop !== undefined ? t0 + o.stop : null)
      return node
    },

    filter: (type, freq, q, dest2) => {
      const node = ctx.createBiquadFilter()
      node.type = type
      node.frequency.value = freq
      node.Q.value = q
      node.connect(dest2)
      return node
    },

    shaper: (drive, dest2) => {
      const node = ctx.createWaveShaper()
      node.curve = shaperCurve(drive)
      node.oversample = '2x'
      node.connect(dest2)
      return node
    },

    tone: spec => {
      const at = spec.at ?? 0
      const g = v.env(spec.peak, at, spec.dur, spec.attack, spec.hold, spec.dest)
      const node = v.osc(spec.type, spec.freq, g, {
        at,
        stop: at + spec.dur + 0.02,
        detune: spec.detune,
      })
      if (spec.glideTo !== undefined) {
        v.sweep(node.frequency, spec.freq, spec.glideTo, at, spec.dur, spec.glideCurve ?? 'exp')
      }
      return node
    },

    sweep: (param, from, to, at, dur, curve = 'exp') => {
      const t = t0 + at
      if (curve === 'exp') {
        param.setValueAtTime(Math.max(from, EPS), t)
        param.exponentialRampToValueAtTime(Math.max(to, EPS), t + dur)
      } else {
        param.setValueAtTime(from, t)
        param.linearRampToValueAtTime(to, t + dur)
      }
    },

    rampExp: (param, to, at) => {
      param.exponentialRampToValueAtTime(Math.max(to, EPS), t0 + at)
    },

    lfo: (rate, depth, target, o = {}) => {
      const node = ctx.createOscillator()
      node.frequency.value = rate
      const scale = ctx.createGain()
      scale.gain.value = depth
      node.connect(scale)
      scale.connect(target)
      node.start(t0 + (o.at ?? 0))
      register(node, null)
    },

    fmod: (carrier, mfreq, from, to, at, dur) => {
      const mod = ctx.createOscillator()
      mod.frequency.value = mfreq
      const depth = ctx.createGain()
      depth.gain.setValueAtTime(Math.max(from, EPS), t0 + at)
      depth.gain.exponentialRampToValueAtTime(Math.max(to, EPS), t0 + at + dur)
      mod.connect(depth)
      depth.connect(carrier.frequency)
      mod.start(t0 + at)
      register(mod, t0 + at + dur + 0.05)
    },

    until: t => {
      if (t0 + t > endAt) endAt = t0 + t
    },

    finish: () => {
      const openStop = endAt + 0.03
      for (const s of open) s.stop(openStop)
      const last = open.length > 0 ? open[open.length - 1] : lastTimed
      if (last) {
        last.onended = () => out.disconnect()
      } else {
        out.disconnect()
      }
      return (open.length > 0 ? openStop : endAt) - t0
    },
  }

  return v
}
