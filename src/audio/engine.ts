// The audio engine behind the AudioEngine contract (api.ts). Lazy: the
// AudioContext is created on the first unlock() call (which the controller
// makes from a user-gesture handler); before that — and while muted — every
// method is a safe no-op. State setters (mute, ambient, red alert) are
// tracked pre-unlock and applied the moment the graph exists.
//
// Master chain:
//
//   one-shot voices ─→ ui / fx bus ─┐
//   ambient + klaxon ─→ loops bus ──┼─→ premix (0.5) ─→ compressor ─→ master ─→ out
//                                   ┘
//
// The compressor keeps an explosion + klaxon + beam overlap from clipping;
// the loops bus is ducked slightly under one-shot cues; the master gain is
// the mute control (post-compressor, ramped over 30 ms to avoid clicks).
// Loops keep running silently while muted — unmuting restores them in place.

import type { CreateAudio } from './api'
import { beepRecipes, cueRecipes, stingerRecipes } from './cues'
import { startAmbient, startRedAlert, type LoopHandle } from './loops'
import { voice, type Voice } from './synth'

const MASTER_LEVEL = 0.55
const PREMIX_LEVEL = 0.5
const UI_LEVEL = 0.8
const DUCK_LEVEL = 0.6

interface Graph {
  ctx: AudioContext
  ui: GainNode
  fx: GainNode
  loops: GainNode
  master: GainNode
}

const buildGraph = (muted: boolean): Graph | null => {
  if (typeof AudioContext === 'undefined') return null
  const ctx = new AudioContext()

  const premix = ctx.createGain()
  premix.gain.value = PREMIX_LEVEL
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.knee.value = 10
  comp.ratio.value = 4.5
  comp.attack.value = 0.004
  comp.release.value = 0.22
  const master = ctx.createGain()
  master.gain.value = muted ? 0 : MASTER_LEVEL
  premix.connect(comp)
  comp.connect(master)
  master.connect(ctx.destination)

  const bus = (level: number): GainNode => {
    const g = ctx.createGain()
    g.gain.value = level
    g.connect(premix)
    return g
  }
  return { ctx, ui: bus(UI_LEVEL), fx: bus(1), loops: bus(1), master }
}

export const createAudio: CreateAudio = () => {
  let g: Graph | null = null
  let muted = false
  let wantAmbient = false
  let wantRedAlert = false
  let ambient: LoopHandle | null = null
  let redAlert: LoopHandle | null = null
  let duckedUntil = 0

  const syncLoops = (): void => {
    if (!g) return
    if (wantAmbient && !ambient) ambient = startAmbient(g.ctx, g.loops)
    else if (!wantAmbient && ambient) {
      ambient.stop()
      ambient = null
    }
    if (wantRedAlert && !redAlert) redAlert = startRedAlert(g.ctx, g.loops)
    else if (!wantRedAlert && redAlert) {
      redAlert.stop()
      redAlert = null
    }
  }

  // Dip the loops bus under a one-shot cue, recovering 0.4 s after it ends.
  // Overlapping cues extend the dip rather than fighting over it.
  const duck = (dur: number): void => {
    if (!g) return
    const p = g.loops.gain
    const now = g.ctx.currentTime
    duckedUntil = Math.max(duckedUntil, now + dur)
    p.cancelScheduledValues(now)
    p.setValueAtTime(p.value, now)
    p.linearRampToValueAtTime(DUCK_LEVEL, now + 0.05)
    p.setValueAtTime(DUCK_LEVEL, duckedUntil)
    p.linearRampToValueAtTime(1, duckedUntil + 0.4)
  }

  const fire = (bus: 'ui' | 'fx', build: (v: Voice) => void, duckLoops: boolean): void => {
    if (!g || muted) return
    const cueVoice = voice(g.ctx, g[bus])
    build(cueVoice)
    const dur = cueVoice.finish()
    if (duckLoops) duck(dur)
  }

  return {
    unlock: () => {
      if (!g) {
        g = buildGraph(muted)
        syncLoops()
      }
      if (g && g.ctx.state === 'suspended') {
        void g.ctx.resume().catch(() => {})
      }
    },

    setMuted: m => {
      if (m === muted) return
      muted = m
      if (!g) return
      const p = g.master.gain
      const now = g.ctx.currentTime
      p.cancelScheduledValues(now)
      p.setValueAtTime(p.value, now)
      p.linearRampToValueAtTime(m ? 0 : MASTER_LEVEL, now + 0.03)
    },

    isMuted: () => muted,

    uiBeep: kind => fire('ui', beepRecipes[kind], false),

    play: cue => fire('fx', cueRecipes[cue], true),

    setAmbient: on => {
      wantAmbient = on
      syncLoops()
    },

    setRedAlert: on => {
      wantRedAlert = on
      syncLoops()
    },

    stingers: {
      victory: () => fire('fx', stingerRecipes.victory, true),
      defeat: () => fire('fx', stingerRecipes.defeat, true),
      missionComplete: () => fire('fx', stingerRecipes.missionComplete, true),
    },
  }
}
