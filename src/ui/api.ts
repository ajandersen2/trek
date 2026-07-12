// Contract between the game controller (main.ts) and the LCARS UI shell.
// The UI is DOM-only: it renders ViewState, keeps its own order-draft widget
// state, and reports player intent through UICallbacks. It never mutates game
// state and never imports Phaser or src/render.

import type { GameState } from '../sim/game'
import type { EncounterState, OrderSet, RoundEvent } from '../sim/types'

export type Screen =
  | 'menu'
  | 'sector'
  | 'encounter'
  | 'game-over'
  | 'skirmish-setup'
  | 'skirmish' // order-taking for the active seat
  | 'handoff' // board hidden; pass the console to the other captain

export type SeatId = 'A' | 'B'

/** Hot-seat 1v1 duel (M2.5). Campaign state is untouched while this is set. */
export interface SkirmishView {
  encounter: EncounterState
  /** Ship ids per seat: seat A is encounter.ships[0], B is ships[1]. */
  shipIds: Record<SeatId, string>
  names: Record<SeatId, string>
  /** Whose orders are being taken (skirmish screen) or who is next (handoff). */
  activeSeat: SeatId
  round: number
}

export interface SaveSlotInfo {
  slot: number
  /** Human label like "SD 47502.3 — Tellun", or null when the slot is empty. */
  label: string | null
}

export interface ViewState {
  screen: Screen
  /** Null only on the menu screen before any game exists. */
  game: GameState | null
  saveSlots: SaveSlotInfo[]
  /** Sector-map selection (set by clicking the map); null = nothing selected. */
  selectedSystemId: string | null
  /** True while a round is animating: order controls and EXECUTE lock. */
  busy: boolean
  /** Audio mute state (header toggle reflects it). */
  muted: boolean
  /** Non-null while a hot-seat duel is running (screens skirmish-setup/skirmish/handoff). */
  skirmish: SkirmishView | null
}

export interface SkirmishConfig {
  seed: number
  shipClassA: string
  shipClassB: string
}

/** UI feedback sounds; routed to the audio engine by the controller. */
export type UiBeepKind = 'tap' | 'confirm' | 'deny' | 'execute'

export interface UICallbacks {
  /** Start a new campaign with the chosen difficulty. */
  onNewGame(seed: number, options: { permadeath: boolean }): void
  /** Load the autosave (slot 0). Only offered when it exists. */
  onContinue(): void
  onSaveSlot(slot: number): void
  onLoadSlot(slot: number): void
  onExportSave(): void
  onImportSave(file: File): void
  onTravel(systemId: string): void
  onDock(): void
  /** Player committed the round. `orders` is the complete player OrderSet. */
  onExecuteRound(orders: OrderSet): void
  /** Player acknowledged the battle outcome overlay. */
  onConcludeEncounter(): void
  onMainMenu(): void
  onToggleMute(): void
  /** Fire-and-forget UI sound feedback; call on every button interaction. */
  onUiBeep(kind: UiBeepKind): void

  // --- hot-seat skirmish (M2.5) ---
  /** Open the skirmish setup screen (from the menu). */
  onOpenSkirmishSetup(): void
  /** Begin a duel with the chosen ships. */
  onStartSkirmish(config: SkirmishConfig): void
  /** The active seat committed its hidden orders. */
  onSkirmishOrders(orders: OrderSet): void
  /** The handoff screen's READY button: the next captain has the console. */
  onHandoffReady(): void
  /** Leave the duel (outcome screen or mid-match retreat to menu). */
  onLeaveSkirmish(): void
}

export interface Shell {
  /** Idempotent full-view update. Called on every state change. */
  render(view: ViewState): void
  /** Append lines to the captain's log ticker (bottom bar). */
  appendLog(lines: string[]): void
  /** Convert resolved-round events into human log lines (UI voice, not sim). */
  eventsToLog(events: RoundEvent[], view: ViewState): string[]
  /** The element the Phaser canvas mounts into (center viewport). */
  readonly phaserParent: HTMLElement
}

export type CreateShell = (root: HTMLElement, callbacks: UICallbacks) => Shell
