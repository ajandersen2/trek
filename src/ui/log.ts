// Captain's-log voice: turns sim RoundEvents into terse, diegetic log lines
// and classifies lines for color coding. UI voice only — the sim never sees this.

import type { RoundEvent, ShipState } from '../sim/types'
import type { ViewState } from './api'
import { fmt1 } from './dom'
import { OUTCOME_TITLES, SUB_LABELS, SUB_NOUNS } from './labels'

const PHASER_BLOCKED: Record<
  'arc' | 'range' | 'weapons-down' | 'no-power' | 'target-cloaked' | 'self-cloaked',
  string
> = {
  arc: 'Phasers cannot bear on the target.',
  range: 'Target is beyond phaser range.',
  'weapons-down': 'Phaser array offline — fire order aborted.',
  'no-power': 'No power to weapons — phasers cold.',
  'target-cloaked': 'No firing solution — target is cloaked.',
  'self-cloaked': 'Weapons unavailable while cloaked.',
}

const TORPEDO_BLOCKED: Record<
  'arc' | 'ammo' | 'weapons-down' | 'no-power' | 'target-cloaked' | 'self-cloaked',
  string
> = {
  arc: 'Torpedo launch aborted — target outside the forward arc.',
  ammo: 'Torpedo magazine empty.',
  'weapons-down': 'Torpedo launcher offline.',
  'no-power': 'No power to weapons — torpedo tubes cold.',
  'target-cloaked': 'No firing solution — target is cloaked.',
  'self-cloaked': 'Weapons unavailable while cloaked.',
}

/** Ghost bearing indexes are 16ths of a circle: index × 22.5°, zero-padded ("~090"). */
function bearingDegrees(index: number): string {
  return String(Math.round(index * 22.5)).padStart(3, '0')
}

/** Convert resolved-round events into readable captain's-log lines. */
export function eventsToLog(events: RoundEvent[], view: ViewState): string[] {
  const ships = view.game?.encounter?.ships ?? []
  const playerId = view.game?.encounter?.playerShipId ?? view.game?.ship.id ?? 'player'
  const shipOf = (id: string): ShipState | undefined =>
    ships.find((s) => s.id === id) ??
    (view.game && view.game.ship.id === id ? view.game.ship : undefined)
  const nameOf = (id: string): string => shipOf(id)?.name ?? id
  const isPlayer = (id: string): boolean => id === playerId
  const gunsOf = (id: string): string =>
    shipOf(id)?.faction === 'klingon' ? 'disruptors' : 'phasers'

  const lines: string[] = []
  for (const e of events) {
    switch (e.type) {
      case 'round-start':
        lines.push(`— ROUND ${e.round} —`)
        break
      case 'power':
      case 'helm':
      case 'torpedo-move':
        break // animation/bookkeeping noise, not log-worthy
      case 'repair':
        lines.push(
          isPlayer(e.shipId)
            ? `Engineering patches the ${SUB_NOUNS[e.subsystem]} — ${fmt1(e.hp)} HP.`
            : `${nameOf(e.shipId)} repairs its ${SUB_NOUNS[e.subsystem]}.`,
        )
        break
      case 'scan':
        if (isPlayer(e.shipId)) {
          if (e.success) {
            lines.push(`Scan complete — ${nameOf(e.targetId)}'s shields and subsystems on tactical.`)
          } else if (typeof e.ghostBearing === 'number') {
            // Failed tachyon sweep inside hint range: a rough contact bearing leaks.
            lines.push(`Tachyon sweep: faint distortion bearing ~${bearingDegrees(e.ghostBearing)}.`)
          } else if (shipOf(e.targetId)?.cloaked) {
            lines.push('Tachyon sweep: no return.')
          } else {
            lines.push('Sensor sweep failed — sensors are down.')
          }
        } else if (e.success) {
          lines.push(`${nameOf(e.shipId)} sweeps us with targeting sensors.`)
        }
        break
      case 'cloak':
        lines.push(`${nameOf(e.shipId)} shimmers out of existence.`)
        break
      case 'decloak':
        lines.push(
          e.forced
            ? `TACHYON RETURN — ${nameOf(e.shipId)} forced out of cloak!`
            : `${nameOf(e.shipId)} decloaks!`,
        )
        break
      case 'cloak-blocked':
        if (isPlayer(e.shipId)) {
          lines.push(e.reason === 'cooldown' ? 'Cloak recharging.' : 'Cloak failed — engines are down.')
        }
        break
      case 'hail':
        lines.push(
          isPlayer(e.shipId)
            ? `We hail ${nameOf(e.targetId)}. ${e.text}`
            : `${nameOf(e.shipId)} hails us: ${e.text}`,
        )
        break
      case 'warp-out':
        lines.push(
          isPlayer(e.shipId) ? 'We break off and jump to warp.' : `${nameOf(e.shipId)} escapes to warp.`,
        )
        break
      case 'warp-out-failed':
        if (isPlayer(e.shipId)) {
          lines.push(
            e.reason === 'engines'
              ? 'Warp out failed — engines are down.'
              : 'Warp out failed — enemy vessel too close to form a warp field.',
          )
        } else {
          lines.push(`${nameOf(e.shipId)} tries to run but cannot break away.`)
        }
        break
      case 'torpedo-launch':
        lines.push(
          isPlayer(e.ownerId)
            ? `Torpedo away — tracking ${nameOf(e.targetId)}.`
            : `${nameOf(e.ownerId)} launches a torpedo — brace for impact!`,
        )
        break
      case 'torpedo-expired':
        lines.push('A torpedo exhausts its fuel and detonates harmlessly.')
        break
      case 'torpedo-hit': {
        const whose = isPlayer(e.targetId) ? 'our' : `${nameOf(e.targetId)}'s`
        if (e.shieldDamage > 0) {
          const bleed = e.hullDamage > 0 ? ` — ${fmt1(e.hullDamage)} hull damage` : ''
          lines.push(`Torpedo strikes ${whose} ${e.arc} shields for ${fmt1(e.shieldDamage)}${bleed}.`)
        } else {
          lines.push(`Torpedo slams into ${whose} hull — ${fmt1(e.hullDamage)} damage!`)
        }
        break
      }
      case 'phaser-fire':
        if (isPlayer(e.shooterId)) {
          if (!e.hit) {
            lines.push('Phasers miss.')
          } else if (e.shieldDamage > 0) {
            const bleed = e.hullDamage > 0 ? `, ${fmt1(e.hullDamage)} hull damage` : ''
            lines.push(
              `Phasers hit ${nameOf(e.targetId)} — ${e.arc} shields absorb ${fmt1(e.shieldDamage)}${bleed}.`,
            )
          } else if (e.hullDamage > 0) {
            lines.push(`Direct hit! ${fmt1(e.hullDamage)} hull damage.`)
          } else {
            lines.push(`Phasers hit ${nameOf(e.targetId)}.`)
          }
        } else {
          const guns = `${nameOf(e.shooterId)}'s ${gunsOf(e.shooterId)}`
          if (!e.hit) {
            lines.push(`${guns} miss.`)
          } else if (e.shieldDamage > 0) {
            const bleed = e.hullDamage > 0 ? `, ${fmt1(e.hullDamage)} hull damage` : ''
            lines.push(`${guns} hit — our ${e.arc} shields absorb ${fmt1(e.shieldDamage)}${bleed}.`)
          } else {
            lines.push(`${nameOf(e.shooterId)} scores a direct hit — ${fmt1(e.hullDamage)} hull damage!`)
          }
        }
        break
      case 'phaser-blocked':
        if (isPlayer(e.shooterId)) lines.push(PHASER_BLOCKED[e.reason])
        break
      case 'torpedo-blocked':
        if (isPlayer(e.shooterId)) lines.push(TORPEDO_BLOCKED[e.reason])
        break
      case 'subsystem-damaged':
        if (e.disabled) {
          lines.push(`${SUB_LABELS[e.subsystem]} DISABLED on ${nameOf(e.shipId)}.`)
        } else if (isPlayer(e.shipId)) {
          lines.push(`Our ${SUB_NOUNS[e.subsystem]} takes damage — ${fmt1(e.hp)} HP.`)
        } else {
          lines.push(`${nameOf(e.shipId)}'s ${SUB_NOUNS[e.subsystem]} is hit.`)
        }
        break
      case 'ship-destroyed':
        lines.push(`${nameOf(e.shipId)} is destroyed.`)
        break
      case 'ship-disabled':
        lines.push(`${nameOf(e.shipId)} is dead in space — weapons and engines offline.`)
        break
      case 'encounter-end':
        lines.push(`— ${OUTCOME_TITLES[e.status]} —`)
        break
      case 'log':
        lines.push(e.text)
        break
    }
  }
  return lines
}

const CRITICAL_RE =
  /LOST WITH ALL HANDS|RED ALERT|DISABLED|FAILED|TACHYON RETURN|destroyed|dead in space|breaking up|brace for impact|scores a direct hit|Warp out failed/

/** Color class for a captain's-log line (heuristics tuned to the UI voice above). */
export function lineClass(line: string): string {
  if (/^— .+ —$/.test(line)) return 'log-divider'
  if (CRITICAL_RE.test(line)) return 'log-red'
  if (/\b(our|us)\b/i.test(line) && /\b(hit|strikes?|slams?|absorb|damage)\b/i.test(line)) {
    return 'log-red'
  }
  if (/^(Phasers hit|Direct hit|Torpedo strikes|Torpedo away|Torpedo slams)/.test(line) || /\bis hit\b/.test(line)) {
    return 'log-orange'
  }
  if (/scan|sensor|hail|sweep|respond|channel/i.test(line)) return 'log-lavender'
  return ''
}
