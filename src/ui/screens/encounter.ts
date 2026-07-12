// Encounter screen: power management on the left, station order cards on the
// right, EXECUTE ROUND docked below them. All widgets render from the UI-owned
// OrderDraft, so re-renders never lose in-progress orders. The station/power
// machinery (battlePanels, executeDock) is exported for the hot-seat skirmish
// screen, which runs the same console for whichever captain holds the seat.

import { getShipClass } from '../../data/ships'
import { REPAIR_HP_PER_ROUND, WARP_OUT_MIN_RANGE } from '../../sim/constants'
import type { GameState } from '../../sim/game'
import { distance } from '../../sim/geometry'
import { POWER_MAX_PER_SYSTEM, powerBudget, totalAllocated } from '../../sim/power'
import type { EncounterStatus, ShipState, SubsystemId } from '../../sim/types'
import { SUBSYSTEM_IDS } from '../../sim/types'
import type { ViewState } from '../api'
import type { ScreenContent, ShellCtx } from '../context'
import { buildOrders, type OrderDraft } from '../draft'
import { beep, btn, div, el, fmt1, hint } from '../dom'
import { OUTCOME_TITLES, SUB_LABELS } from '../labels'
import { enemyStatusBody, panel, shipStatusBody, textRow } from '../panels'

const POWER_ORDER: readonly SubsystemId[] = ['engines', 'shields', 'weapons', 'sensors']

const TURN_OPTIONS = [
  { value: -2, glyph: '◄◄', title: 'HARD PORT' },
  { value: -1, glyph: '◄', title: 'PORT' },
  { value: 0, glyph: '●', title: 'STEADY' },
  { value: 1, glyph: '►', title: 'STARBOARD' },
  { value: 2, glyph: '►►', title: 'HARD STARBOARD' },
] as const

const THROTTLE_OPTIONS = [
  { value: 0, label: 'STOP', title: 'ALL STOP' },
  { value: 1, label: '1/4', title: 'ONE QUARTER IMPULSE' },
  { value: 2, label: '1/2', title: 'HALF IMPULSE' },
  { value: 3, label: '3/4', title: 'THREE QUARTERS IMPULSE' },
  { value: 4, label: 'FLANK', title: 'FLANK SPEED' },
] as const

export function encounterScreen(
  view: ViewState,
  game: GameState,
  draft: OrderDraft,
  ctx: ShellCtx,
): ScreenContent {
  const enc = game.encounter
  if (!enc) return { left: [], right: [], overlay: null }
  const player = enc.ships.find((s) => s.id === enc.playerShipId) ?? game.ship
  const enemy = enc.ships.find((s) => s.id !== enc.playerShipId) ?? null
  const locked = view.busy || enc.status !== 'active'
  const { left, stations } = battlePanels(player, enemy, draft, locked, ctx)
  const dock = executeDock(
    enc.round,
    view.busy,
    totalAllocated(draft.power) > powerBudget(player),
    enc.status === 'active',
    () => ctx.callbacks.onExecuteRound(buildOrders(draft, game)),
  )
  const overlay = enc.status !== 'active' ? outcomeOverlay(enc.status, enemy, view.busy, ctx) : null
  return { left, right: [stations, dock], overlay, overlayMode: 'dim' }
}

/** The two rails of one captain's battle console. */
export interface BattlePanels {
  /** Left rail: warp-core power draft + own-ship + target readouts. */
  left: HTMLElement[]
  /** Right rail scroll: helm / tactical / science / comms / engineering cards. */
  stations: HTMLElement
}

/**
 * Full order console for `player` against `enemy`, rendered from `draft`.
 * Shared verbatim by the campaign encounter and the hot-seat skirmish — every
 * control keys off the ordering ship (cloak, torpedoes, repair) and the
 * opponent's scan state, so it works for any playable class on either side.
 */
export function battlePanels(
  player: ShipState,
  enemy: ShipState | null,
  draft: OrderDraft,
  locked: boolean,
  ctx: ShellCtx,
): BattlePanels {
  // A cloaked contact has no range solution — hide the number everywhere.
  const range =
    enemy && enemy.alive && !enemy.warpedOut && !enemy.cloaked
      ? distance(player.pos, enemy.pos)
      : null

  const left = [
    powerPanel(player, draft, locked, ctx),
    panel(player.name.toUpperCase(), 'slate', shipStatusBody(player)),
    panel('TARGET', 'red', enemy ? enemyStatusBody(enemy, range) : [hint('NO CONTACT')]),
  ]

  const stations = div('rail-scroll')
  stations.append(
    helmPanel(player, draft, locked, range, ctx),
    tacticalPanel(player, enemy, draft, locked, ctx),
    sciencePanel(enemy, draft, locked, ctx),
    commsPanel(enemy, draft, locked, ctx),
    engineeringPanel(player, draft, locked, ctx),
  )
  return { left, stations }
}

// --- left rail --------------------------------------------------------------

function powerPanel(player: ShipState, draft: OrderDraft, locked: boolean, ctx: ShellCtx): HTMLElement {
  const budget = powerBudget(player)
  const total = totalAllocated(draft.power)
  const over = total > budget
  const body: HTMLElement[] = [textRow('CORE OUTPUT', String(budget))]
  for (const sys of POWER_ORDER) body.push(powerRow(sys, draft, locked, ctx))
  const totalRow = div(over ? 'power-total over' : 'power-total')
  totalRow.append(el('span', '', 'ALLOCATED'), el('span', 'num', `${total} / ${budget}`))
  body.push(totalRow)
  if (over) body.push(hint('OVER BUDGET — SHED POWER TO EXECUTE', true))
  return panel('WARP CORE', 'gold', body)
}

function powerRow(sys: SubsystemId, draft: OrderDraft, locked: boolean, ctx: ShellCtx): HTMLElement {
  const value = draft.power[sys]
  const row = div('power-row')
  const minus = btn(
    '−',
    () => {
      draft.power[sys] = Math.max(0, draft.power[sys] - 1)
      ctx.rerender()
    },
    { classes: 'pm', disabled: locked || value <= 0, title: `REDUCE ${SUB_LABELS[sys]} POWER` },
  )
  const plus = btn(
    '+',
    () => {
      draft.power[sys] = Math.min(POWER_MAX_PER_SYSTEM, draft.power[sys] + 1)
      ctx.rerender()
    },
    { classes: 'pm', disabled: locked || value >= POWER_MAX_PER_SYSTEM, title: `BOOST ${SUB_LABELS[sys]} POWER` },
  )
  const segs = div('segs')
  for (let i = 0; i < POWER_MAX_PER_SYSTEM; i++) segs.append(el('i', i < value ? 'seg on' : 'seg'))
  row.append(el('span', 'lbl', SUB_LABELS[sys]), minus, segs, plus)
  return row
}

// --- station cards ------------------------------------------------------------

function helmPanel(
  player: ShipState,
  draft: OrderDraft,
  locked: boolean,
  range: number | null,
  ctx: ShellCtx,
): HTMLElement {
  const body: HTMLElement[] = [div('group-lbl', 'TURN')]
  const turnRow = div('opts')
  for (const t of TURN_OPTIONS) {
    turnRow.append(
      btn(
        t.glyph,
        () => {
          draft.turn = t.value
          ctx.rerender()
        },
        { classes: 'sm', disabled: locked, pressed: draft.turn === t.value, title: t.title },
      ),
    )
  }
  body.push(turnRow, div('group-lbl', 'IMPULSE'))
  const throttleRow = div('opts')
  for (const t of THROTTLE_OPTIONS) {
    throttleRow.append(
      btn(
        t.label,
        () => {
          draft.throttle = t.value
          ctx.rerender()
        },
        { classes: 'sm', disabled: locked, pressed: draft.throttle === t.value, title: t.title },
      ),
    )
  }
  body.push(throttleRow)
  body.push(
    btn(
      'WARP OUT',
      () => {
        draft.warpOut = !draft.warpOut
        ctx.rerender()
      },
      { classes: 'wide', disabled: locked, pressed: draft.warpOut },
    ),
  )
  const enginesUp = player.subsystems.engines.hp > 0
  const rangeNote = range !== null ? ` · RANGE ${fmt1(range)}` : ''
  body.push(
    hint(
      `DISENGAGE: NEEDS RANGE ≥ ${WARP_OUT_MIN_RANGE} AND ENGINES ONLINE${rangeNote}`,
      draft.warpOut && !enginesUp,
    ),
  )
  if (getShipClass(player.classId).hasCloak) body.push(...cloakControls(player, draft, locked, ctx))
  return panel('HELM', 'gold', body)
}

/** Cloaking device block: only rendered for classes with hasCloak. */
function cloakControls(
  player: ShipState,
  draft: OrderDraft,
  locked: boolean,
  ctx: ShellCtx,
): HTMLElement[] {
  const enginesUp = player.subsystems.engines.hp > 0
  const recharging = !player.cloaked && player.cloakCooldown > 0
  const out: HTMLElement[] = [
    btn(
      'CLOAK',
      () => {
        draft.cloak = !draft.cloak
        ctx.rerender()
      },
      { classes: 'wide', disabled: locked || recharging || !enginesUp, pressed: draft.cloak },
    ),
  ]
  if (recharging) out.push(hint(`CLOAK RECHARGING — ${player.cloakCooldown} ROUNDS`))
  else if (!enginesUp) out.push(hint('CLOAK UNAVAILABLE — ENGINES OFFLINE', true))
  else if (!player.cloaked && draft.cloak) out.push(hint('ENGAGING — WEAPONS OFFLINE THIS ROUND'))
  else if (player.cloaked && !draft.cloak) out.push(hint('DECLOAKING — WEAPONS FREE THIS ROUND'))
  else if (player.cloaked) out.push(hint('CLOAKED — SHIELDS DOWN · NO WEAPONS FIRE'))
  else out.push(hint('UNTARGETABLE WHILE CLOAKED · SHIELDS AND WEAPONS OFFLINE'))
  return out
}

function tacticalPanel(
  player: ShipState,
  enemy: ShipState | null,
  draft: OrderDraft,
  locked: boolean,
  ctx: ShellCtx,
): HTMLElement {
  const scanned = !!enemy && enemy.scanLevel >= 1
  // A cloaked target gives the fire-control computer nothing to lock on.
  const noSolution = !!enemy && enemy.cloaked
  const body: HTMLElement[] = [
    btn(
      'FIRE PHASERS',
      () => {
        draft.firePhasers = !draft.firePhasers
        ctx.rerender()
      },
      { classes: 'wide fire', disabled: locked || !enemy || noSolution, pressed: draft.firePhasers },
    ),
    div('group-lbl', 'TARGETING'),
  ]
  const targetRow = div('opts')
  targetRow.append(
    btn(
      'HULL',
      () => {
        draft.targetSubsystem = null
        ctx.rerender()
      },
      { classes: 'sm', disabled: locked || noSolution, pressed: draft.targetSubsystem === null },
    ),
  )
  for (const sys of SUBSYSTEM_IDS) {
    targetRow.append(
      btn(
        SUB_LABELS[sys],
        () => {
          draft.targetSubsystem = sys
          ctx.rerender()
        },
        {
          classes: 'sm',
          disabled: locked || !scanned || noSolution,
          pressed: draft.targetSubsystem === sys,
        },
      ),
    )
  }
  body.push(targetRow)
  if (noSolution) body.push(hint('TARGET CLOAKED — NO FIRING SOLUTION', true))
  else if (!scanned) body.push(hint('SCAN REQUIRED FOR SUBSYSTEM TARGETING'))
  body.push(
    btn(
      `FIRE TORPEDO · ${player.torpedoes}`,
      () => {
        draft.fireTorpedo = !draft.fireTorpedo
        ctx.rerender()
      },
      {
        classes: 'wide fire',
        disabled: locked || !enemy || player.torpedoes < 1 || noSolution,
        pressed: draft.fireTorpedo,
        title: player.torpedoes < 1 ? 'TORPEDO MAGAZINE EMPTY' : 'NARROW FORWARD LAUNCH WINDOW',
      },
    ),
  )
  return panel('TACTICAL', 'accent', body)
}

function sciencePanel(
  enemy: ShipState | null,
  draft: OrderDraft,
  locked: boolean,
  ctx: ShellCtx,
): HTMLElement {
  const scanned = !!enemy && enemy.scanLevel >= 1
  // Against a cloaked contact the scan becomes a tachyon sweep — always worth
  // running (even after a completed scan), so cloak overrides the scanned lock.
  const cloaked = !!enemy && enemy.cloaked
  return panel('SCIENCE', 'slate', [
    btn(
      cloaked ? 'TACHYON SWEEP' : 'SCAN TARGET',
      () => {
        draft.scan = !draft.scan
        ctx.rerender()
      },
      { classes: 'wide', disabled: locked || !enemy || (scanned && !cloaked), pressed: draft.scan },
    ),
    hint(
      cloaked
        ? 'CHANCE TO FORCE DECLOAK SCALES WITH SENSOR POWER'
        : scanned
          ? 'TARGET SCANNED — FULL TELEMETRY ON TACTICAL'
          : 'REVEALS SHIELDS + SUBSYSTEMS · ENABLES TARGETING',
    ),
  ])
}

function commsPanel(
  enemy: ShipState | null,
  draft: OrderDraft,
  locked: boolean,
  ctx: ShellCtx,
): HTMLElement {
  return panel('COMMS', 'lavender', [
    btn(
      'HAIL',
      () => {
        draft.hail = !draft.hail
        ctx.rerender()
      },
      { classes: 'wide', disabled: locked || !enemy, pressed: draft.hail },
    ),
    hint('OPEN A CHANNEL TO THE HOSTILE VESSEL'),
  ])
}

function engineeringPanel(
  player: ShipState,
  draft: OrderDraft,
  locked: boolean,
  ctx: ShellCtx,
): HTMLElement {
  const row = div('opts')
  row.append(
    btn(
      'NONE',
      () => {
        draft.repair = null
        ctx.rerender()
      },
      { classes: 'sm', disabled: locked, pressed: draft.repair === null },
    ),
  )
  for (const sys of SUBSYSTEM_IDS) {
    const sub = player.subsystems[sys]
    row.append(
      btn(
        SUB_LABELS[sys],
        () => {
          draft.repair = sys
          ctx.rerender()
        },
        { classes: 'sm', disabled: locked || sub.hp >= sub.maxHp, pressed: draft.repair === sys },
      ),
    )
  }
  return panel('ENGINEERING', 'peach', [
    div('group-lbl', 'FIELD REPAIR'),
    row,
    hint(`REPAIR CREWS RESTORE +${REPAIR_HP_PER_ROUND} HP TO ONE SUBSYSTEM PER ROUND`),
  ])
}

/**
 * EXECUTE ROUND dock below the station rail. `resolving` covers any state
 * where the round is out of the captain's hands (controller busy, or skirmish
 * orders already committed); `active` is the encounter still running.
 */
export function executeDock(
  round: number,
  resolving: boolean,
  over: boolean,
  active: boolean,
  onExecute: () => void,
): HTMLElement {
  const dock = div('execute-dock')
  const execute = btn(resolving ? 'RESOLVING…' : `EXECUTE ROUND ${round}`, onExecute, {
    classes: 'primary execute wide',
    disabled: resolving || over || !active,
    beep: 'execute',
  })
  // Disabled buttons swallow clicks silently; the wrapper still hears the
  // pointer (the disabled button is pointer-events: none) and denies audibly.
  const wrap = div('execute-wrap')
  wrap.append(execute)
  wrap.addEventListener('pointerdown', () => {
    if (execute.disabled) beep('deny')
  })
  dock.append(wrap)
  if (over && !resolving) dock.append(hint('POWER OVER BUDGET — EXECUTE LOCKED', true))
  return dock
}

// --- end-of-battle overlay ------------------------------------------------------

function outcomeOverlay(
  status: EncounterStatus,
  enemy: ShipState | null,
  busy: boolean,
  ctx: ShellCtx,
): HTMLElement {
  const defeat = status === 'defeat'
  const box = div(defeat ? 'outcome-box defeat' : 'outcome-box')
  box.append(
    div(defeat ? 'outcome-title blink' : 'outcome-title', OUTCOME_TITLES[status]),
    div('outcome-sub', outcomeSubtitle(status, enemy)),
    btn(defeat ? 'ACKNOWLEDGE' : 'RETURN TO SECTOR', () => ctx.callbacks.onConcludeEncounter(), {
      classes: defeat ? 'danger' : 'primary',
      disabled: busy,
      beep: 'confirm',
    }),
  )
  return box
}

function outcomeSubtitle(status: EncounterStatus, enemy: ShipState | null): string {
  const name = (enemy?.name ?? 'THE ENEMY').toUpperCase()
  switch (status) {
    case 'victory':
      return `${name} IS DESTROYED`
    case 'enemy-disabled':
      return `${name} IS DEAD IN SPACE`
    case 'enemy-withdrawn':
      return `${name} HAS FLED THE SYSTEM`
    case 'withdrawn':
      return 'WE HAVE DISENGAGED'
    case 'defeat':
      return 'THE SHIP IS BREAKING UP'
    default:
      return ''
  }
}
