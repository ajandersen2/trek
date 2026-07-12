// Local-AI transport: the "opponent" is the sim's Klingon AI running in-process.
// From the game controller's point of view this is indistinguishable from a
// remote captain: send our orders, receive theirs.

import { klingonAI } from '../sim/ai'
import type { Rng } from '../sim/rng'
import type { EncounterState, OrderSet } from '../sim/types'
import type { Transport } from './transport'

export interface LocalAIOptions {
  /** Current encounter state (the AI decides from the same state the player saw). */
  getState: () => EncounterState | null
  /** AI ship id in that encounter. */
  aiShipId: string
  /**
   * RNG for AI decisions. Owned by the controller; created deterministically at
   * encounter start so full-game replays stay reproducible.
   */
  rng: Rng
}

export function createLocalAITransport(options: LocalAIOptions): Transport {
  let handler: ((orders: OrderSet) => void) | null = null
  let closed = false
  return {
    sendOrders(): void {
      if (closed) return
      const state = options.getState()
      if (!state || !handler) return
      const aiOrders = klingonAI(state, options.aiShipId, options.rng)
      // Deliver asynchronously, like a real transport would.
      const deliver = handler
      queueMicrotask(() => {
        if (!closed) deliver(aiOrders)
      })
    },
    onOrders(h): void {
      handler = h
    },
    joinRoom(): Promise<void> {
      return Promise.resolve()
    },
    close(): void {
      closed = true
      handler = null
    },
  }
}
