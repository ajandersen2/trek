// Sustained loops: the low bridge-ambience bed and the red-alert klaxon.
// Handles start hot (fading in) and stop() fades out then tears the subgraph
// down. The engine guarantees at most one live handle per loop, so these
// don't need their own idempotence beyond a double-stop guard.

import { EPS, noiseBuffer, rand, vary, voice } from './synth'

export interface LoopHandle {
  stop(): void
}

// Ambience sits ~-25 dB under the one-shot cues (which peak 0.5–0.95): a
// non-fatiguing bed you stop noticing until it's gone. The lowpassed-noise
// gain looks high on paper but a 240 Hz lowpass discards most white-noise
// energy, so it lands well below the hum in practice.
const AMBIENT_BED = 0.05 // white noise → 240 Hz lowpass: engine-room rumble
const AMBIENT_HUM = 0.028 // 57.5 Hz sine: the deck plating hum
const AMBIENT_HUM_OCT = 0.01 // 115 Hz octave shading
const CHIRP_PEAK = 0.05 // occasional console blips

/**
 * Very quiet bridge hum: lowpassed noise rumble breathing slowly (±25% at
 * 0.07 Hz), a faint 57.5 Hz sine + octave, and a random soft console chirp
 * every 6–12 s. Loops seamlessly (looping white noise + continuous sines).
 */
export const startAmbient = (ctx: BaseAudioContext, dest: AudioNode): LoopHandle => {
  const t = ctx.currentTime
  const master = ctx.createGain()
  master.gain.setValueAtTime(EPS, t)
  master.gain.linearRampToValueAtTime(1, t + 1.2)
  master.connect(dest)

  const bed = ctx.createGain()
  bed.gain.value = AMBIENT_BED
  bed.connect(master)
  const bedLp = ctx.createBiquadFilter()
  bedLp.type = 'lowpass'
  bedLp.frequency.value = 240
  bedLp.Q.value = 0.5
  bedLp.connect(bed)
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuffer(ctx)
  noise.loop = true
  noise.connect(bedLp)
  noise.start(t)

  // slow "ship breathing" on the bed level
  const breath = ctx.createOscillator()
  breath.frequency.value = 0.07
  const breathDepth = ctx.createGain()
  breathDepth.gain.value = AMBIENT_BED * 0.25
  breath.connect(breathDepth)
  breathDepth.connect(bed.gain)
  breath.start(t)

  const mkHum = (freq: number, level: number): OscillatorNode => {
    const o = ctx.createOscillator()
    o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.value = level
    o.connect(g)
    g.connect(master)
    o.start(t)
    return o
  }
  const hum = mkHum(57.5, AMBIENT_HUM)
  const humOct = mkHum(115, AMBIENT_HUM_OCT)

  const sources = [noise, breath, hum, humOct]

  // Occasional soft console chirps — one of four tiny patterns, randomized.
  let stopped = false
  let timer: number | undefined
  const chirp = (): void => {
    const cv = voice(ctx, master)
    const j = vary(0.05)
    const kind = Math.floor(Math.random() * 4)
    if (kind === 0) {
      cv.tone({ type: 'triangle', freq: 1250 * j, dur: 0.07, attack: 0.005, peak: CHIRP_PEAK })
    } else if (kind === 1) {
      cv.tone({ type: 'triangle', freq: 1100 * j, dur: 0.06, attack: 0.005, peak: CHIRP_PEAK })
      cv.tone({ type: 'triangle', freq: 1450 * j, at: 0.07, dur: 0.06, attack: 0.005, peak: CHIRP_PEAK * 0.9 })
    } else if (kind === 2) {
      let at = 0
      for (const f of [1600, 1400, 1250]) {
        cv.tone({ type: 'sine', freq: f * j, at, dur: 0.05, attack: 0.004, peak: CHIRP_PEAK * 0.8 })
        at += 0.06
      }
    } else {
      cv.tone({ type: 'sine', freq: 850 * j, dur: 0.045, attack: 0.004, peak: CHIRP_PEAK * 0.7 })
    }
    cv.finish()
  }
  const schedule = (): void => {
    timer = setTimeout(() => {
      if (stopped) return
      chirp()
      schedule()
    }, rand(6, 12) * 1000)
  }
  schedule()

  return {
    stop: () => {
      if (stopped) return
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      const now = ctx.currentTime
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(Math.max(master.gain.value, EPS), now)
      master.gain.exponentialRampToValueAtTime(EPS, now + 0.5)
      for (const s of sources) s.stop(now + 0.55)
      noise.onended = () => master.disconnect()
    },
  }
}

// Klaxon: ~820 ms period, alternating a rising "whoop" (445→668) with a
// lower falling answer (334→297), each a saw + sine pair through its own
// lowpass. Atmospheric, not ear-splitting — it sits on the loops bus, which
// the engine ducks under one-shot cues.
const KLAXON_PERIOD = 0.82

export const startRedAlert = (ctx: BaseAudioContext, dest: AudioNode): LoopHandle => {
  const t = ctx.currentTime
  const bus = ctx.createGain()
  bus.gain.setValueAtTime(EPS, t)
  bus.gain.linearRampToValueAtTime(1, t + 0.15)
  bus.connect(dest)

  const cycle = (at: number): void => {
    const kv = voice(ctx, bus, at)
    // phase A — rising whoop
    const envA = kv.env(0.2, 0, 0.37, 0.015, 0.18)
    const lpA = kv.filter('lowpass', 1350, 1, envA)
    const sawA = kv.osc('sawtooth', 445, lpA, { stop: 0.4 })
    kv.sweep(sawA.frequency, 445, 668, 0, 0.34)
    const sinA = kv.osc('sine', 445, envA, { stop: 0.4 })
    kv.sweep(sinA.frequency, 445, 668, 0, 0.34)
    // phase B — lower answer
    const envB = kv.env(0.17, 0.41, 0.36, 0.015, 0.16)
    const lpB = kv.filter('lowpass', 950, 1, envB)
    const sawB = kv.osc('sawtooth', 334, lpB, { at: 0.41, stop: 0.79 })
    kv.sweep(sawB.frequency, 334, 297, 0.41, 0.33)
    const sinB = kv.osc('sine', 334, envB, { at: 0.41, stop: 0.79 })
    kv.sweep(sinB.frequency, 334, 297, 0.41, 0.33)
    kv.finish()
  }

  // Lookahead scheduler: keep ~1.2 s of cycles queued so timer jitter (or a
  // busy main thread) never gaps the alarm.
  let next = t + 0.05
  let stopped = false
  let timer: number | undefined
  const pump = (): void => {
    if (stopped) return
    while (next < ctx.currentTime + 1.2) {
      cycle(next)
      next += KLAXON_PERIOD
    }
    timer = setTimeout(pump, 250)
  }
  pump()

  return {
    stop: () => {
      if (stopped) return
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      const now = ctx.currentTime
      bus.gain.cancelScheduledValues(now)
      bus.gain.setValueAtTime(Math.max(bus.gain.value, EPS), now)
      bus.gain.exponentialRampToValueAtTime(EPS, now + 0.2)
      // already-queued cycles play into the silenced bus and self-clean;
      // drop the bus itself once the last of them has ended
      setTimeout(() => bus.disconnect(), 2500)
    },
  }
}
