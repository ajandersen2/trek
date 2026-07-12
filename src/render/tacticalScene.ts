// Tactical board: draws EncounterState statically and replays WEGO rounds as
// a sequential animation. Display state (ship views, torpedo dots) is
// render-owned deep copies — the final redraw from finalState is the single
// source of truth after every round, so animation drift can never accumulate.
//
// Fog of war lives HERE, not in the sim: the sim emits true coordinates for
// cloaked ships (events + finalState), and this layer is what keeps them off
// the screen — silhouettes, movement, labels, camera fit, even launch flashes.
// WHOSE fog applies is the POV (setPov, hot-seat M2.5): the POV ship ghosts
// when cloaked, every other cloaked ship is absent, and a null POV (public
// view, both captains watching) ghosts nothing. Until setPov is first called
// it defaults to the board's playerShipId — campaign behavior, unchanged.

import Phaser from 'phaser'
import { getShipClass } from '../data/ships'
import { headingDelta, type ArcId, type Vec2 } from '../sim/geometry'
import { ARC_IDS, type EncounterState, type FactionId, type RoundEvent, type ShipState } from '../sim/types'
import type { RenderCallbacks } from './api'
import { COLORS, FONT_STACK, css, hullColor, mix } from './palette'
import { drawBeam, fillGlowDot, strokeArcSegment, strokeGlowLine } from './fx'
import { DUEL_ACCENTS, beamColor, drawShip, drawWreck, hullFragments, shipColor } from './silhouettes'
import { TACTICAL_NEBULA_HUES, drawNebula, makeNebula, type NebulaBlob } from './nebula'
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
const GHOST_ALPHA = 0.35 // the POV captain's own cloaked ship
const GHOST_WEDGE_LEN = 12 // sim units: failed-sweep bearing hint reach
const CLOAK_MS = 700
const DECLOAK_MS = 600
// EncounterState carries no seed (the render contract keeps it lean), so the
// tactical haze uses a fixed display-only seed with the shared generator.
const TACTICAL_NEBULA_SEED = 0x7a3c9e1

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
type ScanEvent = Extract<RoundEvent, { type: 'scan' }>

type Step =
  | { kind: 'helm'; events: HelmEvent[] }
  | { kind: 'torpedo-moves'; events: TorpedoMoveEvent[] }
  | { kind: 'event'; event: RoundEvent }

interface ShipView {
  /** Render-owned deep copy; mutated only for display bookkeeping. */
  ship: ShipState
  shieldMax: number
  /** Duel accent mixed into the hull glow (ships[1] of a same-side duel). */
  accent: number | undefined
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
  private readonly callbacks: RenderCallbacks
  private board: EncounterState | null = null
  private views = new Map<string, ShipView>()
  private torps = new Map<number, TorpedoView>()
  private nebulaGfx!: Phaser.GameObjects.Graphics
  private nebulaBlobs: NebulaBlob[] = []
  private gridG!: Phaser.GameObjects.Graphics
  private fxLayer!: Phaser.GameObjects.Container
  private proj: Projection = { scale: 10, ox: 0, oy: 0 }
  private gridCenter: Vec2 = { x: 0, y: 0 }
  private run: Promise<void> | null = null
  private ff = false
  private pending = new Set<() => void>()
  private floatSlots = new Map<string, number>()
  /**
   * Hot-seat POV, tri-state (see GameRender.setPov): undefined = never set,
   * fall back to the board's playerShipId (campaign); a ship id = that
   * captain's seat; null = public view — every cloaked ship hidden, no ghosts.
   */
  private povOverride: string | null | undefined = undefined

  constructor(callbacks: RenderCallbacks) {
    super(TACTICAL_SCENE_KEY)
    this.callbacks = callbacks
  }

  create(): void {
    this.nebulaGfx = this.add.graphics().setDepth(-1) // behind everything
    this.nebulaBlobs = makeNebula(TACTICAL_NEBULA_SEED, TACTICAL_NEBULA_HUES, 24)
    drawNebula(this.nebulaGfx, this.nebulaBlobs, this.scale.width, this.scale.height)
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

  /**
   * Change the POV (see povOverride). On a static board the cloak visibility,
   * camera fit, and grid center re-evaluate immediately — a rebuild from the
   * current board is cheap at this scale. Mid-replay the new POV applies to
   * subsequent events and the end-of-round redraw settles the rest.
   */
  setPov(shipId: string | null): void {
    if (this.povOverride === shipId) return
    this.povOverride = shipId
    if (this.board && !this.run) this.drawStatic(this.board, false)
  }

  /**
   * Drop any POV override, restoring the playerShipId default. Called when
   * the campaign sector map shows (a campaign-only surface): a hot-seat POV —
   * main.ts parks it at null on skirmish exit — must not leak into a later
   * campaign encounter, where it would hide the player's own privileged
   * detail. No redraw: the next showEncounter draws under the default.
   */
  resetPovToDefault(): void {
    this.povOverride = undefined
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

  // -------------------------------------------------------------- sound cues

  /**
   * Emit this event's sound cues (see cuesForEvent) at its animation moment.
   * Silent while fast-forwarding — a skipped replay must not machine-gun the
   * mixer — and silent for events suppressed by the cloak fog of war.
   */
  private emitCues(ev: RoundEvent): void {
    if (this.ff || !this.callbacks.onCue) return
    const shooterFaction: FactionId =
      ev.type === 'phaser-fire'
        ? (this.views.get(ev.shooterId)?.ship.faction ?? 'federation')
        : 'federation'
    for (const cue of cuesForEvent(ev, shooterFaction)) this.callbacks.onCue(cue)
  }

  /** Is this ship id currently concealed by its cloak? */
  private isHiddenId(shipId: string): boolean {
    const view = this.views.get(shipId)
    return view ? this.isHiddenView(view) : false
  }

  /** Cloaked ships are absent from the display — except the POV captain's ghost. */
  private isHiddenView(view: ShipView): boolean {
    return view.ship.cloaked && view.ship.id !== this.povShipId()
  }

  /** Effective POV ship: the override if ever set, else the board's player ship. */
  private povShipId(): string | null {
    return this.povOverride === undefined ? (this.board?.playerShipId ?? null) : this.povOverride
  }

  // ------------------------------------------------------------- static draw

  private onResize(): void {
    drawNebula(this.nebulaGfx, this.nebulaBlobs, this.scale.width, this.scale.height)
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
      drawNebula(this.nebulaGfx, this.nebulaBlobs, this.scale.width, this.scale.height)
    }
    this.tweens.killTweensOf(this.proj)
    this.clearViews()
    this.board = state

    const pov = this.povShipId()
    const present = state.ships.filter((s) => !s.warpedOut)
    // Grid center and camera fit only consider what the POV captain can see:
    // a cloaked contact's true position must not steer the display.
    const seen = present.filter((s) => !s.cloaked || s.id === pov)
    if (seen.length > 0) {
      this.gridCenter = {
        x: seen.reduce((acc, s) => acc + s.pos.x, 0) / seen.length,
        y: seen.reduce((acc, s) => acc + s.pos.y, 0) / seen.length,
      }
    }
    this.proj = this.fitTo(boardBounds(state, pov))
    // Views exist for hidden ships too (invisible), silently tracking pose so
    // a later decloak materializes exactly where the sim says it is.
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
    for (const view of this.views.values()) {
      if (this.isHiddenView(view)) continue // hidden contacts must not steer the camera
      pts.push({ x: view.world.x, y: view.world.y })
    }
    for (const torp of this.torps.values()) pts.push({ x: torp.world.x, y: torp.world.y })
    return boundsOf(pts, WORLD_PAD)
  }

  /**
   * Same-side duels (hot-seat mirrors: fed vs fed, klingon vs klingon, or the
   * same class outright) tint ships[1] toward a distinct accent so two like
   * silhouettes stay readable. Keyed off encounter index, never faction, so
   * the treatment is deterministic however the seats pick their ships.
   */
  private duelAccent(shipId: string): number | undefined {
    const a = this.board?.ships[0]
    const b = this.board?.ships[1]
    if (!a || !b || shipId !== b.id) return undefined
    return a.classId === b.classId || a.faction === b.faction ? DUEL_ACCENTS[b.faction] : undefined
  }

  /** Do ships[0] and ships[1] share a class or faction? (duel label treatment) */
  private isSameSideDuel(): boolean {
    const a = this.board?.ships[0]
    const b = this.board?.ships[1]
    return !!a && !!b && (a.classId === b.classId || a.faction === b.faction)
  }

  private createShipView(src: ShipState): ShipView {
    const ship = structuredClone(src)
    const accent = this.duelAccent(ship.id)
    const body = this.add.graphics()
    const shieldsG = this.add.graphics()
    const rig = this.add.container(0, 0, [shieldsG, body])
    const hullG = this.add.graphics()
    const label = this.add
      .text(0, SHIELD_RADIUS + 12, ship.name.toUpperCase(), {
        fontFamily: FONT_STACK,
        fontSize: '10px',
        color: css(labelColorFor(ship.faction, accent)),
      })
      .setOrigin(0.5, 0)
      .setLetterSpacing(1.2)
      // Same-side duels lean on the name labels to tell captains apart: keep
      // both at full strength there instead of the usual soft 0.9.
      .setAlpha(this.isSameSideDuel() ? 1 : 0.9)
    const container = this.add.container(0, 0, [rig, hullG, label]).setDepth(2)
    const view: ShipView = {
      ship,
      shieldMax: shieldMaxFor(ship),
      accent,
      container,
      rig,
      body,
      shieldsG,
      hullG,
      label,
      world: { x: ship.pos.x, y: ship.pos.y, rot: ship.heading },
    }
    this.redrawShip(view)
    this.applyCloakLook(view)
    return view
  }

  private redrawShip(view: ShipView): void {
    view.body.clear()
    view.shieldsG.clear()
    if (view.ship.alive) {
      drawShip(view.body, view.ship.classId, view.ship.faction, SHIP_PX, 1, view.accent)
      this.drawShieldArcs(view)
    } else {
      drawWreck(view.body, view.ship.classId, view.ship.faction, SHIP_PX, view.accent)
    }
    this.drawHullBar(view)
  }

  /**
   * Static cloak treatment. A hidden ship is simply absent — no silhouette,
   * hull bar, or label. The POV captain's own cloaked ship stays as a ~35%
   * ghost with a soft shimmer: a captain always knows where their ship is.
   * Under a public POV (null) nothing ghosts — every cloaked ship is absent.
   */
  private applyCloakLook(view: ShipView): void {
    this.tweens.killTweensOf(view.rig) // clear any prior shimmer before restyling
    view.rig.setScale(1)
    view.rig.setAlpha(1)
    if (!view.ship.cloaked) {
      view.container.setVisible(true).setAlpha(1)
      return
    }
    if (view.ship.id === this.povShipId()) {
      view.container.setVisible(true).setAlpha(GHOST_ALPHA)
      this.tweens.add({
        targets: view.rig,
        props: { alpha: 0.7 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    } else {
      view.container.setVisible(false).setAlpha(1)
    }
  }

  /**
   * Shield/subsystem detail is privileged: the POV captain's own ship always
   * shows it, anyone else's only once scanned (scanLevel >= 1). A public POV
   * shows only scanned ships' detail — the intersection of what both captains
   * are entitled to see, so a shared replay can't leak shield state.
   */
  private shieldsVisible(view: ShipView): boolean {
    return view.ship.alive && (view.ship.id === this.povShipId() || view.ship.scanLevel >= 1)
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
    g.setBlendMode(Phaser.BlendModes.ADD) // trail beads sum into a hot plasma glow
    fillGlowDot(g, 0, 0, 2.6, COLORS.torpedo)
    // Fading trail behind the flight direction (local -X).
    const trail = [
      { x: -7, r: 1.9, a: 0.5 },
      { x: -12, r: 1.6, a: 0.32 },
      { x: -17, r: 1.3, a: 0.2 },
      { x: -22, r: 1.05, a: 0.12 },
      { x: -27, r: 0.8, a: 0.06 },
    ]
    for (const t of trail) {
      g.fillStyle(COLORS.torpedo, t.a)
      g.fillCircle(t.x, 0, t.r)
    }
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
    const target = this.fitTo(unionBounds(this.currentBounds(), boardBounds(this.board, this.povShipId())))
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
    if (this.isHiddenView(view)) {
      // The sim emits true movement for cloaked ships; concealing it is the
      // render layer's job (fog of war lives here, not in the sim). Snap the
      // pose silently — no tween — so a later decloak appears in the right
      // place without the ghost's track ever being drawn.
      view.world.x = ev.to.x
      view.world.y = ev.to.y
      view.world.rot = rotTo
      this.applyShip(view)
      return Promise.resolve()
    }
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
    // Cues fire at each event's animation moment. phaser-fire emits at beam
    // draw (after the charge glow) and decloak at shimmer start, inside their
    // handlers; a launch from a still-cloaked ship stays silent — even the
    // sound would betray it.
    const cueInHandler = ev.type === 'phaser-fire' || ev.type === 'decloak'
    const hiddenLaunch = ev.type === 'torpedo-launch' && this.isHiddenId(ev.ownerId)
    if (!cueInHandler && !hiddenLaunch) this.emitCues(ev)
    switch (ev.type) {
      case 'torpedo-launch': {
        this.torps.get(ev.id)?.container.destroy()
        this.torps.delete(ev.id)
        if (hiddenLaunch) {
          // No tube flash at a cloaked launcher's true position; the torpedo
          // itself materializes on its first tracked move.
          await this.wait(140 * k)
          return
        }
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
        await this.animateScan(ev, k)
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
      case 'cloak': {
        await this.animateCloak(ev.shipId, k)
        return
      }
      case 'decloak': {
        await this.animateDecloak(ev, k)
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
            // Subtle ember flicker — a powerless hulk, not a strobe.
            view.rig.setAlpha(0.55 + 0.3 * Math.abs(Math.cos(anim.t * Math.PI * 3)))
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
    const a = project(this.proj, ev.from)
    const b = project(this.proj, to)

    // Brief pre-fire charge: the emitter gathers light for ~80ms before the beam.
    if (!this.ff) {
      const charge = this.add.graphics()
      this.fxLayer.add(charge)
      const cAnim = { t: 0 }
      await this.tweenAsync({
        targets: cAnim,
        props: { t: 1 },
        duration: 80 * k,
        ease: 'Sine.easeIn',
        onUpdate: () => {
          charge.clear()
          fillGlowDot(charge, a.x, a.y, 1 + 2.6 * cAnim.t, mix(color, COLORS.white, 0.3), 0.4 + 0.6 * cAnim.t)
        },
      })
      charge.destroy()
    }

    this.emitCues(ev) // beam voice + impact bell land with the drawn beam
    const g = this.add.graphics()
    this.fxLayer.add(g)
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

  private async animateScan(ev: ScanEvent, k: number): Promise<void> {
    const scanner = this.views.get(ev.shipId)
    if (!scanner || this.isHiddenView(scanner)) {
      // A cloaked ship may still sweep (the sim allows it), but rings centered
      // on empty space would hand over exactly the position the cloak hides.
      // The 'scan' cue already played — an unseen sweep you can only hear.
      await this.wait(200 * k)
      return
    }
    const target = this.views.get(ev.targetId)
    const targetSeen = target !== undefined && !this.isHiddenView(target)
    const a = project(this.proj, scanner.world)
    // Never size the pulse off a hidden contact's true position — a failed
    // tachyon sweep reads as a fixed-radius search, not a rangefinder.
    let reach = GHOST_WEDGE_LEN * this.proj.scale
    if (targetSeen) {
      const b = project(this.proj, target.world)
      reach = Math.hypot(b.x - a.x, b.y - a.y) + 26
    }
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
    if (ev.success && target) {
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
    } else if (ev.ghostBearing !== null && ev.ghostBearing !== undefined) {
      // Failed sweep inside hint range: faint distortion bearing, no fix.
      this.spawnGhostWedge(scanner, ev.ghostBearing)
    }
    await this.wait(120 * k)
  }

  /**
   * Translucent lavender bearing wedge from the scanner toward the quantized
   * ghost heading (22.5° spread, ~12 world units), fading over ~1s.
   */
  private spawnGhostWedge(scanner: ShipView, bearing: number): void {
    if (this.ff) return
    const p = project(this.proj, scanner.world)
    const len = GHOST_WEDGE_LEN * this.proj.scale
    const center = headingToRotation(bearing) // sim heading → screen radians
    const half = Math.PI / 16
    const g = this.add.graphics()
    this.fxLayer.add(g)
    g.fillStyle(COLORS.lavender, 0.13)
    g.slice(p.x, p.y, len, center - half, center + half, false)
    g.fillPath()
    g.lineStyle(1.2, COLORS.lavender, 0.45)
    g.slice(p.x, p.y, len, center - half, center + half, false)
    g.strokePath()
    this.tweens.add({
      targets: g,
      props: { alpha: 0 },
      duration: 1000,
      ease: 'Sine.easeIn',
      onComplete: () => g.destroy(),
    })
  }

  private async animateHail(shipId: string, k: number): Promise<void> {
    const view = this.views.get(shipId)
    if (!view || this.isHiddenView(view)) return // a hidden hailer stays unseen
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
    if (this.isHiddenView(view)) {
      // A cloaked ship jumps out unseen: no streak at its true position.
      this.tweens.killTweensOf(view.world)
      view.container.destroy()
      await this.wait(160 * k)
      return
    }
    const theta = (view.world.rot * Math.PI) / 8 // sim-space facing angle
    const dir = { x: Math.cos(theta), y: Math.sin(theta) }
    const p0 = project(this.proj, view.world)
    const p1 = project(this.proj, { x: view.world.x + dir.x * 14, y: view.world.y + dir.y * 14 })
    if (!this.ff) {
      const streak = this.add.graphics()
      this.fxLayer.add(streak)
      drawBeam(
        streak,
        p0.x,
        p0.y,
        p1.x,
        p1.y,
        mix(shipColor(view.ship.classId, view.ship.faction, view.accent), COLORS.white, 0.4),
      )
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

  /** Shimmer-out: the silhouette dissolves into drifting slices, then hides. */
  private async animateCloak(shipId: string, k: number): Promise<void> {
    const view = this.views.get(shipId)
    if (!view) return
    view.ship.cloaked = true
    const endAlpha = shipId === this.povShipId() ? GHOST_ALPHA : 0
    this.spawnCloakSlices(view, false, CLOAK_MS * k)
    const anim = { t: 0 }
    await this.tweenAsync({
      targets: anim,
      props: { t: 1 },
      duration: CLOAK_MS * k,
      ease: 'Sine.easeIn',
      onUpdate: () => {
        view.container.setAlpha(1 - (1 - endAlpha) * anim.t)
        view.rig.setScale(1, 1 + 0.07 * Math.sin(anim.t * Math.PI * 4)) // ripple
      },
    })
    this.applyCloakLook(view)
    await this.wait(100 * k)
  }

  /** Shimmer-in. A forced decloak (tachyon lock / dead engines) flashes first. */
  private async animateDecloak(ev: Extract<RoundEvent, { type: 'decloak' }>, k: number): Promise<void> {
    const view = this.views.get(ev.shipId)
    if (!view) return
    if (ev.forced) {
      // Detection flash: the lavender ring that caught them.
      this.spawnRing({ x: view.world.x, y: view.world.y }, 20, COLORS.lavender, 340 * k)
      await this.wait(170 * k)
    }
    this.emitCues(ev) // cue at shimmer start
    this.tweens.killTweensOf(view.rig) // stop any ghost shimmer mid-oscillation
    view.rig.setAlpha(1)
    view.ship.cloaked = false
    const fromAlpha = ev.shipId === this.povShipId() ? GHOST_ALPHA : 0
    view.container.setVisible(true).setAlpha(fromAlpha)
    this.spawnCloakSlices(view, true, DECLOAK_MS * k)
    const anim = { t: 0 }
    await this.tweenAsync({
      targets: anim,
      props: { t: 1 },
      duration: DECLOAK_MS * k,
      ease: 'Sine.easeOut',
      onUpdate: () => {
        view.container.setAlpha(fromAlpha + (1 - fromAlpha) * anim.t)
        view.rig.setScale(1, 1 + 0.06 * Math.sin((1 - anim.t) * Math.PI * 4))
      },
    })
    this.applyCloakLook(view)
    await this.wait(80 * k)
  }

  /** Two ghost silhouette slices sliding horizontally apart (or back together). */
  private spawnCloakSlices(view: ShipView, converge: boolean, ms: number): void {
    if (this.ff) return
    const p = project(this.proj, view.world)
    const rot = headingToRotation(view.world.rot)
    for (const dir of [-1, 1]) {
      const g = this.add.graphics()
      drawShip(g, view.ship.classId, view.ship.faction, SHIP_PX, 0.45, view.accent)
      g.setRotation(rot)
      g.setPosition(p.x + (converge ? dir * 10 : dir * 2), p.y + dir * 1.5)
      g.setAlpha(0.5)
      this.fxLayer.add(g)
      this.tweens.add({
        targets: g,
        props: { x: converge ? p.x + dir * 2 : p.x + dir * 10, alpha: 0 },
        duration: ms,
        ease: 'Sine.easeOut',
        onComplete: () => g.destroy(),
      })
    }
  }

  /**
   * Three-stage destruction, ~1.6s with the ember tail: white core flash →
   * secondary blasts cooking off around the hull → tumbling debris shards
   * under a lingering ember glow.
   */
  private async animateDestroyed(shipId: string, k: number): Promise<void> {
    const view = this.views.get(shipId)
    if (!view) return
    const pos = { x: view.world.x, y: view.world.y }
    // Stage 1 — rapid white core flash.
    this.cameras.main.shake(360, 0.011)
    this.spawnFlash(pos, 18, COLORS.white, 240 * k)
    await this.wait(150 * k)
    view.ship.alive = false
    view.ship.hull = 0
    this.redrawShip(view) // broken outline + debris under the fireball
    // Stage 2 — offset secondary blasts with expanding rings (display-only
    // randomness: never the sim RNG).
    for (let i = 0; i < 3; i++) {
      const off = {
        x: pos.x + (Math.random() - 0.5) * 4,
        y: pos.y + (Math.random() - 0.5) * 4,
      }
      this.spawnFlash(off, 9 + i * 2, mix(COLORS.gold, COLORS.white, 0.4), 300 * k)
      this.spawnRing(off, 26 + i * 9, i === 2 ? COLORS.red : COLORS.gold, 560 * k)
      await this.wait(160 * k)
    }
    // Stage 3 — debris shards + lingering ember.
    this.scatterFragments(view, pos, k)
    this.spawnEmber(pos, k)
    this.spawnRing(pos, 52, COLORS.torpedo, 700 * k)
    await this.wait(620 * k)
  }

  /** 8 glowing shards — real hull edges plus random slivers — tumbling out. */
  private scatterFragments(view: ShipView, pos: Vec2, k: number): void {
    if (this.ff) return
    const color = shipColor(view.ship.classId, view.ship.faction, view.accent)
    const segs: [Vec2, Vec2][] = hullFragments(view.ship.classId, view.ship.faction, SHIP_PX)
    while (segs.length < 8) {
      const cx = (Math.random() - 0.5) * 14
      const cy = (Math.random() - 0.5) * 14
      const ang = Math.random() * Math.PI * 2
      const half = 2 + Math.random() * 3.5
      segs.push([
        { x: cx - Math.cos(ang) * half, y: cy - Math.sin(ang) * half },
        { x: cx + Math.cos(ang) * half, y: cy + Math.sin(ang) * half },
      ])
    }
    const baseRot = headingToRotation(view.world.rot)
    const p = project(this.proj, pos)
    segs.forEach((seg, i) => {
      const g = this.add.graphics()
      strokeGlowLine(g, seg[0].x, seg[0].y, seg[1].x, seg[1].y, color, 0.7)
      g.setPosition(p.x, p.y)
      g.setRotation(baseRot)
      this.fxLayer.add(g)
      const ang = baseRot + (Math.PI * 2 * i) / segs.length + Math.random() * 0.5
      const dist = 22 + Math.random() * 30
      this.tweens.add({
        targets: g,
        props: {
          x: p.x + Math.cos(ang) * dist,
          y: p.y + Math.sin(ang) * dist,
          rotation: baseRot + (Math.random() - 0.5) * 6, // tumble
          alpha: 0,
        },
        duration: (850 + Math.random() * 350) * k,
        ease: 'Cubic.easeOut',
        onComplete: () => g.destroy(),
      })
    })
  }

  /** Lingering ember at a destruction site, guttering out over ~1.3s. */
  private spawnEmber(pos: Vec2, k: number): void {
    if (this.ff) return
    const p = project(this.proj, pos)
    const g = this.add.graphics()
    this.fxLayer.add(g)
    const anim = { t: 0 }
    this.tweens.add({
      targets: anim,
      props: { t: 1 },
      duration: 1300 * k,
      ease: 'Sine.easeIn',
      onUpdate: () => {
        g.clear()
        const fade = (1 - anim.t) * (0.75 + 0.25 * Math.sin(anim.t * 31)) // gutter
        g.fillStyle(COLORS.torpedo, 0.22 * fade)
        g.fillCircle(p.x, p.y, 10 - 4 * anim.t)
        g.fillStyle(mix(COLORS.gold, COLORS.white, 0.3), 0.5 * fade)
        g.fillCircle(p.x, p.y, 4 - 2 * anim.t)
      },
      onComplete: () => g.destroy(),
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
      duration: 450,
      ease: 'Cubic.easeOut', // bright pop that settles instead of lingering
      onComplete: () => g.destroy(),
    })
  }

  /** Rising, fading damage/status text above a ship; stacks within a round. */
  private floatText(view: ShipView, text: string, color: number, k: number): void {
    // Hidden ships get no floats either — text over empty space is a position leak.
    if (this.ff || this.isHiddenView(view)) return
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

/**
 * Shield scale for the arc display. Unknown classIds (newer sim data than
 * this render) fall back to the ship's own current shields, mirroring the
 * silhouette fallback — the render must draw whatever the sim sends.
 */
function shieldMaxFor(ship: ShipState): number {
  try {
    return getShipClass(ship.classId).shieldMax
  } catch {
    return Math.max(1, ...Object.values(ship.shields))
  }
}

/** Name label color: faction tone, or the lifted duel accent for ships[1]. */
function labelColorFor(faction: FactionId, accent: number | undefined): number {
  if (accent !== undefined) return mix(accent, COLORS.white, 0.3)
  return faction === 'federation' ? COLORS.peach : mix(COLORS.klingon, COLORS.white, 0.25)
}

function boardBounds(state: EncounterState, pov: string | null): Bounds {
  const pts: Vec2[] = []
  for (const ship of state.ships) {
    if (ship.warpedOut) continue
    // Cloaked contacts must not steer the camera fit — that alone would leak
    // their position. Only the POV captain's own cloaked ghost still counts.
    if (ship.cloaked && ship.id !== pov) continue
    pts.push(ship.pos)
  }
  for (const torp of state.torpedoes) pts.push(torp.pos)
  return boundsOf(pts, WORLD_PAD)
}

/**
 * Sound-cue mapping: the single place a replay event becomes cue names (src/
 * audio SoundCue values). Weapon events pair their firing voice with exactly
 * one impact voice — hull if armor gave, otherwise shield, never both.
 */
function cuesForEvent(ev: RoundEvent, shooterFaction: FactionId): string[] {
  switch (ev.type) {
    case 'phaser-fire':
      if (!ev.hit) return ['miss-whoosh']
      return [
        shooterFaction === 'federation' ? 'phaser-fed' : 'disruptor',
        ...impactCue(ev.shieldDamage, ev.hullDamage),
      ]
    case 'torpedo-hit':
      return ['torpedo-hit', ...impactCue(ev.shieldDamage, ev.hullDamage)]
    case 'torpedo-launch':
      return ['torpedo-launch']
    case 'ship-destroyed':
      return ['explosion-ship']
    case 'repair':
      return ['repair']
    case 'scan':
      return ['scan']
    case 'hail':
      return ['hail']
    case 'warp-out':
      return ['warp-out']
    case 'cloak':
      return ['cloak']
    case 'decloak':
      return ['decloak']
    default:
      return []
  }
}

function impactCue(shieldDamage: number, hullDamage: number): string[] {
  if (hullDamage > 0) return ['hull-hit']
  if (shieldDamage > 0) return ['shield-hit']
  return []
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
  'cloak',
  'decloak',
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
          return 620
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
        case 'cloak':
          return 800
        case 'decloak':
          return 760
        case 'ship-destroyed':
          return 1450
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
