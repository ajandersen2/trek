// Tactical board: draws EncounterState statically and replays WEGO rounds as
// a sequential animation. Display state (ship views, torpedo dots) is
// render-owned deep copies — the final redraw from finalState is the single
// source of truth after every round, so animation drift can never accumulate.

import Phaser from 'phaser'
import { getShipClass } from '../data/ships'
import { headingDelta, type ArcId, type Vec2 } from '../sim/geometry'
import { ARC_IDS, type EncounterState, type RoundEvent, type ShipState } from '../sim/types'
import { COLORS, FONT_STACK, css, hullColor, mix } from './palette'
import { drawBeam, fillGlowDot, strokeArcSegment, strokeGlowLine } from './fx'
import { beamColor, drawShip, drawWreck, factionColor, hullFragments } from './silhouettes'
import {
  boundsOf,
  fitProjection,
  headingToRotation,
  project,
  unionBounds,
  type Bounds,
  type Projection,
} from './project'

export const TACTICAL_SCENE_KEY = 'tactical'

const SHIP_PX = 28
const SHIELD_RADIUS = 22
const WORLD_PAD = 12 // sim units of padding around the fitted board
const MAX_SCALE = 16 // px per sim unit cap
const FIT_MARGIN = 36 // px kept clear inside the canvas edge
const PROJ_TWEEN_MS = 400
const ROUND_BUDGET_MS = 6500
const GRID_STEP = 5 // sim units between range rings

// Shield-arc center angles in the rotated rig frame: +X is the facing, and
// after the sim→screen Y flip local +Y (screen down) is the starboard side.
const ARC_CENTERS: Record<ArcId, number> = {
  fore: 0,
  starboard: Math.PI / 2,
  aft: Math.PI,
  port: -Math.PI / 2,
}
const ARC_HALF = Math.PI / 4 - 0.1 // 90° quadrant minus a visual gap

type HelmEvent = Extract<RoundEvent, { type: 'helm' }>
type TorpedoMoveEvent = Extract<RoundEvent, { type: 'torpedo-move' }>

type Step =
  | { kind: 'helm'; events: HelmEvent[] }
  | { kind: 'torpedo-moves'; events: TorpedoMoveEvent[] }
  | { kind: 'event'; event: RoundEvent }

interface ShipView {
  /** Render-owned deep copy; mutated only for display bookkeeping. */
  ship: ShipState
  shieldMax: number
  container: Phaser.GameObjects.Container
  rig: Phaser.GameObjects.Container
  body: Phaser.GameObjects.Graphics
  shieldsG: Phaser.GameObjects.Graphics
  hullG: Phaser.GameObjects.Graphics
  label: Phaser.GameObjects.Text
  /** World-space pose; rot is in (fractional) heading steps for tweening. */
  world: { x: number; y: number; rot: number }
}

interface TorpedoView {
  container: Phaser.GameObjects.Container
  world: { x: number; y: number }
}

export class TacticalScene extends Phaser.Scene {
  private board: EncounterState | null = null
  private views = new Map<string, ShipView>()
  private torps = new Map<number, TorpedoView>()
  private gridG!: Phaser.GameObjects.Graphics
  private fxLayer!: Phaser.GameObjects.Container
  private proj: Projection = { scale: 10, ox: 0, oy: 0 }
  private gridCenter: Vec2 = { x: 0, y: 0 }
  private run: Promise<void> | null = null
  private ff = false
  private pending = new Set<() => void>()
  private floatSlots = new Map<string, number>()

  constructor() {
    super(TACTICAL_SCENE_KEY)
  }

  create(): void {
    this.gridG = this.add.graphics().setDepth(0)
    this.fxLayer = this.add.container(0, 0).setDepth(5)
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this)
    this.events.on(Phaser.Scenes.Events.WAKE, this.onResize, this)
  }

  // -------------------------------------------------------------- public API

  showEncounter(state: EncounterState): void {
    this.board = state
    if (this.run) {
      // A replay is in flight: fast-forward it; its epilogue redraws from
      // this.board, which we just replaced.
      this.fastForwardNow()
      return
    }
    this.drawStatic(state, true)
  }

  async animateRound(events: RoundEvent[], finalState: EncounterState): Promise<void> {
    while (this.run) {
      this.fastForwardNow()
      await this.run.catch(() => undefined)
    }
    this.ff = false
    this.board = finalState
    const run = this.playRound(events).finally(() => {
      this.run = null
    })
    this.run = run
    return run
  }

  /** Force any active replay to finish immediately (its promise still resolves). */
  cancelActiveRun(): void {
    if (this.run) this.fastForwardNow()
  }

  // ---------------------------------------------------------- async plumbing

  private fastForwardNow(): void {
    this.ff = true
    const forces = [...this.pending]
    this.pending.clear()
    for (const force of forces) force()
  }

  /** delayedCall as a promise; resolves instantly while fast-forwarding. */
  private wait(ms: number): Promise<void> {
    if (this.ff || ms <= 0) return Promise.resolve()
    return new Promise((resolve) => {
      const done = (): void => {
        this.pending.delete(force)
        resolve()
      }
      const timer = this.time.delayedCall(ms, done)
      const force = (): void => {
        timer.remove(false)
        done()
      }
      this.pending.add(force)
    })
  }

  /** Tween as a promise; skipped entirely while fast-forwarding. */
  private tweenAsync(cfg: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    if (this.ff) return Promise.resolve()
    return new Promise((resolve) => {
      const done = (): void => {
        this.pending.delete(force)
        resolve()
      }
      const tween = this.tweens.add({ ...cfg, onComplete: done })
      const force = (): void => {
        tween.complete()
      }
      this.pending.add(force)
    })
  }

  // ------------------------------------------------------------- static draw

  private onResize(): void {
    if (!this.board) return
    this.tweens.killTweensOf(this.proj)
    this.proj = this.fitTo(this.currentBounds())
    this.layoutAll()
  }

  private drawStatic(state: EncounterState, fullReset: boolean): void {
    if (fullReset) {
      this.fastForwardNow()
      this.tweens.killAll()
      this.fxLayer.removeAll(true)
    }
    this.tweens.killTweensOf(this.proj)
    this.clearViews()
    this.board = state

    const present = state.ships.filter((s) => !s.warpedOut)
    if (present.length > 0) {
      this.gridCenter = {
        x: present.reduce((acc, s) => acc + s.pos.x, 0) / present.length,
        y: present.reduce((acc, s) => acc + s.pos.y, 0) / present.length,
      }
    }
    this.proj = this.fitTo(boardBounds(state))
    for (const ship of present) this.views.set(ship.id, this.createShipView(ship))
    for (const torp of state.torpedoes) {
      this.torps.set(torp.id, this.createTorpedoView(torp.pos, headingToRotation(torp.heading)))
    }
    this.layoutAll()
  }

  private clearViews(): void {
    for (const view of this.views.values()) {
      this.tweens.killTweensOf(view.world)
      this.tweens.killTweensOf(view.rig)
      this.tweens.killTweensOf(view.container)
      this.tweens.killTweensOf(view.label)
      view.container.destroy()
    }
    this.views.clear()
    for (const torp of this.torps.values()) {
      this.tweens.killTweensOf(torp.world)
      this.tweens.killTweensOf(torp.container)
      torp.container.destroy()
    }
    this.torps.clear()
  }

  private fitTo(b: Bounds): Projection {
    return fitProjection(b, this.scale.width, this.scale.height, FIT_MARGIN, MAX_SCALE)
  }

  private currentBounds(): Bounds {
    const pts: Vec2[] = []
    for (const view of this.views.values()) pts.push({ x: view.world.x, y: view.world.y })
    for (const torp of this.torps.values()) pts.push({ x: torp.world.x, y: torp.world.y })
    return boundsOf(pts, WORLD_PAD)
  }

  private createShipView(src: ShipState): ShipView {
    const ship = structuredClone(src)
    const body = this.add.graphics()
    const shieldsG = this.add.graphics()
    const rig = this.add.container(0, 0, [shieldsG, body])
    const hullG = this.add.graphics()
    const label = this.add
      .text(0, SHIELD_RADIUS + 12, ship.name.toUpperCase(), {
        fontFamily: FONT_STACK,
        fontSize: '10px',
        color: css(ship.faction === 'federation' ? COLORS.peach : mix(COLORS.klingon, COLORS.white, 0.25)),
      })
      .setOrigin(0.5, 0)
      .setLetterSpacing(1.2)
      .setAlpha(0.9)
    const container = this.add.container(0, 0, [rig, hullG, label]).setDepth(2)
    const view: ShipView = {
      ship,
      shieldMax: getShipClass(ship.classId).shieldMax,
      container,
      rig,
      body,
      shieldsG,
      hullG,
      label,
      world: { x: ship.pos.x, y: ship.pos.y, rot: ship.heading },
    }
    this.redrawShip(view)
    return view
  }

  private redrawShip(view: ShipView): void {
    view.body.clear()
    view.shieldsG.clear()
    if (view.ship.alive) {
      drawShip(view.body, view.ship.faction, SHIP_PX)
      this.drawShieldArcs(view)
    } else {
      drawWreck(view.body, view.ship.faction, SHIP_PX)
    }
    this.drawHullBar(view)
  }

  /** Enemy shield/subsystem detail is hidden until scanned (scanLevel >= 1). */
  private shieldsVisible(view: ShipView): boolean {
    return view.ship.alive && (view.ship.id === this.board?.playerShipId || view.ship.scanLevel >= 1)
  }

  private drawShieldArcs(view: ShipView): void {
    if (!this.shieldsVisible(view)) return
    const color = view.ship.faction === 'federation' ? COLORS.shieldPlayer : COLORS.klingon
    for (const arc of ARC_IDS) {
      const f = Math.max(0, Math.min(1, view.ship.shields[arc] / view.shieldMax))
      if (f <= 0.02) continue // collapsed arc: absent
      const g = view.shieldsG
      strokeArcSegment(g, 0, 0, SHIELD_RADIUS, ARC_CENTERS[arc], ARC_HALF, 3.5, color, 0.1 + 0.3 * f)
      strokeArcSegment(
        g,
        0,
        0,
        SHIELD_RADIUS,
        ARC_CENTERS[arc],
        ARC_HALF,
        1 + 1.6 * f,
        mix(color, COLORS.white, 0.25),
        0.25 + 0.5 * f,
      )
    }
  }

  private drawHullBar(view: ShipView): void {
    const g = view.hullG
    g.clear()
    const w = 38
    const y = SHIELD_RADIUS + 5
    const frac = view.ship.maxHull > 0 ? Math.max(0, Math.min(1, view.ship.hull / view.ship.maxHull)) : 0
    g.fillStyle(0x1a2233, 0.85)
    g.fillRect(-w / 2, y, w, 3.5)
    if (frac > 0) {
      g.fillStyle(hullColor(frac), 0.95)
      g.fillRect(-w / 2, y, w * frac, 3.5)
    }
    g.lineStyle(1, 0x334455, 0.9)
    g.strokeRect(-w / 2, y, w, 3.5)
  }

  private createTorpedoView(pos: Vec2, rotation: number): TorpedoView {
    const g = this.add.graphics()
    fillGlowDot(g, 0, 0, 2.6, COLORS.torpedo)
    // Fading trail behind the flight direction (local -X).
    g.fillStyle(COLORS.torpedo, 0.5)
    g.fillCircle(-7, 0, 1.8)
    g.fillStyle(COLORS.torpedo, 0.28)
    g.fillCircle(-12, 0, 1.4)
    g.fillStyle(COLORS.torpedo, 0.12)
    g.fillCircle(-17, 0, 1)
    const container = this.add.container(0, 0, [g]).setDepth(3)
    container.setRotation(rotation)
    const view: TorpedoView = { container, world: { x: pos.x, y: pos.y } }
    this.applyTorpedo(view)
    return view
  }

  private layoutAll(): void {
    for (const view of this.views.values()) this.applyShip(view)
    for (const torp of this.torps.values()) this.applyTorpedo(torp)
    this.drawGrid()
  }

  private applyShip(view: ShipView): void {
    const p = project(this.proj, view.world)
    view.container.setPosition(p.x, p.y)
    view.rig.setRotation(headingToRotation(view.world.rot))
  }

  private applyTorpedo(view: TorpedoView): void {
    const p = project(this.proj, view.world)
    view.container.setPosition(p.x, p.y)
  }

  /** Faint polar graticule: range rings every 5 sim units from the midpoint. */
  private drawGrid(): void {
    const g = this.gridG
    g.clear()
    const c = project(this.proj, this.gridCenter)
    const w = this.scale.width
    const h = this.scale.height
    const maxPx = Math.hypot(Math.max(c.x, w - c.x), Math.max(c.y, h - c.y))
    const step = GRID_STEP * this.proj.scale
    if (step < 6) return // zoomed out far enough that rings would be soup
    for (let r = step, i = 1; r <= maxPx; r += step, i++) {
      g.lineStyle(1, COLORS.grid, i % 4 === 0 ? 0.16 : 0.09)
      g.strokeCircle(c.x, c.y, r)
    }
    g.lineStyle(1, COLORS.grid, 0.06)
    g.lineBetween(c.x - maxPx, c.y, c.x + maxPx, c.y)
    g.lineBetween(c.x, c.y - maxPx, c.x, c.y + maxPx)
  }

  // ------------------------------------------------------------ round replay

  private async playRound(events: RoundEvent[]): Promise<void> {
    const steps = buildSteps(events)
    const k = timeScale(steps)
    this.floatSlots.clear()
    this.tweenProjection()
    for (const step of steps) {
      if (this.ff) break
      await this.runStep(step, k)
    }
    // Single source of truth: never trust accumulated animation state.
    if (this.board) this.drawStatic(this.board, false)
  }

  /** Smooth ~400ms re-fit covering both current and end-of-round positions. */
  private tweenProjection(): void {
    if (!this.board) return
    const target = this.fitTo(unionBounds(this.currentBounds(), boardBounds(this.board)))
    this.tweens.killTweensOf(this.proj)
    if (this.ff) {
      this.proj = target
      this.layoutAll()
      return
    }
    this.tweens.add({
      targets: this.proj,
      props: { scale: target.scale, ox: target.ox, oy: target.oy },
      duration: PROJ_TWEEN_MS,
      ease: 'Sine.easeInOut',
      onUpdate: () => this.layoutAll(),
    })
  }

  private async runStep(step: Step, k: number): Promise<void> {
    switch (step.kind) {
      case 'helm':
        await Promise.all(step.events.map((ev) => this.animateHelm(ev, k)))
        return
      case 'torpedo-moves':
        await Promise.all(step.events.map((ev) => this.animateTorpedoMove(ev, k)))
        return
      case 'event':
        await this.runEvent(step.event, k)
        return
    }
  }

  private animateHelm(ev: HelmEvent, k: number): Promise<void> {
    const view = this.views.get(ev.shipId)
    if (!view) return Promise.resolve()
    const rotTo = view.world.rot + headingDelta(ev.headingFrom, ev.headingTo)
    return this.tweenAsync({
      targets: view.world,
      props: { x: ev.to.x, y: ev.to.y, rot: rotTo },
      duration: 700 * k,
      ease: 'Sine.easeInOut',
      onUpdate: () => this.applyShip(view),
    })
  }

  private animateTorpedoMove(ev: TorpedoMoveEvent, k: number): Promise<void> {
    let found = this.torps.get(ev.id)
    if (!found) {
      found = this.createTorpedoView(ev.from, 0)
      this.torps.set(ev.id, found)
    }
    const view = found
    view.world.x = ev.from.x
    view.world.y = ev.from.y
    const dx = ev.to.x - ev.from.x
    const dy = ev.to.y - ev.from.y
    if (dx !== 0 || dy !== 0) view.container.setRotation(Math.atan2(-dy, dx))
    return this.tweenAsync({
      targets: view.world,
      props: { x: ev.to.x, y: ev.to.y },
      duration: 450 * k,
      ease: 'Linear',
      onUpdate: () => this.applyTorpedo(view),
    })
  }

  private async runEvent(ev: RoundEvent, k: number): Promise<void> {
    switch (ev.type) {
      case 'torpedo-launch': {
        this.torps.get(ev.id)?.container.destroy()
        const target = this.views.get(ev.targetId)
        const rotation = target
          ? Math.atan2(-(target.world.y - ev.pos.y), target.world.x - ev.pos.x)
          : headingToRotation(this.views.get(ev.ownerId)?.world.rot ?? 0)
        this.torps.set(ev.id, this.createTorpedoView(ev.pos, rotation))
        this.spawnRing(ev.pos, 12, COLORS.torpedo, 260 * k)
        await this.wait(300 * k)
        return
      }
      case 'torpedo-hit': {
        const torp = this.torps.get(ev.id)
        if (torp) {
          this.tweens.killTweensOf(torp.world)
          torp.container.destroy()
          this.torps.delete(ev.id)
        }
        this.spawnFlash(ev.pos, 10, COLORS.white, 220 * k)
        this.spawnRing(ev.pos, 26, COLORS.torpedo, 460 * k)
        this.cameras.main.shake(140, 0.005)
        const view = this.views.get(ev.targetId)
        if (view) {
          view.ship.shields[ev.arc] = Math.max(0, view.ship.shields[ev.arc] - ev.shieldDamage)
          view.ship.hull = Math.max(0, view.ship.hull - ev.hullDamage)
          this.redrawShip(view)
          if (ev.shieldDamage > 0.05) {
            this.flashShieldArc(view, ev.arc)
            this.floatText(view, `-${fmt(ev.shieldDamage)} SHLD`, COLORS.peach, k)
          }
          if (ev.hullDamage > 0.05) this.floatText(view, `-${fmt(ev.hullDamage)} HULL`, COLORS.red, k)
        }
        await this.wait(460 * k)
        return
      }
      case 'torpedo-expired': {
        const torp = this.torps.get(ev.id)
        this.spawnRing(ev.pos, 8, COLORS.slate, 300 * k)
        if (torp) {
          this.torps.delete(ev.id)
          await this.tweenAsync({
            targets: torp.container,
            props: { alpha: 0 },
            duration: 320 * k,
            ease: 'Sine.easeIn',
          })
          torp.container.destroy()
        } else {
          await this.wait(320 * k)
        }
        return
      }
      case 'phaser-fire': {
        await this.animatePhaser(ev, k)
        return
      }
      case 'subsystem-damaged': {
        const view = this.views.get(ev.shipId)
        if (view) {
          view.ship.subsystems[ev.subsystem].hp = ev.hp
          const text = `${ev.subsystem} ${ev.disabled ? 'OFFLINE' : 'HIT'}`
          this.floatText(view, text, ev.disabled ? COLORS.red : COLORS.gold, k)
        }
        await this.wait(300 * k)
        return
      }
      case 'repair': {
        const view = this.views.get(ev.shipId)
        if (view) {
          const gained = Math.max(0, ev.hp - view.ship.subsystems[ev.subsystem].hp)
          view.ship.subsystems[ev.subsystem].hp = ev.hp
          const text = gained > 0.05 ? `${ev.subsystem} +${fmt(gained)}` : `${ev.subsystem} repaired`
          this.floatText(view, text, COLORS.repair, k)
        }
        await this.wait(300 * k)
        return
      }
      case 'scan': {
        await this.animateScan(ev.shipId, ev.targetId, ev.success, k)
        return
      }
      case 'hail': {
        await this.animateHail(ev.shipId, k)
        return
      }
      case 'warp-out': {
        await this.animateWarpOut(ev.shipId, k)
        return
      }
      case 'ship-destroyed': {
        await this.animateDestroyed(ev.shipId, k)
        return
      }
      case 'ship-disabled': {
        const view = this.views.get(ev.shipId)
        if (!view) return
        this.floatText(view, 'DISABLED', COLORS.red, k)
        const anim = { t: 0 }
        await this.tweenAsync({
          targets: anim,
          props: { t: 1 },
          duration: 620 * k,
          onUpdate: () => {
            view.rig.setAlpha(0.35 + 0.65 * Math.abs(Math.cos(anim.t * Math.PI * 3)))
          },
        })
        view.rig.setAlpha(0.55) // dim ember until the final redraw
        await this.wait(80 * k)
        return
      }
      default:
        return
    }
  }

  private async animatePhaser(ev: Extract<RoundEvent, { type: 'phaser-fire' }>, k: number): Promise<void> {
    const shooter = this.views.get(ev.shooterId)
    const color = beamColor(shooter ? shooter.ship.faction : 'federation')
    let to = ev.to
    if (!ev.hit) {
      // Angle the errant beam slightly past the target.
      const dx = ev.to.x - ev.from.x
      const dy = ev.to.y - ev.from.y
      const len = Math.hypot(dx, dy) || 1
      const sign = ev.shooterId.length % 2 === 0 ? 1 : -1
      const ang = Math.atan2(dy, dx) + 0.16 * sign
      to = { x: ev.from.x + Math.cos(ang) * len * 1.18, y: ev.from.y + Math.sin(ang) * len * 1.18 }
    }
    const g = this.add.graphics()
    this.fxLayer.add(g)
    const a = project(this.proj, ev.from)
    const b = project(this.proj, to)
    drawBeam(g, a.x, a.y, b.x, b.y, color)

    const target = this.views.get(ev.targetId)
    if (ev.hit) {
      this.spawnFlash(ev.to, 7, mix(color, COLORS.white, 0.5), 240 * k)
      this.cameras.main.shake(90, 0.003)
      if (target) {
        if (ev.arc) {
          target.ship.shields[ev.arc] = Math.max(0, target.ship.shields[ev.arc] - ev.shieldDamage)
          if (ev.shieldDamage > 0.05) this.flashShieldArc(target, ev.arc)
        }
        target.ship.hull = Math.max(0, target.ship.hull - ev.hullDamage)
        this.redrawShip(target)
        if (ev.shieldDamage > 0.05) this.floatText(target, `-${fmt(ev.shieldDamage)} SHLD`, COLORS.peach, k)
        if (ev.hullDamage > 0.05) this.floatText(target, `-${fmt(ev.hullDamage)} HULL`, COLORS.red, k)
      }
    } else if (target) {
      this.floatText(target, 'MISS', COLORS.slate, k)
    }
    await this.wait(260 * k)
    await this.tweenAsync({ targets: g, props: { alpha: 0 }, duration: 160 * k, ease: 'Sine.easeIn' })
    g.destroy()
  }

  private async animateScan(shipId: string, targetId: string, success: boolean, k: number): Promise<void> {
    const scanner = this.views.get(shipId)
    const target = this.views.get(targetId)
    if (!scanner || !target) {
      await this.wait(200 * k)
      return
    }
    const a = project(this.proj, scanner.world)
    const b = project(this.proj, target.world)
    const reach = Math.hypot(b.x - a.x, b.y - a.y) + 26
    const g = this.add.graphics()
    this.fxLayer.add(g)
    const anim = { t: 0 }
    await this.tweenAsync({
      targets: anim,
      props: { t: 1 },
      duration: 520 * k,
      ease: 'Sine.easeOut',
      onUpdate: () => {
        g.clear()
        const r = 6 + (reach - 6) * anim.t
        g.lineStyle(1.4, COLORS.lavender, 0.7 * (1 - anim.t) + 0.1)
        g.strokeCircle(a.x, a.y, r)
        g.lineStyle(1, COLORS.lavender, 0.3 * (1 - anim.t))
        g.strokeCircle(a.x, a.y, r * 0.72)
      },
    })
    g.destroy()
    if (success) {
      target.ship.scanLevel = Math.max(target.ship.scanLevel, 1)
      this.redrawShip(target) // readout (shield arcs) brightens in
      if (!this.ff) {
        this.tweens.add({
          targets: target.label,
          props: { alpha: 1 },
          duration: 150 * k,
          yoyo: true,
          repeat: 1,
        })
      }
    }
    await this.wait(120 * k)
  }

  private async animateHail(shipId: string, k: number): Promise<void> {
    const view = this.views.get(shipId)
    if (!view) return
    const g = this.add.graphics()
    fillGlowDot(g, 0, 0, 1.6, COLORS.peach)
    // Two signal arcs opening upward (screen angles: -π/2 is up).
    g.lineStyle(1.3, COLORS.peach, 0.9)
    g.beginPath()
    g.arc(0, 0, 5.5, -2.2, -0.94)
    g.strokePath()
    g.lineStyle(1.1, COLORS.peach, 0.6)
    g.beginPath()
    g.arc(0, 0, 9.5, -2.2, -0.94)
    g.strokePath()
    const p = project(this.proj, view.world)
    const glyph = this.add.container(p.x, p.y - SHIELD_RADIUS - 16, [g])
    this.fxLayer.add(glyph)
    await this.tweenAsync({
      targets: glyph,
      props: { alpha: 0.15 },
      duration: 90 * k,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
    })
    glyph.destroy()
    await this.wait(140 * k)
  }

  private async animateWarpOut(shipId: string, k: number): Promise<void> {
    const view = this.views.get(shipId)
    if (!view) return
    this.views.delete(shipId)
    const theta = (view.world.rot * Math.PI) / 8 // sim-space facing angle
    const dir = { x: Math.cos(theta), y: Math.sin(theta) }
    const p0 = project(this.proj, view.world)
    const p1 = project(this.proj, { x: view.world.x + dir.x * 14, y: view.world.y + dir.y * 14 })
    if (!this.ff) {
      const streak = this.add.graphics()
      this.fxLayer.add(streak)
      drawBeam(streak, p0.x, p0.y, p1.x, p1.y, mix(factionColor(view.ship.faction), COLORS.white, 0.4))
      this.tweens.add({
        targets: streak,
        props: { alpha: 0 },
        duration: 500 * k,
        ease: 'Sine.easeIn',
        onComplete: () => streak.destroy(),
      })
      this.tweens.add({
        targets: [view.label, view.hullG, view.shieldsG],
        props: { alpha: 0 },
        duration: 200 * k,
      })
    }
    await Promise.all([
      this.tweenAsync({
        targets: view.rig,
        props: { scaleX: 6, scaleY: 0.2, alpha: 0 },
        duration: 520 * k,
        ease: 'Cubic.easeIn',
      }),
      this.tweenAsync({
        targets: view.world,
        props: { x: view.world.x + dir.x * 10, y: view.world.y + dir.y * 10 },
        duration: 520 * k,
        ease: 'Cubic.easeIn',
        onUpdate: () => this.applyShip(view),
      }),
    ])
    this.tweens.killTweensOf(view.label)
    this.tweens.killTweensOf(view.hullG)
    this.tweens.killTweensOf(view.shieldsG)
    view.container.destroy()
    await this.wait(120 * k)
  }

  private async animateDestroyed(shipId: string, k: number): Promise<void> {
    const view = this.views.get(shipId)
    if (!view) return
    const pos = { x: view.world.x, y: view.world.y }
    this.cameras.main.shake(280, 0.008)
    this.spawnFlash(pos, 16, COLORS.white, 260 * k)
    this.spawnRing(pos, 30, COLORS.torpedo, 620 * k)
    this.scatterFragments(view, pos, k)
    await this.wait(140 * k)
    view.ship.alive = false
    view.ship.hull = 0
    this.redrawShip(view) // broken outline + debris under the fireball
    await this.wait(120 * k)
    this.spawnRing(pos, 38, COLORS.gold, 620 * k)
    await this.wait(120 * k)
    this.spawnRing(pos, 46, COLORS.red, 640 * k)
    await this.wait(600 * k)
  }

  private scatterFragments(view: ShipView, pos: Vec2, k: number): void {
    if (this.ff) return
    const frags = hullFragments(view.ship.faction, SHIP_PX)
    const baseRot = headingToRotation(view.world.rot)
    const p = project(this.proj, pos)
    frags.forEach((seg, i) => {
      const g = this.add.graphics()
      strokeGlowLine(g, seg[0].x, seg[0].y, seg[1].x, seg[1].y, factionColor(view.ship.faction), 0.8)
      g.setPosition(p.x, p.y)
      g.setRotation(baseRot)
      this.fxLayer.add(g)
      const ang = baseRot + (Math.PI * 2 * i) / frags.length + 0.5
      this.tweens.add({
        targets: g,
        props: {
          x: p.x + Math.cos(ang) * (20 + i * 7),
          y: p.y + Math.sin(ang) * (20 + i * 7),
          rotation: baseRot + (i % 2 === 0 ? 1.6 : -1.3),
          alpha: 0,
        },
        duration: 780 * k,
        ease: 'Sine.easeOut',
        onComplete: () => g.destroy(),
      })
    })
  }

  // ------------------------------------------------------------ transient FX

  /** Expanding ring; self-cleaning and skipped entirely while fast-forwarding. */
  private spawnRing(pos: Vec2, endR: number, color: number, ms: number): void {
    if (this.ff) return
    const p = project(this.proj, pos)
    const g = this.add.graphics()
    this.fxLayer.add(g)
    const anim = { t: 0 }
    this.tweens.add({
      targets: anim,
      props: { t: 1 },
      duration: ms,
      ease: 'Sine.easeOut',
      onUpdate: () => {
        g.clear()
        const r = 2 + (endR - 2) * anim.t
        g.lineStyle(3.6, color, 0.15 * (1 - anim.t))
        g.strokeCircle(p.x, p.y, r)
        g.lineStyle(1.6, mix(color, COLORS.white, 0.4), 0.85 * (1 - anim.t))
        g.strokeCircle(p.x, p.y, r)
      },
      onComplete: () => g.destroy(),
    })
  }

  private spawnFlash(pos: Vec2, endR: number, color: number, ms: number): void {
    if (this.ff) return
    const p = project(this.proj, pos)
    const g = this.add.graphics()
    this.fxLayer.add(g)
    const anim = { t: 0 }
    this.tweens.add({
      targets: anim,
      props: { t: 1 },
      duration: ms,
      ease: 'Sine.easeOut',
      onUpdate: () => {
        g.clear()
        const fade = 1 - anim.t
        const r = 2 + endR * anim.t
        g.fillStyle(mix(color, COLORS.white, 0.6), 0.7 * fade)
        g.fillCircle(p.x, p.y, r)
        g.fillStyle(color, 0.25 * fade)
        g.fillCircle(p.x, p.y, r * 1.8)
      },
      onComplete: () => g.destroy(),
    })
  }

  /** Brief bright overlay on the struck shield quadrant (rotates with the rig). */
  private flashShieldArc(view: ShipView, arc: ArcId): void {
    if (this.ff || !this.shieldsVisible(view)) return
    const color = view.ship.faction === 'federation' ? COLORS.shieldPlayer : COLORS.klingon
    const g = this.add.graphics()
    strokeArcSegment(g, 0, 0, SHIELD_RADIUS, ARC_CENTERS[arc], ARC_HALF, 3, mix(color, COLORS.white, 0.65), 0.95)
    view.rig.add(g)
    this.tweens.add({
      targets: g,
      props: { alpha: 0 },
      duration: 400,
      ease: 'Sine.easeIn',
      onComplete: () => g.destroy(),
    })
  }

  /** Rising, fading damage/status text above a ship; stacks within a round. */
  private floatText(view: ShipView, text: string, color: number, k: number): void {
    if (this.ff) return
    const slot = this.floatSlots.get(view.ship.id) ?? 0
    this.floatSlots.set(view.ship.id, slot + 1)
    const p = project(this.proj, view.world)
    const t = this.add
      .text(p.x, p.y - SHIELD_RADIUS - 14 - (slot % 4) * 14, text.toUpperCase(), {
        fontFamily: FONT_STACK,
        fontSize: '11px',
        color: css(color),
      })
      .setOrigin(0.5, 1)
      .setLetterSpacing(1)
    this.fxLayer.add(t)
    this.tweens.add({
      targets: t,
      props: { y: t.y - 20, alpha: 0 },
      delay: 260 * k,
      duration: 700 * k,
      ease: 'Sine.easeIn',
      onComplete: () => t.destroy(),
    })
  }
}

// ------------------------------------------------------------------- helpers

function boardBounds(state: EncounterState): Bounds {
  const pts: Vec2[] = []
  for (const ship of state.ships) if (!ship.warpedOut) pts.push(ship.pos)
  for (const torp of state.torpedoes) pts.push(torp.pos)
  return boundsOf(pts, WORLD_PAD)
}

/**
 * applyDamage() in the sim pushes its detail events (subsystem-damaged,
 * ship-destroyed) BEFORE the torpedo-hit/phaser-fire event that caused them.
 * Replaying literally would explode a ship before the killing blow lands, so
 * move each detail block to just after its cause when the event that follows
 * the block is a hit on the same ship.
 */
function reorderCauseFirst(events: RoundEvent[]): RoundEvent[] {
  const out: RoundEvent[] = []
  let i = 0
  while (i < events.length) {
    const ev = events[i]!
    if (ev.type === 'subsystem-damaged' || ev.type === 'ship-destroyed') {
      const block: RoundEvent[] = []
      let j = i
      while (j < events.length) {
        const d = events[j]!
        if ((d.type === 'subsystem-damaged' || d.type === 'ship-destroyed') && d.shipId === ev.shipId) {
          block.push(d)
          j++
        } else {
          break
        }
      }
      const next = events[j]
      if (next && (next.type === 'torpedo-hit' || next.type === 'phaser-fire') && next.targetId === ev.shipId) {
        out.push(next, ...block)
        i = j + 1
        continue
      }
      out.push(...block)
      i = j
      continue
    }
    out.push(ev)
    i++
  }
  return out
}

const ANIMATED_EVENTS = new Set<RoundEvent['type']>([
  'repair',
  'scan',
  'hail',
  'torpedo-launch',
  'torpedo-expired',
  'torpedo-hit',
  'phaser-fire',
  'subsystem-damaged',
  'warp-out',
  'ship-destroyed',
  'ship-disabled',
])

/**
 * Sequential replay plan: consecutive helm events collapse into one parallel
 * step, as do consecutive torpedo-moves; everything else animated plays as
 * its own step. round-start/power/blocked/log events belong to the UI log.
 */
function buildSteps(events: RoundEvent[]): Step[] {
  const steps: Step[] = []
  for (const ev of reorderCauseFirst(events)) {
    const last = steps[steps.length - 1]
    if (ev.type === 'helm') {
      if (last && last.kind === 'helm') last.events.push(ev)
      else steps.push({ kind: 'helm', events: [ev] })
    } else if (ev.type === 'torpedo-move') {
      if (last && last.kind === 'torpedo-moves') last.events.push(ev)
      else steps.push({ kind: 'torpedo-moves', events: [ev] })
    } else if (ANIMATED_EVENTS.has(ev.type)) {
      steps.push({ kind: 'event', event: ev })
    }
  }
  return steps
}

function stepBaseMs(step: Step): number {
  switch (step.kind) {
    case 'helm':
      return 780
    case 'torpedo-moves':
      return 520
    case 'event':
      switch (step.event.type) {
        case 'torpedo-launch':
          return 340
        case 'torpedo-hit':
          return 500
        case 'torpedo-expired':
          return 360
        case 'phaser-fire':
          return 540
        case 'subsystem-damaged':
          return 330
        case 'repair':
          return 330
        case 'scan':
          return 560
        case 'hail':
          return 500
        case 'warp-out':
          return 700
        case 'ship-destroyed':
          return 1050
        case 'ship-disabled':
          return 700
        default:
          return 300
      }
  }
}

/** Compress dense rounds so the whole replay stays inside the time budget. */
function timeScale(steps: Step[]): number {
  const total = steps.reduce((ms, step) => ms + stepBaseMs(step), 0)
  if (total <= ROUND_BUDGET_MS) return 1
  return Math.max(0.4, ROUND_BUDGET_MS / total)
}

function fmt(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)
}
