// Transport interface: how a captain's orders reach the other captain.
// The sim never imports anything from this directory. Implementations:
// local AI (M1), hotseat (M2.5), PeerJS WebRTC (M6), WebSocket relay (future).

import type { OrderSet } from '../sim/types'

export interface Transport {
  /** Submit the local captain's orders for the current round. */
  sendOrders(orders: OrderSet): void
  /** Handler for the opposing captain's orders (called once per round). */
  onOrders(handler: (orders: OrderSet) => void): void
  /** Join a match. Local implementations resolve immediately. */
  joinRoom(roomId: string): Promise<void>
  /** Tear down (peer connections, listeners). */
  close(): void
}
