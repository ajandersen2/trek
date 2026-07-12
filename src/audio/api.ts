// Contract for the audio engine. All sound is synthesized with the Web Audio
// API at runtime — no audio files, no external requests (the game ships as a
// single HTML file). The engine is presentation-layer: nothing in src/sim may
// import it, and it never touches game state.

export type SoundCue =
  | 'phaser-fed' // Federation phaser beam
  | 'disruptor' // Klingon disruptor
  | 'torpedo-launch'
  | 'torpedo-hit'
  | 'shield-hit' // energy absorbed by shields
  | 'hull-hit' // metallic structural hit
  | 'explosion-small'
  | 'explosion-ship' // ship destruction
  | 'miss-whoosh'
  | 'scan' // sensor sweep ping
  | 'hail' // comms chirp
  | 'repair'
  | 'warp-out' // in-combat escape
  | 'warp-travel' // sector-map jump
  | 'cloak' // shimmer down
  | 'decloak' // shimmer up
  | 'dock'

export type UiBeep = 'tap' | 'confirm' | 'deny' | 'execute'

export interface AudioEngine {
  /**
   * Call from any user-gesture handler (click) — creates/resumes the
   * AudioContext. Safe to call repeatedly; cheap after the first time.
   */
  unlock(): void
  setMuted(muted: boolean): void
  isMuted(): boolean
  /** Short LCARS console feedback for button presses. */
  uiBeep(kind: UiBeep): void
  /** One-shot diegetic cues, fired in sync with the tactical replay. */
  play(cue: SoundCue): void
  /** Low bridge ambience loop (starts/stops idempotently). */
  setAmbient(on: boolean): void
  /** Two-tone red-alert klaxon loop (starts/stops idempotently). */
  setRedAlert(on: boolean): void
  stingers: {
    victory(): void
    defeat(): void
    missionComplete(): void
  }
}

export type CreateAudio = () => AudioEngine
