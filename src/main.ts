// Composition root: wires the pure sim to the LCARS UI shell (DOM), the render
// layer (Phaser), and the transport (local AI for M1). This is the only module
// that owns mutable app state; everything else is render-from-state or pure.

import { createAudio } from './audio/engine'
import type { SoundCue } from './audio/api'
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
import { createEncounter, resolveRound } from './sim/encounter'
import { createRng, type Rng } from './sim/rng'
import { SaveError, deserializeGame, serializeGame } from './sim/save'
import { createShip } from './sim/ship'
import type { EncounterState, OrderSet } from './sim/types'
import { SKIRMISH_SHIPS } from './data/skirmish'
import { createHotseatTransport, type HotseatTransport } from './net/hotseat'
import type { SaveSlotInfo, Screen, SeatId, UICallbacks, ViewState } from './ui/api'
import { createShell } from './ui/shell'

// The game must be able to boot into a bare <body>: some hosting wrappers
// (e.g. the claude.ai artifact pipeline) sanitize empty elements out of the
// document, which deletes a static <div id="app"></div>.
function ensureRoot(): HTMLElement {
  let root = document.getElementById('app')
  if (!root) {
    root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)
  }
  return root
}

// Boot failures paint onto the page — a black screen with no message is the
// one unacceptable failure mode for a shareable single-file game.
function showBootError(message: string): void {
  const root = ensureRoot()
  root.innerHTML = ''
  const panel = document.createElement('pre')
  panel.style.cssText =
    'color:#cc6666;background:#000;padding:24px;margin:0;font:14px monospace;white-space:pre-wrap'
  panel.textContent = `STARSHIP COMMAND — BOOT FAILURE\n\n${message}\n\nTry a hard refresh; if it persists, file it with this text.`
  root.appendChild(panel)
}
window.addEventListener('error', (e) => {
  if (!document.querySelector('.lcars-shell')) showBootError(String(e.message ?? e.error))
})
window.addEventListener('unhandledrejection', (e) => {
  if (!document.querySelector('.lcars-shell')) showBootError(String(e.reason))
})

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

// --- hot-seat skirmish state (M2.5); campaign state above is untouched by it.
interface SkirmishSession {
  encounter: EncounterState
  rng: Rng
  shipIds: Record<SeatId, string>
  names: Record<SeatId, string>
  activeSeat: SeatId
  phase: 'orders' | 'handoff' | 'resolving'
  ordersA: OrderSet | null
  transport: HotseatTransport
}
let skirmish: SkirmishSession | null = null
let skirmishSetupOpen = false

// --- audio -------------------------------------------------------------------
const MUTE_KEY = 'starship-command-muted'
const audio = createAudio()
audio.setMuted(storageGet(MUTE_KEY) === '1')
// AudioContext needs a user gesture: unlock on any first interaction.
document.addEventListener('pointerdown', () => audio.unlock(), { capture: true })
document.addEventListener('keydown', () => audio.unlock(), { capture: true })

const VALID_CUES: ReadonlySet<string> = new Set<SoundCue>([
  'phaser-fed',
  'disruptor',
  'torpedo-launch',
  'torpedo-hit',
  'shield-hit',
  'hull-hit',
  'explosion-small',
  'explosion-ship',
  'miss-whoosh',
  'scan',
  'hail',
  'repair',
  'warp-out',
  'warp-travel',
  'cloak',
  'decloak',
  'dock',
])

function screen(): Screen {
  if (skirmish) return skirmish.phase === 'handoff' ? 'handoff' : 'skirmish'
  if (skirmishSetupOpen) return 'skirmish-setup'
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
  return {
    screen: screen(),
    game,
    saveSlots: saveSlots(),
    selectedSystemId,
    busy,
    muted: audio.isMuted(),
    skirmish: skirmish
      ? {
          encounter: skirmish.encounter,
          shipIds: { ...skirmish.shipIds },
          names: { ...skirmish.names },
          activeSeat: skirmish.activeSeat,
          round: skirmish.encounter.round,
        }
      : null,
  }
}

/** Push current state to UI + render + audio loops. Render is left alone mid-animation. */
function refresh(): void {
  shell.render(view())
  const s = screen()
  audio.setAmbient(s === 'sector' || s === 'encounter' || s === 'skirmish')
  audio.setRedAlert(
    (s === 'encounter' && game?.encounter?.status === 'active') ||
      (s === 'skirmish' && skirmish?.encounter.status === 'active'),
  )
  if (busy) return
  if (s === 'sector' && game) {
    render.showSector(game)
    render.setSelectedSystem(selectedSystemId)
  } else if (s === 'encounter' && game?.encounter) {
    render.showEncounter(game.encounter)
  } else if (s === 'skirmish' && skirmish) {
    // POV of whoever holds the console; public view while resolving.
    render.setPov(skirmish.phase === 'orders' ? skirmish.shipIds[skirmish.activeSeat] : null)
    render.showEncounter(skirmish.encounter)
  } else {
    // Menu, game-over, handoff: nothing on the viewport that could leak intel.
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
  onNewGame(seed, options) {
    const { state, log } = newGame(seed, options)
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
    audio.play('warp-travel')
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
    audio.play('dock')
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
    const status = game.encounter.status
    const resolvedBefore = game.missions.filter((m) => m.stage === 'resolved').length
    const { state, log } = concludeEncounter(game)
    game = state
    transport?.close()
    transport = null
    autosave()
    refresh()
    shell.appendLog(log)
    if (status === 'defeat') {
      audio.stingers.defeat()
    } else if (game.missions.filter((m) => m.stage === 'resolved').length > resolvedBefore) {
      audio.stingers.missionComplete()
    } else if (status === 'victory' || status === 'enemy-disabled' || status === 'enemy-withdrawn') {
      audio.stingers.victory()
    }
  },

  onMainMenu() {
    atMenu = true
    refresh()
  },

  onToggleMute() {
    audio.setMuted(!audio.isMuted())
    storageSet(MUTE_KEY, audio.isMuted() ? '1' : '0')
    refresh()
  },

  onUiBeep(kind) {
    audio.uiBeep(kind)
  },

  // --- hot-seat skirmish (M2.5) -----------------------------------------------

  onOpenSkirmishSetup() {
    if (skirmish || busy) return
    skirmishSetupOpen = true
    refresh()
  },

  onStartSkirmish(config) {
    if (skirmish || busy) return
    const optionA = SKIRMISH_SHIPS.find((o) => o.classId === config.shipClassA)
    const optionB = SKIRMISH_SHIPS.find((o) => o.classId === config.shipClassB)
    if (!optionA || !optionB) return
    const nameA = optionA.names[0]
    // Mirror matches get each side's alternate name so the log reads cleanly.
    const nameB = optionA.classId === optionB.classId ? optionB.names[1] : optionB.names[0]
    const rng = createRng(config.seed >>> 0)
    const shipA = createShip('ship-a', nameA, optionA.classId, { x: 0, y: 0 }, 0)
    const shipB = createShip('ship-b', nameB, optionB.classId, { x: 0, y: 0 }, 8)
    const encounter = createEncounter(shipA, shipB, rng)
    const hotseat = createHotseatTransport()
    skirmish = {
      encounter,
      rng,
      shipIds: { A: 'ship-a', B: 'ship-b' },
      names: { A: nameA, B: nameB },
      activeSeat: 'A',
      phase: 'orders',
      ordersA: null,
      transport: hotseat,
    }
    skirmishSetupOpen = false
    hotseat.onOrders(resolveSkirmishRound)
    refresh()
    shell.appendLog([
      `SKIRMISH — ${nameA} versus ${nameB}. Captain A has the console.`,
      'Orders are secret: hand off the console when prompted.',
    ])
  },

  onSkirmishOrders(orders) {
    if (!skirmish || busy || skirmish.phase !== 'orders') return
    if (skirmish.encounter.status !== 'active') return
    if (skirmish.activeSeat === 'A') {
      skirmish.ordersA = orders
      skirmish.activeSeat = 'B'
      skirmish.phase = 'handoff'
      refresh()
    } else {
      skirmish.phase = 'resolving'
      refresh()
      skirmish.transport.submitOpponentOrders(orders)
    }
  },

  onHandoffReady() {
    if (!skirmish || busy || skirmish.phase !== 'handoff') return
    skirmish.phase = 'orders'
    refresh()
  },

  onLeaveSkirmish() {
    // Also the BACK path from the setup screen, where no duel exists yet.
    skirmish?.transport.close()
    skirmish = null
    skirmishSetupOpen = false
    atMenu = true
    render.setPov(null)
    refresh()
  },
}

function resolveSkirmishRound(ordersB: OrderSet): void {
  const s = skirmish
  if (!s || !s.ordersA) return
  const ordersA = s.ordersA
  s.ordersA = null
  busy = true
  const { state: encounter, events } = resolveRound(s.encounter, [ordersA, ordersB], s.rng)
  s.encounter = encounter
  const lines = shell.eventsToLog(events, view())
  render.setPov(null) // both captains watch the replay: public view
  void render.animateRound(events, encounter).then(() => {
    busy = false
    if (!skirmish) return // duel abandoned mid-animation
    if (encounter.status === 'active') {
      // Next round: captain A takes the console again behind a handoff screen.
      skirmish.activeSeat = 'A'
      skirmish.phase = 'handoff'
    } else {
      skirmish.phase = 'resolving' // outcome overlay owns the screen now
      audio.stingers.victory()
    }
    refresh()
    shell.appendLog(lines)
  })
}

const shell = createShell(ensureRoot(), callbacks)

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
  onCue(cue) {
    if (VALID_CUES.has(cue)) audio.play(cue as SoundCue)
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
