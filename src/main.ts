// Composition root: wires the pure sim to the LCARS UI shell (DOM), the render
// layer (Phaser), and the transport (local AI for M1). This is the only module
// that owns mutable app state; everything else is render-from-state or pure.

import { getSystem } from './data/sectors'
import { createLocalAITransport } from './net/localAI'
import type { Transport } from './net/transport'
import { createRender } from './render/game'
import type { GameRender } from './render/api'
import {
  applyEncounterRound,
  concludeEncounter,
  dock,
  newGame,
  travelTo,
  type GameState,
} from './sim/game'
import { createRng, type Rng } from './sim/rng'
import { SaveError, deserializeGame, serializeGame } from './sim/save'
import type { OrderSet } from './sim/types'
import type { SaveSlotInfo, Screen, UICallbacks, ViewState } from './ui/api'
import { createShell } from './ui/shell'

const AUTOSAVE_SLOT = 0
const SLOT_COUNT = 4 // slot 0 = autosave, 1-3 manual
const slotKey = (slot: number) => `starship-command-save-${slot}`

// localStorage can be unavailable on file:// (the game ships as a double-click
// single HTML file) — degrade to no persistence instead of crashing.
function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // no persistence available
  }
}

let game: GameState | null = null
let atMenu = true
let selectedSystemId: string | null = null
let busy = false
let transport: Transport | null = null
let aiRng: Rng = createRng(0)
let render: GameRender

function screen(): Screen {
  if (atMenu || !game) return 'menu'
  if (game.mode === 'game-over') return 'game-over'
  return game.mode === 'encounter' ? 'encounter' : 'sector'
}

function saveSlots(): SaveSlotInfo[] {
  const slots: SaveSlotInfo[] = []
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    slots.push({ slot, label: slotLabel(slot) })
  }
  return slots
}

function slotLabel(slot: number): string | null {
  const json = storageGet(slotKey(slot))
  if (!json) return null
  try {
    const file = JSON.parse(json) as { stardate?: number; state?: GameState }
    const systemId = file.state?.galaxy?.currentSystemId
    const name = systemId ? getSystem(systemId).name : '?'
    return `SD ${file.stardate?.toFixed(1) ?? '?'} — ${name}`
  } catch {
    return 'CORRUPT DATA'
  }
}

function view(): ViewState {
  return { screen: screen(), game, saveSlots: saveSlots(), selectedSystemId, busy }
}

/** Push current state to UI + render. Render is left alone mid-animation. */
function refresh(): void {
  shell.render(view())
  if (busy) return
  const s = screen()
  if (s === 'sector' && game) {
    render.showSector(game)
    render.setSelectedSystem(selectedSystemId)
  } else if (s === 'encounter' && game?.encounter) {
    render.showEncounter(game.encounter)
  } else {
    render.hide()
  }
}

function autosave(): void {
  if (game && game.mode === 'sector') {
    storageSet(slotKey(AUTOSAVE_SLOT), serializeGame(game))
  }
}

function startEncounterSession(): void {
  if (!game?.encounter) return
  // AI decision RNG: derived deterministically from the game RNG position at
  // encounter start (saves cannot happen mid-encounter, so replays hold).
  aiRng = createRng((game.rngState ^ 0x51ed2701) >>> 0)
  transport?.close()
  transport = createLocalAITransport({
    getState: () => game?.encounter ?? null,
    aiShipId: 'enemy',
    rng: aiRng,
  })
  transport.onOrders(resolveRoundWith)
}

let pendingPlayerOrders: OrderSet | null = null

function resolveRoundWith(opponentOrders: OrderSet): void {
  if (!game?.encounter || !pendingPlayerOrders) return
  const playerOrders = pendingPlayerOrders
  pendingPlayerOrders = null
  const { state, events } = applyEncounterRound(game, [playerOrders, opponentOrders])
  game = state
  const lines = shell.eventsToLog(events, view())
  void render.animateRound(events, game.encounter!).then(() => {
    shell.appendLog(lines)
    busy = false
    refresh()
  })
}

const callbacks: UICallbacks = {
  onNewGame(seed) {
    const { state, log } = newGame(seed)
    game = state
    atMenu = false
    selectedSystemId = null
    autosave()
    refresh()
    shell.appendLog(log)
  },

  onContinue() {
    loadSlot(AUTOSAVE_SLOT)
  },

  onSaveSlot(slot) {
    if (!game || game.mode !== 'sector') return
    localStorage.setItem(slotKey(slot), serializeGame(game))
    shell.appendLog([`Game saved to slot ${slot}.`])
    refresh()
  },

  onLoadSlot(slot) {
    loadSlot(slot)
  },

  onExportSave() {
    if (!game) return
    const blob = new Blob([serializeGame(game)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `starship-command-sd${game.galaxy.stardate.toFixed(1)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  },

  onImportSave(file) {
    void file.text().then((text) => {
      try {
        adoptLoadedGame(deserializeGame(text))
        shell.appendLog(['Save file imported.'])
      } catch (err) {
        shell.appendLog([`IMPORT FAILED: ${err instanceof SaveError ? err.message : 'unreadable file'}`])
      }
    })
  },

  onTravel(systemId) {
    if (!game || busy || game.mode !== 'sector') return
    const { state, log } = travelTo(game, systemId)
    game = state
    selectedSystemId = null
    if (game.mode === 'encounter') {
      startEncounterSession()
    } else {
      autosave()
    }
    refresh()
    shell.appendLog(log)
  },

  onDock() {
    if (!game || game.mode !== 'sector') return
    const { state, log } = dock(game)
    game = state
    autosave()
    refresh()
    shell.appendLog(log)
  },

  onExecuteRound(orders) {
    if (!game?.encounter || busy || game.encounter.status !== 'active' || !transport) return
    busy = true
    pendingPlayerOrders = orders
    refresh()
    transport.sendOrders(orders)
  },

  onConcludeEncounter() {
    if (!game?.encounter || busy || game.encounter.status === 'active') return
    const { state, log } = concludeEncounter(game)
    game = state
    transport?.close()
    transport = null
    autosave()
    refresh()
    shell.appendLog(log)
  },

  onMainMenu() {
    atMenu = true
    refresh()
  },
}

const shell = createShell(document.getElementById('app')!, callbacks)

function loadSlot(slot: number): void {
  const json = localStorage.getItem(slotKey(slot))
  if (!json) return
  try {
    adoptLoadedGame(deserializeGame(json))
    shell.appendLog(['Game loaded. Welcome back, Captain.'])
  } catch (err) {
    shell.appendLog([`LOAD FAILED: ${err instanceof SaveError ? err.message : 'unreadable save'}`])
  }
}

function adoptLoadedGame(state: GameState): void {
  game = state
  atMenu = false
  selectedSystemId = null
  busy = false
  if (game.mode === 'encounter') startEncounterSession()
  refresh()
}

render = await createRender(shell.phaserParent, {
  onSystemSelected(systemId) {
    if (screen() !== 'sector' || busy) return
    selectedSystemId = systemId === selectedSystemId ? null : systemId
    refresh()
  },
})

refresh()

// Automation/debug handle: drives the same callback paths as the real UI.
// Used by the Playwright smoke test and for in-browser playtesting.
declare global {
  interface Window {
    __sc?: {
      view: () => ViewState
      callbacks: UICallbacks
      isBusy: () => boolean
    }
  }
}
window.__sc = { view, callbacks, isBusy: () => busy }
