// WEGO encounter engine. One OrderSet per captain goes in, the round resolves,
// a new state plus an event list comes out. The event list is the only thing the
// render layer animates from.
//
// Determinism contract:
//   - resolveRound clones the state, then mutates only the clone.
//   - Ships are always iterated in EncounterState.ships array order.
//   - RNG draws happen in a fixed phase order (documented per phase below).
//     Any change to draw order is a replay/lockstep-breaking change.
//
// Round timeline:
//   1. engineering repairs        5. torpedoes in flight move/track/detonate
//   2. power allocation           6. new torpedo launches
//   3. science scans              7. phaser fire (simultaneous: compute all, then apply)
//   4. comms hails                8. shield regeneration
//   5'. helm movement (simultaneous) happens before torpedo flight — see below
//   9. warp-outs complete, status evaluated

import { getShipClass } from '../data/ships'
import { KLINGON_HAIL_RESPONSES } from '../data/dialogue'
import {
  ACCURACY_SENSOR_FLOOR,
  ACCURACY_SENSOR_WEIGHT,
  BASE_PHASER_ACCURACY,
  COLLATERAL_CHANCE,
  COLLATERAL_RATIO,
  EVASION_COEFF,
  MAX_HIT_CHANCE,
  MIN_HIT_CHANCE,
  PHASER_MAX_RANGE_DAMAGE,
  REPAIR_HP_PER_ROUND,
  SENSOR_FACTOR_CAP,
  THROTTLE_MAX,
  WARP_OUT_MIN_RANGE,
} from './constants'
import {
  add,
  distance,
  dot,
  headingToward,
  headingVector,
  inArc,
  normalizeHeading,
  scale,
  shieldArcHit,
  sub,
  turnToward,
  type Vec2,
} from './geometry'
import { clampAllocation, powerBudget, systemFactor } from './power'
import { applyDamage, damageSubsystem, round2 } from './ship'
import { nextFloat, pick, roll, type Rng } from './rng'
import {
  SUBSYSTEM_IDS,
  type EncounterState,
  type OrderSet,
  type RoundEvent,
  type ShipState,
  type SubsystemId,
  type TorpedoState,
} from './types'

export interface RoundResult {
  state: EncounterState
  events: RoundEvent[]
}

/**
 * Create a combat encounter. The player ship keeps its persistent damage but is
 * repositioned to the origin; the enemy spawns 18-24 units out with some lateral
 * offset, already turned toward the player.
 */
export function createEncounter(
  playerShip: ShipState,
  enemy: ShipState,
  rng: Rng,
): EncounterState {
  const player: ShipState = structuredClone(playerShip)
  const foe: ShipState = structuredClone(enemy)
  player.pos = { x: 0, y: 0 }
  player.heading = 0
  player.warpedOut = false
  foe.warpedOut = false
  foe.scanLevel = 0
  const dist = 18 + Math.floor(6 * nextFloat(rng))
  const lateral = Math.floor(13 * nextFloat(rng)) - 6
  foe.pos = { x: dist, y: lateral }
  foe.heading = headingToward(foe.pos, player.pos)
  return {
    round: 1,
    ships: [player, foe],
    torpedoes: [],
    nextTorpedoId: 1,
    status: 'active',
    playerShipId: player.id,
  }
}

export function getShip(state: EncounterState, id: string): ShipState {
  const ship = state.ships.find((s) => s.id === id)
  if (!ship) throw new Error(`no ship ${id} in encounter`)
  return ship
}

function livingEnemiesOf(state: EncounterState, ship: ShipState): ShipState[] {
  return state.ships.filter((s) => s.id !== ship.id && s.alive && !s.warpedOut)
}

/** Resolve one WEGO round. Does not mutate `state` or the order sets. */
export function resolveRound(
  state: EncounterState,
  orders: OrderSet[],
  rng: Rng,
): RoundResult {
  const s: EncounterState = structuredClone(state)
  const events: RoundEvent[] = []
  events.push({ type: 'round-start', round: s.round })

  const orderFor = (shipId: string): OrderSet | undefined => orders.find((o) => o.shipId === shipId)
  const active = () => s.ships.filter((sh) => sh.alive && !sh.warpedOut)

  // --- 1. Engineering repairs (ship order). No RNG.
  for (const ship of active()) {
    const repair = orderFor(ship.id)?.engineering.repair
    if (!repair) continue
    const sub = ship.subsystems[repair]
    if (sub.hp >= sub.maxHp) continue
    sub.hp = round2(Math.min(sub.maxHp, sub.hp + REPAIR_HP_PER_ROUND))
    events.push({ type: 'repair', shipId: ship.id, subsystem: repair, hp: sub.hp })
  }

  // --- 2. Power allocation (ship order). No RNG.
  for (const ship of active()) {
    const requested = orderFor(ship.id)?.engineering.power
    const budget = powerBudget(ship)
    ship.power = clampAllocation(requested ?? ship.power, budget)
    events.push({ type: 'power', shipId: ship.id, power: { ...ship.power }, budget })
  }

  // --- 3. Science scans (ship order). No RNG (auto-success with working sensors).
  for (const ship of active()) {
    const targetId = orderFor(ship.id)?.science?.scanTargetId
    if (!targetId) continue
    const target = s.ships.find((t) => t.id === targetId)
    const success = !!target && target.alive && !target.warpedOut && systemFactor(ship, 'sensors') > 0
    if (success && target) target.scanLevel = Math.max(target.scanLevel, 1)
    events.push({ type: 'scan', shipId: ship.id, targetId, success })
  }

  // --- 4. Comms hails (ship order). RNG: one draw per hail (response line).
  for (const ship of active()) {
    if (!orderFor(ship.id)?.comms?.hail) continue
    const foe = livingEnemiesOf(s, ship)[0]
    if (!foe) continue
    const text =
      foe.faction === 'klingon'
        ? pick(rng, KLINGON_HAIL_RESPONSES)
        : '"Channel open. We are listening."'
    events.push({ type: 'hail', shipId: ship.id, targetId: foe.id, text })
  }

  // --- 5. Helm: compute all moves from pre-move state, then apply (simultaneous). No RNG.
  interface Move {
    ship: ShipState
    from: Vec2
    to: Vec2
    headingFrom: number
    headingTo: number
    speed: number
    wantsWarpOut: boolean
  }
  const moves: Move[] = []
  for (const ship of active()) {
    const helm = orderFor(ship.id)?.helm
    const cls = getShipClass(ship.classId)
    const enginesUp = ship.subsystems.engines.hp > 0
    const agility = enginesUp ? cls.agility : 0
    const turn = Math.max(-agility, Math.min(agility, Math.trunc(helm?.turn ?? 0)))
    const headingTo = normalizeHeading(ship.heading + turn)
    const throttle = Math.max(0, Math.min(THROTTLE_MAX, Math.trunc(helm?.throttle ?? 0)))
    const speed = enginesUp
      ? round2((throttle / THROTTLE_MAX) * cls.maxSpeed * systemFactor(ship, 'engines'))
      : 0
    const to = {
      x: round2(ship.pos.x + headingVector(headingTo).x * speed),
      y: round2(ship.pos.y + headingVector(headingTo).y * speed),
    }
    moves.push({
      ship,
      from: { ...ship.pos },
      to,
      headingFrom: ship.heading,
      headingTo,
      speed,
      wantsWarpOut: !!helm?.warpOut,
    })
  }
  const speedThisRound = new Map<string, number>()
  // Movement segments this round, used to resolve fire at closest approach.
  const segments = new Map<string, { from: Vec2; to: Vec2 }>()
  for (const ship of s.ships) segments.set(ship.id, { from: { ...ship.pos }, to: { ...ship.pos } })
  for (const m of moves) {
    m.ship.heading = m.headingTo
    m.ship.pos = m.to
    speedThisRound.set(m.ship.id, m.speed)
    segments.set(m.ship.id, { from: m.from, to: m.to })
    events.push({
      type: 'helm',
      shipId: m.ship.id,
      from: m.from,
      to: m.to,
      headingFrom: m.headingFrom,
      headingTo: m.headingTo,
    })
  }
  // Warp-out validation happens now; the jump itself completes at end of round,
  // so a fleeing ship can still be fired on this round.
  const warpingOut = new Set<string>()
  for (const m of moves) {
    if (!m.wantsWarpOut) continue
    const ship = m.ship
    if (ship.subsystems.engines.hp <= 0) {
      events.push({ type: 'warp-out-failed', shipId: ship.id, reason: 'engines' })
      continue
    }
    const enemies = livingEnemiesOf(s, ship)
    const nearest = Math.min(...enemies.map((e) => distance(ship.pos, e.pos)), Infinity)
    if (nearest < WARP_OUT_MIN_RANGE) {
      events.push({ type: 'warp-out-failed', shipId: ship.id, reason: 'too-close' })
      continue
    }
    warpingOut.add(ship.id)
  }

  // --- 6. Torpedoes in flight (array order): turn, move, proximity-detonate.
  // RNG: collateral roll per hull-damaging hit, in array order.
  const surviving: TorpedoState[] = []
  for (const torp of s.torpedoes) {
    const target = s.ships.find((t) => t.id === torp.targetId)
    if (!target || !target.alive || target.warpedOut) {
      events.push({ type: 'torpedo-expired', id: torp.id, pos: { ...torp.pos } })
      continue
    }
    torp.fuel -= 1
    if (torp.fuel < 0) {
      events.push({ type: 'torpedo-expired', id: torp.id, pos: { ...torp.pos } })
      continue
    }
    torp.heading = turnToward(torp.heading, headingToward(torp.pos, target.pos), torp.turnRate)
    const from: Vec2 = { ...torp.pos }
    const to = add(from, scale(headingVector(torp.heading), torp.speed))
    torp.pos = { x: round2(to.x), y: round2(to.y) }
    events.push({ type: 'torpedo-move', id: torp.id, from, to: { ...torp.pos } })
    // Closest approach along the flight segment, so fast torpedoes can't tunnel
    // through the target between rounds.
    const closest = closestPointOnSegment(from, torp.pos, target.pos)
    if (distance(closest, target.pos) <= torp.proximity) {
      const arc = shieldArcHit(target.pos, target.heading, closest)
      const result = applyDamage(target, arc, torp.damage, null, events)
      events.push({
        type: 'torpedo-hit',
        id: torp.id,
        targetId: target.id,
        arc,
        shieldDamage: result.shieldDamage,
        hullDamage: result.hullDamage,
        pos: closest,
      })
      rollCollateral(target, result.hullDamage, rng, events)
    } else {
      surviving.push(torp)
    }
  }
  s.torpedoes = surviving

  // --- 7. New torpedo launches (ship order), from post-move positions. No RNG.
  for (const ship of active()) {
    const launch = orderFor(ship.id)?.tactical.fireTorpedo
    if (!launch) continue
    const cls = getShipClass(ship.classId)
    if (ship.subsystems.weapons.hp <= 0) {
      events.push({ type: 'torpedo-blocked', shooterId: ship.id, reason: 'weapons-down' })
      continue
    }
    if (ship.power.weapons < 1) {
      events.push({ type: 'torpedo-blocked', shooterId: ship.id, reason: 'no-power' })
      continue
    }
    if (ship.torpedoes < 1) {
      events.push({ type: 'torpedo-blocked', shooterId: ship.id, reason: 'ammo' })
      continue
    }
    const target = s.ships.find((t) => t.id === launch.targetId)
    if (!target || !target.alive || target.warpedOut) continue
    if (!inArc(ship.pos, ship.heading, target.pos, cls.torpedo.cosHalfArc)) {
      events.push({ type: 'torpedo-blocked', shooterId: ship.id, reason: 'arc' })
      continue
    }
    ship.torpedoes -= 1
    const torp: TorpedoState = {
      id: s.nextTorpedoId++,
      ownerId: ship.id,
      targetId: target.id,
      pos: { ...ship.pos },
      heading: ship.heading,
      fuel: cls.torpedo.fuel,
      speed: cls.torpedo.speed,
      damage: cls.torpedo.damage,
      proximity: cls.torpedo.proximity,
      turnRate: 2,
    }
    s.torpedoes.push(torp)
    events.push({
      type: 'torpedo-launch',
      id: torp.id,
      ownerId: ship.id,
      targetId: target.id,
      pos: { ...torp.pos },
    })
  }

  // --- 8. Phasers: WEGO simultaneity — decide and roll every shot against a
  // pre-fire snapshot (ship order; RNG: one accuracy draw per attempted shot),
  // then apply all damage (ship order; RNG: collateral rolls). A ship destroyed
  // this phase still gets its shot off.
  interface Shot {
    shooter: ShipState
    target: ShipState
    hit: boolean
    damage: number
    subsystem: SubsystemId | null
    from: Vec2
    to: Vec2
  }
  const snapshot = structuredClone(s)
  const shots: Shot[] = []
  for (const ship of active()) {
    const fire = orderFor(ship.id)?.tactical.firePhasers
    if (!fire) continue
    const shipSnap = getShip(snapshot, ship.id)
    const cls = getShipClass(ship.classId)
    if (shipSnap.subsystems.weapons.hp <= 0) {
      events.push({ type: 'phaser-blocked', shooterId: ship.id, reason: 'weapons-down' })
      continue
    }
    if (shipSnap.power.weapons < 1) {
      events.push({ type: 'phaser-blocked', shooterId: ship.id, reason: 'no-power' })
      continue
    }
    const targetLive = s.ships.find((t) => t.id === fire.targetId)
    const targetSnap = snapshot.ships.find((t) => t.id === fire.targetId)
    if (!targetLive || !targetSnap || !targetSnap.alive || targetSnap.warpedOut) continue
    // Both ships moved simultaneously this round: the shot happens at some
    // moment during the pass, not at the endpoints. Sample the pass window
    // (closest approach plus fixed fractions) and fire at the closest geometry
    // where range AND firing arc are both satisfied — "shoot when your guns
    // bear". Without this, narrow-arc ships overshooting a target always had
    // it abeam at closest approach and could never fire.
    const shooterSeg = segments.get(ship.id)!
    const targetSeg = segments.get(targetSnap.id)!
    const tStar = closestApproachT(shooterSeg.from, shooterSeg.to, targetSeg.from, targetSeg.to)
    const candidates = [tStar, 0, 0.25, 0.5, 0.75, 1]
    let best: { shooterPos: Vec2; targetPos: Vec2; dist: number } | null = null
    let sawInRange = false
    for (const t of candidates) {
      const sp = lerp(shooterSeg.from, shooterSeg.to, t)
      const tp = lerp(targetSeg.from, targetSeg.to, t)
      const d = distance(sp, tp)
      if (d > cls.phaser.range) continue
      sawInRange = true
      if (!inArc(sp, shipSnap.heading, tp, cls.phaser.cosHalfArc)) continue
      if (!best || d < best.dist) best = { shooterPos: sp, targetPos: tp, dist: d }
    }
    if (!best) {
      events.push({
        type: 'phaser-blocked',
        shooterId: ship.id,
        reason: sawInRange ? 'arc' : 'range',
      })
      continue
    }
    const { shooterPos, targetPos, dist } = best
    // Accuracy: sensors help, target speed evades.
    const sensorFactor = Math.min(systemFactor(shipSnap, 'sensors'), SENSOR_FACTOR_CAP)
    const targetCls = getShipClass(targetSnap.classId)
    const evasion =
      EVASION_COEFF * Math.min(1, (speedThisRound.get(targetSnap.id) ?? 0) / targetCls.maxSpeed)
    const acc = Math.max(
      MIN_HIT_CHANCE,
      Math.min(
        MAX_HIT_CHANCE,
        BASE_PHASER_ACCURACY * (ACCURACY_SENSOR_FLOOR + ACCURACY_SENSOR_WEIGHT * sensorFactor) -
          evasion,
      ),
    )
    const hit = roll(rng, acc)
    const falloff = 1 - (1 - PHASER_MAX_RANGE_DAMAGE) * (dist / cls.phaser.range)
    const damage = round2(cls.phaser.baseDamage * systemFactor(shipSnap, 'weapons') * falloff)
    // Subsystem targeting needs working sensors on the shooter and a completed scan.
    const subsystem =
      fire.subsystem && sensorFactor > 0 && targetSnap.scanLevel >= 1 ? fire.subsystem : null
    shots.push({
      shooter: ship,
      target: targetLive,
      hit,
      damage,
      subsystem,
      from: shooterPos,
      to: targetPos,
    })
  }
  for (const shot of shots) {
    if (!shot.hit) {
      events.push({
        type: 'phaser-fire',
        shooterId: shot.shooter.id,
        targetId: shot.target.id,
        from: shot.from,
        to: shot.to,
        hit: false,
        arc: null,
        shieldDamage: 0,
        hullDamage: 0,
        targetedSubsystem: shot.subsystem,
        subsystemDamage: 0,
      })
      continue
    }
    // Shield facing evaluated at the closest-approach geometry the shot used.
    const arc = shieldArcHit(shot.to, shot.target.heading, shot.from)
    const result = applyDamage(shot.target, arc, shot.damage, shot.subsystem, events)
    events.push({
      type: 'phaser-fire',
      shooterId: shot.shooter.id,
      targetId: shot.target.id,
      from: shot.from,
      to: shot.to,
      hit: true,
      arc,
      shieldDamage: result.shieldDamage,
      hullDamage: result.hullDamage,
      targetedSubsystem: shot.subsystem,
      subsystemDamage: result.subsystemDamage,
    })
    if (!shot.subsystem) rollCollateral(shot.target, result.hullDamage, rng, events)
  }

  // --- 9. Shield regeneration (ship order). No RNG.
  for (const ship of active()) {
    if (ship.subsystems.shields.hp <= 0) continue
    const cls = getShipClass(ship.classId)
    const regen = cls.shieldRegen * systemFactor(ship, 'shields')
    for (const arc of ['fore', 'aft', 'port', 'starboard'] as const) {
      ship.shields[arc] = round2(Math.min(cls.shieldMax, ship.shields[arc] + regen))
    }
  }

  // --- 10. Warp-outs complete, then status evaluation.
  for (const id of warpingOut) {
    const ship = getShip(s, id)
    if (ship.alive) {
      ship.warpedOut = true
      events.push({ type: 'warp-out', shipId: id })
    }
  }
  evaluateStatus(s, events)
  s.round += 1
  return { state: s, events }
}

function evaluateStatus(s: EncounterState, events: RoundEvent[]): void {
  if (s.status !== 'active') return
  const player = getShip(s, s.playerShipId)
  const enemies = s.ships.filter((sh) => sh.id !== s.playerShipId)
  const enemy = enemies[0]
  if (!player.alive) {
    s.status = 'defeat'
  } else if (enemy && !enemy.alive) {
    s.status = 'victory'
  } else if (enemy && enemy.subsystems.weapons.hp <= 0 && enemy.subsystems.engines.hp <= 0) {
    s.status = 'enemy-disabled'
    events.push({ type: 'ship-disabled', shipId: enemy.id })
  } else if (player.warpedOut) {
    s.status = 'withdrawn'
  } else if (enemy && enemy.warpedOut) {
    s.status = 'enemy-withdrawn'
  }
  if (s.status !== 'active') {
    events.push({ type: 'encounter-end', status: s.status })
  }
}

/** Untargeted hull damage can splash into a random subsystem. RNG: 1 draw, +1 on splash. */
function rollCollateral(target: ShipState, hullDamage: number, rng: Rng, events: RoundEvent[]): void {
  if (hullDamage <= 0 || !target.alive) return
  if (!roll(rng, COLLATERAL_CHANCE)) return
  const system = pick(rng, SUBSYSTEM_IDS)
  damageSubsystem(target, system, round2(hullDamage * COLLATERAL_RATIO), events)
}

function closestPointOnSegment(a: Vec2, b: Vec2, p: Vec2): Vec2 {
  const ab = sub(b, a)
  const abLenSq = dot(ab, ab)
  if (abLenSq === 0) return { ...a }
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / abLenSq))
  return add(a, scale(ab, t))
}

/**
 * Time t in [0,1] at which two ships moving linearly through their round
 * segments are closest: minimize |(a0-b0) + t((a1-a0)-(b1-b0))| — a closed-form
 * quadratic, so it stays deterministic.
 */
function closestApproachT(aFrom: Vec2, aTo: Vec2, bFrom: Vec2, bTo: Vec2): number {
  const d0 = sub(aFrom, bFrom)
  const dv = sub(sub(aTo, aFrom), sub(bTo, bFrom))
  const dvLenSq = dot(dv, dv)
  if (dvLenSq === 0) return 1
  return Math.max(0, Math.min(1, -dot(d0, dv) / dvLenSq))
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}
