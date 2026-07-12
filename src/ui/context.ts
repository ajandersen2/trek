// Shared shell context passed to the screen builders.

import type { SeatId, UICallbacks } from './api'
import type { OrderDraft } from './draft'

/** Widget state the shell owns across render() calls (never sim state). */
export interface UiState {
  /** Menu seed field text, preserved across idempotent re-renders. */
  seedText: string
  /** Menu difficulty pick. Locked design default: permadeath on. */
  permadeath: boolean
  /** In-progress order draft for the current encounter round. */
  draft: OrderDraft | null
  /** Identity of the encounter the draft belongs to (throttle carries within it). */
  encounterKey: string | null
  /** Identity of the round the draft belongs to (draft resets when it changes). */
  roundKey: string | null
  /** Full-screen overlay currently open (captain's-log archive / how-to-play). */
  overlay: 'log' | 'help' | null
  /** Skirmish setup seed field text (blank = fresh random seed on every ENGAGE/REMATCH). */
  skirmishSeedText: string
  /** Skirmish setup class picks per seat; retained after ENGAGE as the REMATCH config. */
  skirmishClassA: string
  skirmishClassB: string
  /**
   * Per-seat throttle memory for the running duel (parity with the campaign's
   * throttle carry). Survives handoff screens, dropped when the duel ends.
   */
  skirmishThrottle: Record<SeatId, number> | null
  /**
   * Round key whose skirmish orders were already committed. Locks the rails on
   * the frame the controller renders between accepting orders and the replay
   * finishing; cleared automatically when the round key moves on.
   */
  skirmishSent: string | null
}

export interface ShellCtx {
  callbacks: UICallbacks
  ui: UiState
  /** Re-render the last view: widget/draft state changed, controller state did not. */
  rerender(): void
}

/** What a screen builder hands back to the shell to mount. */
export interface ScreenContent {
  left: HTMLElement[]
  right: HTMLElement[]
  overlay: HTMLElement | null
  overlayMode?: 'opaque' | 'dim'
}
