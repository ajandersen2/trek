// LCARS shell: owns the DOM chrome (frame, header, captain's log) and renders
// one of the four screens into it from ViewState. Implements the Shell contract
// in api.ts — reads sim state, emits player intent via UICallbacks, mutates
// nothing that belongs to the sim.

import './lcars.css'

import { getMissionDef } from '../data/missions'
import { getSystem } from '../data/sectors'
import type { MissionRecord } from '../sim/game'
import { powerBudget, totalAllocated } from '../sim/power'
import type { CreateShell, ViewState } from './api'
import type { ScreenContent, ShellCtx, UiState } from './context'
import { buildOrders, newDraft } from './draft'
import { btn, el, setBeeper } from './dom'
import { eventsToLog, lineClass } from './log'
import { helpOverlay, logOverlay } from './overlays'
import { encounterScreen } from './screens/encounter'
import { gameOverScreen } from './screens/gameover'
import { menuScreen } from './screens/menu'
import { sectorScreen } from './screens/sector'

const MAX_LOG_LINES = 200

// Static chrome. Dynamic regions are tagged data-lcars and filled per render.
const SKELETON = `
<div class="lcars-shell" data-lcars="shell">
  <div class="lcars-spine">
    <div class="spine-elbow-top"></div>
    <div class="spine-mid">
      <div class="spine-strip">
        <i class="strip-seg seg-a"></i>
        <i class="strip-seg seg-b"></i>
        <i class="strip-seg seg-c"></i>
        <i class="strip-seg seg-d"></i>
      </div>
      <div class="spine-panels" data-lcars="left"></div>
    </div>
    <div class="spine-elbow-bottom"><i class="scoop"></i></div>
  </div>
  <header class="lcars-header">
    <div class="hdr-title">STARSHIP COMMAND</div>
    <i class="hdr-sep sep-slate"></i>
    <div class="hdr-readout">
      <span class="lbl">STARDATE</span>
      <span class="val" data-lcars="stardate">—</span>
    </div>
    <i class="hdr-sep sep-lavender"></i>
    <div class="hdr-readout">
      <span class="lbl">SYSTEM</span>
      <span class="val" data-lcars="system">—</span>
    </div>
    <i class="hdr-sep sep-gold"></i>
    <div class="hdr-readout hdr-mission">
      <span class="lbl">MISSION</span>
      <span class="val" data-lcars="mission">STANDBY</span>
    </div>
    <div class="hdr-alert">RED ALERT</div>
    <div class="hdr-ctl" data-lcars="ctl"></div>
    <i class="hdr-tail"></i>
    <i class="hdr-cap"></i>
  </header>
  <main class="lcars-center">
    <div class="phaser-host" data-lcars="phaser"></div>
    <div class="center-overlay" data-lcars="overlay"></div>
  </main>
  <aside class="lcars-right" data-lcars="right"></aside>
  <footer class="lcars-footer">
    <div class="log-region">
      <div class="log-tab">CAPTAIN'S LOG</div>
      <div class="log-scroll" data-lcars="log" aria-live="polite"></div>
    </div>
    <div class="ftr-bar"><i class="ftr-seg"></i><i class="ftr-tail"></i><i class="ftr-cap"></i></div>
  </footer>
  <div class="shell-modal" data-lcars="modal"></div>
</div>
`

export const createShell: CreateShell = (root, callbacks) => {
  root.classList.add('lcars-root')
  root.innerHTML = SKELETON

  const grab = (name: string): HTMLElement => {
    const node = root.querySelector<HTMLElement>(`[data-lcars="${name}"]`)
    if (!node) throw new Error(`lcars shell: missing region ${name}`)
    return node
  }
  const shellEl = grab('shell')
  const leftEl = grab('left')
  const rightEl = grab('right')
  const overlayEl = grab('overlay')
  const logEl = grab('log')
  const phaserParent = grab('phaser')
  const stardateEl = grab('stardate')
  const systemEl = grab('system')
  const missionEl = grab('mission')
  const ctlEl = grab('ctl')
  const modalEl = grab('modal')

  // Every btn() press across the UI beeps through the controller from here on.
  setBeeper((kind) => callbacks.onUiBeep(kind))

  const ui: UiState = {
    seedText: '',
    permadeath: true,
    draft: null,
    encounterKey: null,
    roundKey: null,
    overlay: null,
  }
  let lastView: ViewState | null = null

  const ctx: ShellCtx = {
    callbacks,
    ui,
    rerender: () => {
      if (lastView) render(lastView)
    },
  }

  // --- header chrome: mute / log archive / help pills -----------------------
  const muteBtn = btn('', () => callbacks.onToggleMute(), {
    classes: 'hdr-pill',
    title: 'TOGGLE AUDIO (M)',
  })
  const logBtn = btn('LOG', () => toggleOverlay('log'), {
    classes: 'hdr-pill',
    title: "CAPTAIN'S LOG ARCHIVE",
  })
  const helpBtn = btn('?', () => toggleOverlay('help'), {
    classes: 'hdr-pill',
    title: 'HOW TO PLAY',
  })
  ctlEl.append(muteBtn, logBtn, helpBtn)

  function toggleOverlay(kind: 'log' | 'help'): void {
    ui.overlay = ui.overlay === kind ? null : kind
    ctx.rerender()
  }

  function closeOverlay(): void {
    if (!ui.overlay) return
    ui.overlay = null
    ctx.rerender()
  }

  function render(view: ViewState): void {
    lastView = view
    updateHeader(view)
    shellEl.classList.toggle('lcars-alert', isRedAlert(view))
    syncDraft(view)
    const content = buildScreen(view)
    leftEl.replaceChildren(...content.left)
    rightEl.replaceChildren(...content.right)
    if (content.overlay) {
      overlayEl.replaceChildren(content.overlay)
      overlayEl.className = `center-overlay visible overlay-${content.overlayMode ?? 'dim'}`
    } else {
      overlayEl.replaceChildren()
      overlayEl.className = 'center-overlay'
    }
    renderModal(view)
  }

  /** Full-screen overlay layer (log archive / help), above everything else. */
  function renderModal(view: ViewState): void {
    if (ui.overlay === 'log' && !view.game) ui.overlay = null // no campaign, no archive
    if (ui.overlay === 'log' && view.game) {
      modalEl.replaceChildren(logOverlay(view.game.logArchive, closeOverlay))
      modalEl.classList.add('visible')
      const scroll = modalEl.querySelector<HTMLElement>('.modal-scroll')
      if (scroll) scroll.scrollTop = scroll.scrollHeight // newest entries at the bottom
    } else if (ui.overlay === 'help') {
      modalEl.replaceChildren(helpOverlay(closeOverlay))
      modalEl.classList.add('visible')
    } else {
      modalEl.replaceChildren()
      modalEl.classList.remove('visible')
    }
  }

  function buildScreen(view: ViewState): ScreenContent {
    if (view.screen === 'menu' || !view.game) return menuScreen(view, ctx)
    if (view.screen === 'sector') return sectorScreen(view, view.game, ctx)
    if (view.screen === 'encounter' && view.game.encounter && ui.draft) {
      return encounterScreen(view, view.game, ui.draft, ctx)
    }
    if (view.screen === 'game-over') return gameOverScreen(view.game, ctx)
    // Defensive: inconsistent view — leave the frame empty rather than crash.
    return { left: [], right: [], overlay: null }
  }

  /**
   * Keep the order draft alive across idempotent re-renders; rebuild it only
   * when the round (or the encounter itself, or the screen) changes. Throttle
   * carries between rounds of the same encounter; everything else resets.
   */
  function syncDraft(view: ViewState): void {
    const game = view.game
    if (view.screen === 'encounter' && game?.encounter) {
      const enc = game.encounter
      const enemy = enc.ships.find((s) => s.id !== enc.playerShipId)
      const context = game.encounterContext
      const contextKey = context ? (context.kind === 'mission' ? context.defId : 'random') : ''
      const encounterKey = `${game.seed}:${game.galaxy.stardate}:${contextKey}:${enemy?.id ?? ''}:${enemy?.name ?? ''}`
      const roundKey = `${encounterKey}#${enc.round}`
      if (ui.roundKey !== roundKey) {
        const carried = ui.encounterKey === encounterKey && ui.draft ? ui.draft.throttle : 0
        const player = enc.ships.find((s) => s.id === enc.playerShipId) ?? game.ship
        ui.draft = newDraft(player, carried)
        ui.encounterKey = encounterKey
        ui.roundKey = roundKey
      }
    } else {
      ui.draft = null
      ui.encounterKey = null
      ui.roundKey = null
    }
  }

  function updateHeader(view: ViewState): void {
    const game = view.game
    if (game) {
      stardateEl.textContent = game.galaxy.stardate.toFixed(1)
      systemEl.textContent = getSystem(game.galaxy.currentSystemId).name.toUpperCase()
      missionEl.textContent = missionHeadline(game.missions)
    } else {
      stardateEl.textContent = '—'
      systemEl.textContent = '—'
      missionEl.textContent = 'STANDBY'
    }
    muteBtn.textContent = view.muted ? '◄ ✕ MUTED' : '◄)) SOUND ON'
    muteBtn.setAttribute('aria-pressed', String(view.muted))
    muteBtn.classList.toggle('on', view.muted)
    logBtn.disabled = !game
  }

  function missionHeadline(missions: MissionRecord[]): string {
    const active = missions.filter((m) => m.stage === 'active')
    if (active.length > 0) {
      const title = getMissionDef(active[0]!.defId).title
      const more = active.length > 1 ? ` +${active.length - 1}` : ''
      return `${title}${more} — IN PROGRESS`.toUpperCase()
    }
    if (missions.some((m) => m.stage === 'resolved')) return 'ALL MISSIONS COMPLETE'
    return 'STANDBY'
  }

  function isRedAlert(view: ViewState): boolean {
    if (view.screen === 'game-over') return true
    return view.screen === 'encounter' && view.game?.encounter?.status === 'active'
  }

  function appendLog(lines: string[]): void {
    for (const line of lines) {
      if (!line) continue
      const cls = lineClass(line)
      logEl.append(el('div', cls ? `log-line ${cls}` : 'log-line', line))
    }
    while (logEl.childElementCount > MAX_LOG_LINES) logEl.firstElementChild?.remove()
    logEl.scrollTop = logEl.scrollHeight
  }

  // --- keyboard shortcuts: SPACE/Enter execute, M mute, ESC closes overlays --
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape') {
      if (ui.overlay) {
        callbacks.onUiBeep('tap')
        closeOverlay()
      }
      return
    }
    // Never hijack typing (seed input) or a focused button's own activation.
    const target = e.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
    if (e.key === 'm' || e.key === 'M') {
      callbacks.onUiBeep('tap')
      callbacks.onToggleMute()
      return
    }
    if (e.key === ' ' || e.key === 'Enter') {
      if (target instanceof HTMLButtonElement) return
      if (ui.overlay || !lastView || lastView.screen !== 'encounter') return
      e.preventDefault()
      executeFromKeyboard(lastView)
    }
  })

  /** Same rules and beeps as the EXECUTE ROUND button, minus the DOM. */
  function executeFromKeyboard(view: ViewState): void {
    const game = view.game
    const enc = game?.encounter
    const draft = ui.draft
    if (!game || !enc || !draft || enc.status !== 'active') return
    const player = enc.ships.find((s) => s.id === enc.playerShipId) ?? game.ship
    if (view.busy || totalAllocated(draft.power) > powerBudget(player)) {
      callbacks.onUiBeep('deny')
      return
    }
    callbacks.onUiBeep('execute')
    callbacks.onExecuteRound(buildOrders(draft, game))
  }

  return {
    render,
    appendLog,
    eventsToLog,
    phaserParent,
  }
}
