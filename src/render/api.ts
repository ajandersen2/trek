// Contract between the game controller (main.ts) and the Phaser render layer.
// The render layer draws state and animates round events; it emits map-selection
// intent only. It never mutates sim state and never imports src/ui.

import type { GameState } from '../sim/game'
import type { EncounterState, RoundEvent } from '../sim/types'

export interface RenderCallbacks {
  /** Player clicked a star system on the sector map. */
  onSystemSelected(systemId: string): void
  /**
   * Sound cue emitted at the matching moment of the round replay (beam drawn,
   * torpedo impact, cloak shimmer...). Cue names are src/audio SoundCue values;
   * the controller routes them. Optional: rendering must work without it.
   */
  onCue?(cue: string): void
}

export interface GameRender {
  /** Show the sector map for the current game state (ship marker, lanes, visited). */
  showSector(state: GameState): void
  /** Highlight the selected system (null clears). */
  setSelectedSystem(systemId: string | null): void
  /** Show the tactical board for an encounter, no animation (round start / load). */
  showEncounter(state: EncounterState): void
  /**
   * Animate one resolved round sequentially (moves, beams, torpedoes, hits),
   * ending on finalState's positions. Resolves when the animation completes.
   */
  animateRound(events: RoundEvent[], finalState: EncounterState): Promise<void>
  /** Blank the viewport (menu / game-over screens own the center). */
  hide(): void
  /**
   * Point of view for information hiding (hot-seat): the ship whose captain is
   * looking at the board. The POV ship renders as a translucent ghost when
   * cloaked; all other cloaked ships are hidden entirely. null = public view
   * (no ghosts at all — used while both captains watch a replay together).
   * Until first called, defaults to the encounter's playerShipId (campaign).
   */
  setPov(shipId: string | null): void
}

export type CreateRender = (
  parent: HTMLElement,
  callbacks: RenderCallbacks,
) => Promise<GameRender>
