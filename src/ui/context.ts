// Shared shell context passed to the screen builders.

import type { UICallbacks } from './api'
import type { OrderDraft } from './draft'

/** Widget state the shell owns across render() calls (never sim state). */
export interface UiState {
  /** Menu seed field text, preserved across idempotent re-renders. */
  seedText: string
  /** In-progress order draft for the current encounter round. */
  draft: OrderDraft | null
  /** Identity of the encounter the draft belongs to (throttle carries within it). */
  encounterKey: string | null
  /** Identity of the round the draft belongs to (draft resets when it changes). */
  roundKey: string | null
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
