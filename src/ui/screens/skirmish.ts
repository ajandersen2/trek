// Hot-seat skirmish screens (M2.5): setup (pick ships + seed), the per-seat
// order console (reusing the encounter station machinery for whichever captain
// holds the seat), and the privacy handoff screen between captains. All three
// render from ViewState and report intent through the skirmish callbacks.

import { getShipClass } from '../../data/ships'
import { SKIRMISH_SHIPS } from '../../data/skirmish'
import { powerBudget, totalAllocated } from '../../sim/power'
import type { EncounterStatus } from '../../sim/types'
import type { SeatId, SkirmishConfig, SkirmishView, ViewState } from '../api'
import type { ScreenContent, ShellCtx } from '../context'
import { buildShipOrders, type OrderDraft } from '../draft'
import { btn, div, el, hint, parseSeed, seedRow } from '../dom'
import { battlePanels, executeDock } from './encounter'
import { decoRail } from './menu'

const SETUP_LEFT: ReadonlyArray<readonly [string, string, number]> = [
  ['gold', 'CAPTAIN A — CONN', 2],
  ['slate', 'WEGO REFEREE', 3],
  ['lavender', 'VERSUS PROTOCOL', 2],
]

const SETUP_RIGHT: ReadonlyArray<readonly [string, string, number]> = [
  ['red', 'CAPTAIN B — CONN', 2],
  ['slate', 'ORDERS SEALED', 3],
  ['peach', 'DUEL ARBITER', 2],
]

const HANDOFF_LEFT: ReadonlyArray<readonly [string, string, number]> = [
  ['lavender', 'PRIVACY SCREEN', 3],
  ['slate', 'ORDERS SEALED', 2],
  ['lavender', 'NO TACTICAL FEED', 2],
]

const HANDOFF_RIGHT: ReadonlyArray<readonly [string, string, number]> = [
  ['slate', 'CONSOLE TRANSFER', 3],
  ['lavender', 'STANDBY', 2],
  ['slate', 'WEGO LOCKSTEP', 2],
]

// --- skirmish setup -----------------------------------------------------------

export function skirmishSetupScreen(ctx: ShellCtx): ScreenContent {
  const box = div('skirmish-box')
  box.append(
    div('menu-sub', 'VERSUS — HOT-SEAT DUEL'),
    el('h1', 'skirmish-title', 'SKIRMISH SETUP'),
    div('menu-rule'),
  )

  const cols = div('skirmish-cols')
  cols.append(
    seatColumn('A', ctx.ui.skirmishClassA, (id) => {
      ctx.ui.skirmishClassA = id
    }, ctx),
    seatColumn('B', ctx.ui.skirmishClassB, (id) => {
      ctx.ui.skirmishClassB = id
    }, ctx),
  )
  box.append(cols)

  const actions = div('skirmish-actions')
  actions.append(
    seedRow(ctx.ui.skirmishSeedText, 'Skirmish seed (optional)', (text) => {
      ctx.ui.skirmishSeedText = text
    }),
    btn('ENGAGE', () => ctx.callbacks.onStartSkirmish(setupConfig(ctx)), {
      classes: 'primary execute wide',
      beep: 'confirm',
    }),
    btn('BACK', () => ctx.callbacks.onLeaveSkirmish(), {
      classes: 'wide sm',
      title: 'ESC ALSO RETURNS TO THE MENU',
    }),
    hint('ORDERS ARE SECRET — CAPTAINS SWAP THE CONSOLE BETWEEN ROUNDS'),
  )
  box.append(actions)
  return { left: decoRail(SETUP_LEFT), right: decoRail(SETUP_RIGHT), overlay: box, overlayMode: 'opaque' }
}

/** The last-used setup selections double as the REMATCH config (blank seed = fresh random). */
function setupConfig(ctx: ShellCtx): SkirmishConfig {
  return {
    seed: parseSeed(ctx.ui.skirmishSeedText),
    shipClassA: ctx.ui.skirmishClassA,
    shipClassB: ctx.ui.skirmishClassB,
  }
}

function seatColumn(seat: SeatId, selected: string, pick: (classId: string) => void, ctx: ShellCtx): HTMLElement {
  const col = div('skirmish-col')
  col.append(div(`seat-hd seat-${seat.toLowerCase()}`, `CAPTAIN ${seat}`))
  const list = div('ship-list')
  for (const opt of SKIRMISH_SHIPS) {
    // Seat B flies the alternate name so mirror matches stay readable.
    const name = opt.names[seat === 'A' ? 0 : 1]
    const card = btn(
      '',
      () => {
        pick(opt.classId)
        ctx.rerender()
      },
      { classes: 'ship-card', pressed: selected === opt.classId, title: getShipClass(opt.classId).name.toUpperCase() },
    )
    card.append(el('span', 'ship-name', name.toUpperCase()), el('span', 'ship-blurb', opt.blurb))
    list.append(card)
  }
  col.append(list, classStats(selected))
  return col
}

/** Small class readout for the column's current pick. */
function classStats(classId: string): HTMLElement {
  const cls = getShipClass(classId)
  const pair = (lbl: string, val: number): HTMLElement => {
    const p = el('span', 'stat-pair')
    p.append(el('span', 'lbl', lbl), el('span', 'val', String(val)))
    return p
  }
  const stats = div('ship-stats')
  stats.append(
    pair('HULL', cls.maxHull),
    pair('SPEED', cls.maxSpeed),
    pair('AGILITY', cls.agility),
    pair('SHIELDS', cls.shieldMax),
  )
  if (cls.hasCloak) stats.append(el('span', 'chip chip-cloaked', 'CLOAK'))
  const wrap = div('ship-stats-wrap')
  wrap.append(div('ship-class', cls.name.toUpperCase()), stats)
  return wrap
}

// --- skirmish order console ---------------------------------------------------

export function skirmishScreen(
  view: ViewState,
  sk: SkirmishView,
  draft: OrderDraft | null,
  ctx: ShellCtx,
): ScreenContent {
  const enc = sk.encounter
  if (enc.status !== 'active') {
    // Duel decided: the outcome overlay owns the screen — no order rails.
    return { left: [], right: [], overlay: outcomeOverlay(view, sk, ctx), overlayMode: 'dim' }
  }
  const seat = sk.activeSeat
  const ship = enc.ships.find((s) => s.id === sk.shipIds[seat])
  const opponent = enc.ships.find((s) => s.id === sk.shipIds[otherSeat(seat)]) ?? null
  // Defensive: draft/ships out of step with the view — leave the frame empty.
  if (!ship || !draft) return { left: [], right: [], overlay: null }

  // Orders already committed this round (or the replay is running): lock the rails.
  const sent = ctx.ui.skirmishSent !== null && ctx.ui.skirmishSent === ctx.ui.roundKey
  const locked = view.busy || sent
  const { left, stations } = battlePanels(ship, opponent, draft, locked, ctx)
  const dock = executeDock(sk.round, locked, totalAllocated(draft.power) > powerBudget(ship), true, () => {
    ctx.ui.skirmishSent = ctx.ui.roundKey
    ctx.callbacks.onSkirmishOrders(buildShipOrders(draft, ship, opponent))
  })
  return { left, right: [stations, dock], overlay: null }
}

function otherSeat(seat: SeatId): SeatId {
  return seat === 'A' ? 'B' : 'A'
}

/**
 * Duel outcome, mapped from seat A's frame: the skirmish encounter's
 * playerShipId is seat A's ship, so 'victory'/'enemy-*' mean B lost the
 * exchange and 'defeat'/'withdrawn' mean A did.
 */
function outcomeLines(status: EncounterStatus, names: Record<SeatId, string>): { title: string; sub: string } {
  const a = names.A.toUpperCase()
  const b = names.B.toUpperCase()
  switch (status) {
    case 'victory':
      return { title: 'CAPTAIN A WINS', sub: `${b} DESTROYED` }
    case 'defeat':
      return { title: 'CAPTAIN B WINS', sub: `${a} DESTROYED` }
    case 'enemy-disabled':
      return { title: 'CAPTAIN A WINS', sub: `${b} DISABLED` }
    case 'withdrawn':
      return { title: 'CAPTAIN B HOLDS THE FIELD', sub: `${a} WITHDREW` }
    case 'enemy-withdrawn':
      return { title: 'CAPTAIN A HOLDS THE FIELD', sub: `${b} WITHDREW` }
    default:
      return { title: 'DUEL COMPLETE', sub: '' }
  }
}

function outcomeOverlay(view: ViewState, sk: SkirmishView, ctx: ShellCtx): HTMLElement {
  const { title, sub } = outcomeLines(sk.encounter.status, sk.names)
  const box = div('outcome-box')
  box.append(
    div('outcome-title', title),
    div('outcome-sub', sub),
    btn(
      'REMATCH',
      () => {
        // The controller only starts a duel from a clean slate: leave first,
        // then re-engage with the retained config (blank seed = fresh random).
        ctx.callbacks.onLeaveSkirmish()
        ctx.callbacks.onStartSkirmish(setupConfig(ctx))
      },
      { classes: 'primary', disabled: view.busy, beep: 'confirm' },
    ),
    btn('RETURN TO MENU', () => ctx.callbacks.onLeaveSkirmish(), { disabled: view.busy, beep: 'confirm' }),
  )
  return box
}

// --- console handoff privacy screen ---------------------------------------------

export function handoffScreen(view: ViewState, sk: SkirmishView, ctx: ShellCtx): ScreenContent {
  const seat = sk.activeSeat
  const box = div('handoff-box')
  box.append(
    div('handoff-eyebrow', 'PRIVACY SCREEN — ORDERS SEALED'),
    div('handoff-title', `HAND THE CONSOLE TO CAPTAIN ${seat}`),
    div('handoff-ship', sk.names[seat].toUpperCase()),
    div('handoff-round', `ROUND ${sk.round}`),
    btn(`READY — CAPTAIN ${seat} HAS THE CONSOLE`, () => ctx.callbacks.onHandoffReady(), {
      classes: 'handoff-ready wide',
      disabled: view.busy,
      beep: 'execute',
    }),
    hint('SPACE OR ENTER WHEN SEATED'),
  )
  return { left: decoRail(HANDOFF_LEFT), right: decoRail(HANDOFF_RIGHT), overlay: box, overlayMode: 'opaque' }
}
