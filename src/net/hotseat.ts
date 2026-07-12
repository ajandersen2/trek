// Hot-seat transport: the "remote" captain is a second human at the same
// console. The controller runs the hidden-order handoff flow and feeds the
// second captain's committed orders in through submitOpponentOrders; from the
// game loop's perspective this behaves exactly like a peer whose packet just
// arrived (which is what M6's WebRTC transport will actually be).

import type { OrderSet } from '../sim/types'
import type { Transport } from './transport'

export interface HotseatTransport extends Transport {
  /** The second local captain committed their orders for this round. */
  submitOpponentOrders(orders: OrderSet): void
}

export function createHotseatTransport(): HotseatTransport {
  let handler: ((orders: OrderSet) => void) | null = null
  let pending: OrderSet | null = null
  let closed = false
  return {
    sendOrders(): void {
      // The local captain's orders never cross a wire in hot-seat.
    },
    onOrders(h): void {
      handler = h
      if (pending) {
        const p = pending
        pending = null
        queueMicrotask(() => {
          if (!closed) handler?.(p)
        })
      }
    },
    submitOpponentOrders(orders): void {
      if (closed) return
      if (handler) {
        const deliver = handler
        queueMicrotask(() => {
          if (!closed) deliver(orders)
        })
      } else {
        pending = orders
      }
    },
    joinRoom(): Promise<void> {
      return Promise.resolve()
    },
    close(): void {
      closed = true
      handler = null
      pending = null
    },
  }
}
