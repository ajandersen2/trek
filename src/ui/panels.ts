// LCARS panel chrome and ship readout blocks shared by the sector and
// encounter screens. Reads sim state only — never mutates it.

import { getShipClass } from '../data/ships'
import { ARC_IDS, SUBSYSTEM_IDS, type ShipState } from '../sim/types'
import { div, el, hint } from './dom'
import { ARC_LABELS, SUB_LABELS } from './labels'

export type PanelColor = 'gold' | 'peach' | 'lavender' | 'slate' | 'red' | 'accent'

/** Titled LCARS panel: rounded-cap label bar + body column. */
export function panel(title: string, color: PanelColor, body: HTMLElement[]): HTMLElement {
  const p = div(`panel panel-${color}`)
  const hd = div('panel-hd')
  hd.append(el('span', 'panel-label', title), el('i', 'panel-tail'))
  const bd = div('panel-bd')
  bd.append(...body)
  p.append(hd, bd)
  return p
}

/** Label + glowing bar + value readout row. */
export function statRow(label: string, frac: number, value: string, shield = false): HTMLElement {
  const clamped = Math.max(0, Math.min(1, frac))
  const fill = div(shield ? 'bar-fill shield' : 'bar-fill')
  if (!shield) {
    if (clamped <= 0.25) fill.classList.add('crit')
    else if (clamped <= 0.5) fill.classList.add('warn')
  }
  fill.style.width = `${(clamped * 100).toFixed(1)}%`
  const track = div('bar-track')
  track.append(fill)
  const row = div('stat')
  row.append(el('span', 'lbl', label), track, el('span', 'val', value))
  return row
}

/** Label + right-aligned value, no bar. */
export function textRow(label: string, value: string): HTMLElement {
  const row = div('stat')
  row.append(el('span', 'lbl wide', label), div('spacer'), el('span', 'val wide', value))
  return row
}

function arcRows(ship: ShipState): HTMLElement[] {
  const max = getShipClass(ship.classId).shieldMax
  return ARC_IDS.map((arc) =>
    statRow(ARC_LABELS[arc], max > 0 ? ship.shields[arc] / max : 0, String(Math.round(ship.shields[arc])), true),
  )
}

function subsystemRows(ship: ShipState): HTMLElement[] {
  return SUBSYSTEM_IDS.map((id) => {
    const sub = ship.subsystems[id]
    const frac = sub.maxHp > 0 ? sub.hp / sub.maxHp : 0
    const row = statRow(SUB_LABELS[id], frac, frac <= 0 ? 'DOWN' : `${Math.round(frac * 100)}%`)
    if (frac <= 0) row.classList.add('down')
    return row
  })
}

/** Full ship readout: hull, per-arc shields, subsystem health, torpedoes. */
export function shipStatusBody(ship: ShipState): HTMLElement[] {
  return [
    statRow('HULL', ship.maxHull > 0 ? ship.hull / ship.maxHull : 0, String(Math.round(ship.hull))),
    div('group-lbl', 'SHIELDS'),
    ...arcRows(ship),
    div('group-lbl', 'SYSTEMS'),
    ...subsystemRows(ship),
    textRow('TORPEDOES', `${ship.torpedoes} / ${getShipClass(ship.classId).torpedoCapacity}`),
  ]
}

/** Enemy readout: name + hull always; shields and subsystems only once scanned. */
export function enemyStatusBody(enemy: ShipState, range: number | null): HTMLElement[] {
  const out: HTMLElement[] = []
  const head = div('sys-head')
  head.append(el('span', 'target-name', enemy.name.toUpperCase()))
  if (!enemy.alive) head.append(el('span', 'chip chip-destroyed', 'DESTROYED'))
  else if (enemy.warpedOut) head.append(el('span', 'chip chip-empty', 'WARPED OUT'))
  out.push(head)
  if (range !== null && enemy.alive && !enemy.warpedOut) {
    out.push(textRow('RANGE', range.toFixed(1)))
  }
  const hullFrac = enemy.maxHull > 0 ? enemy.hull / enemy.maxHull : 0
  out.push(statRow('HULL', hullFrac, `${Math.round(hullFrac * 100)}%`))
  if (enemy.scanLevel >= 1) {
    out.push(div('group-lbl', 'SHIELDS'), ...arcRows(enemy))
    out.push(div('group-lbl', 'SYSTEMS'), ...subsystemRows(enemy))
  } else {
    out.push(hint('NO SCAN DATA — RUN A SENSOR SWEEP'))
  }
  return out
}
