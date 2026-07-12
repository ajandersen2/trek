// Sector screen: ship status on the left, navigation / mission / saves on the
// right. The center is the Phaser sector map (owned by the render layer).

import { getSystem } from '../../data/sectors'
import type { StarSystem } from '../../sim/galaxy'
import type { GameState } from '../../sim/game'
import type { ViewState } from '../api'
import type { ScreenContent, ShellCtx } from '../context'
import { btn, div, el, hint } from '../dom'
import { panel, shipStatusBody, textRow } from '../panels'

export function sectorScreen(view: ViewState, game: GameState, ctx: ShellCtx): ScreenContent {
  const current = getSystem(game.galaxy.currentSystemId)
  const left = [panel('SHIP STATUS', 'gold', shipStatusBody(game.ship))]

  const scroll = div('rail-scroll')
  scroll.append(
    navigationPanel(view, current, ctx),
    missionPanel(game),
    savePanel(view, ctx),
  )
  return { left, right: [scroll], overlay: null }
}

function navigationPanel(view: ViewState, current: StarSystem, ctx: ShellCtx): HTMLElement {
  const body: HTMLElement[] = [textRow('POSITION', current.name.toUpperCase())]
  const selected = view.selectedSystemId ? safeSystem(view.selectedSystemId) : null

  let canWarp = false
  if (selected) {
    const head = div('sys-head')
    head.append(
      el('span', 'sys-name', selected.name.toUpperCase()),
      el('span', `chip chip-${selected.type}`, selected.type.toUpperCase()),
    )
    body.push(head, div('sys-desc', selected.description))
    const isCurrent = selected.id === current.id
    const adjacent = current.links.includes(selected.id)
    canWarp = !isCurrent && adjacent
    if (isCurrent) body.push(hint('CURRENT POSITION'))
    else if (!adjacent) body.push(hint(`NO DIRECT WARP LANE FROM ${current.name.toUpperCase()}`))
  } else {
    body.push(hint('SELECT A DESTINATION ON THE SECTOR MAP'))
  }

  body.push(
    btn(
      'ENGAGE WARP',
      () => {
        if (view.selectedSystemId) ctx.callbacks.onTravel(view.selectedSystemId)
      },
      { classes: 'primary wide', disabled: view.busy || !canWarp },
    ),
  )
  if (current.type === 'starbase') {
    body.push(
      btn('DOCK — REPAIR & REARM', () => ctx.callbacks.onDock(), {
        classes: 'wide',
        disabled: view.busy,
      }),
    )
  }
  return panel('NAVIGATION', 'gold', body)
}

function missionPanel(game: GameState): HTMLElement {
  const resolved = game.mission.stage === 'resolved'
  const body: HTMLElement[] = [div('sys-name', game.mission.title.toUpperCase())]
  body.push(
    resolved
      ? div('mission-done', 'COMPLETE')
      : div('sys-desc', 'Respond to the distress call at Veyra Colony.'),
  )
  return panel('MISSION', 'lavender', body)
}

function savePanel(view: ViewState, ctx: ShellCtx): HTMLElement {
  const body: HTMLElement[] = []
  for (const slot of [1, 2, 3]) body.push(slotRow(slot, view, ctx))
  body.push(btn('EXPORT SAVE FILE', () => ctx.callbacks.onExportSave(), { classes: 'wide sm' }))
  return panel('SAVE / LOAD', 'slate', body)
}

function slotRow(slot: number, view: ViewState, ctx: ShellCtx): HTMLElement {
  const label = view.saveSlots.find((s) => s.slot === slot)?.label ?? null
  const row = div('slot-row')
  row.append(
    el('span', 'slot-tag', `S${slot}`),
    el('span', label ? 'slot-name' : 'slot-name empty', label ?? 'EMPTY'),
    btn('SAVE', () => ctx.callbacks.onSaveSlot(slot), { classes: 'sm' }),
    btn('LOAD', () => ctx.callbacks.onLoadSlot(slot), { classes: 'sm', disabled: !label }),
  )
  return row
}

function safeSystem(id: string): StarSystem | null {
  try {
    return getSystem(id)
  } catch {
    return null
  }
}
