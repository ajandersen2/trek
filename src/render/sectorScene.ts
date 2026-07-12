// Sector map scene: seeded starfield, warp lanes, system glyphs, mission
// target ring, player marker, selection highlight. Reads GameState only and
// emits map clicks through RenderCallbacks; a full redraw per showSector /
// resize is cheap at this scale.

import Phaser from 'phaser'
import { SYSTEMS } from '../data/sectors'
import type { StarSystem, SystemType } from '../sim/galaxy'
import type { GameState } from '../sim/game'
import type { RenderCallbacks } from './api'
import { COLORS, FONT_STACK, css, mix } from './palette'
import { fillGlowDot, strokeArcSegment, strokeGlowCircle } from './fx'
import { drawMarkerArrow } from './silhouettes'
import { fitMapProjection, projectMap, type Projection } from './project'
import { mulberry32 } from './prng'

export const SECTOR_SCENE_KEY = 'sector'

const STAR_COUNT = 200
const MAP_MARGIN_FRAC = 0.08

interface Star {
  nx: number
  ny: number
  r: number
  alpha: number
  color: number
}

interface SystemNode {
  sys: StarSystem
  container: Phaser.GameObjects.Container
  glow: Phaser.GameObjects.Graphics
  zone: Phaser.GameObjects.Zone
  baseAlpha: number
}

export class SectorScene extends Phaser.Scene {
  private readonly callbacks: RenderCallbacks
  private state: GameState | null = null
  private selectedId: string | null = null
  private starSeed: number | null = null
  private stars: Star[] = []
  private starGfx!: Phaser.GameObjects.Graphics
  private laneGfx!: Phaser.GameObjects.Graphics
  private selectGfx!: Phaser.GameObjects.Graphics
  private nodes = new Map<string, SystemNode>()
  private missionRing: Phaser.GameObjects.Container | null = null
  private marker: Phaser.GameObjects.Container | null = null
  private proj: Projection = { scale: 1, ox: 0, oy: 0 }

  constructor(callbacks: RenderCallbacks) {
    super(SECTOR_SCENE_KEY)
    this.callbacks = callbacks
  }

  create(): void {
    this.starGfx = this.add.graphics().setDepth(0)
    this.laneGfx = this.add.graphics().setDepth(1)
    this.selectGfx = this.add.graphics().setDepth(3)
    this.scale.on(Phaser.Scale.Events.RESIZE, this.relayout, this)
    this.events.on(Phaser.Scenes.Events.WAKE, this.relayout, this)
  }

  showSector(state: GameState): void {
    this.state = state
    this.rebuild()
  }

  setSelected(systemId: string | null): void {
    this.selectedId = systemId
    this.drawSelection()
  }

  private relayout(): void {
    if (this.state) this.rebuild()
  }

  private rebuild(): void {
    const state = this.state
    if (!state) return
    // All sector tweens are decorative (pulse/bob/ring spin) and recreated below.
    this.tweens.killAll()
    for (const node of this.nodes.values()) {
      node.zone.destroy()
      node.container.destroy()
    }
    this.nodes.clear()
    this.missionRing?.destroy()
    this.missionRing = null
    this.marker?.destroy()
    this.marker = null

    const w = this.scale.width
    const h = this.scale.height
    this.proj = fitMapProjection(w, h, MAP_MARGIN_FRAC)

    this.drawStars(state.seed, w, h)
    this.drawLanes(state)
    for (const sys of Object.values(SYSTEMS)) this.addSystemNode(sys, state)
    this.addMissionRing(state)
    this.addPlayerMarker(state)
    this.drawSelection()
  }

  private drawStars(seed: number, w: number, h: number): void {
    if (this.starSeed !== seed) {
      const rand = mulberry32(seed ^ 0x5f356495) // decorrelate from sim draws
      this.stars = Array.from({ length: STAR_COUNT }, () => ({
        nx: rand(),
        ny: rand(),
        r: 0.4 + rand() * 1.1,
        alpha: 0.08 + rand() * 0.38,
        color: mix(COLORS.white, 0x99bbff, rand()),
      }))
      this.starSeed = seed
    }
    const g = this.starGfx
    g.clear()
    for (const star of this.stars) {
      g.fillStyle(star.color, star.alpha)
      g.fillCircle(star.nx * w, star.ny * h, star.r)
    }
  }

  private drawLanes(state: GameState): void {
    const g = this.laneGfx
    g.clear()
    const visited = new Set(state.galaxy.visited)
    for (const sys of Object.values(SYSTEMS)) {
      for (const linkId of sys.links) {
        if (sys.id >= linkId) continue // dedupe A-B / B-A
        const other = SYSTEMS[linkId]
        if (!other) continue
        const bright = visited.has(sys.id) && visited.has(linkId)
        const a = projectMap(this.proj, sys.pos)
        const b = projectMap(this.proj, other.pos)
        g.lineStyle(bright ? 1.6 : 1, COLORS.slate, bright ? 0.5 : 0.2)
        g.lineBetween(a.x, a.y, b.x, b.y)
      }
    }
  }

  private addSystemNode(sys: StarSystem, state: GameState): void {
    const visited = state.galaxy.visited.includes(sys.id)
    const p = projectMap(this.proj, sys.pos)
    const glow = this.add.graphics()
    this.drawSystemGlyph(glow, sys.type)
    const label = this.add
      .text(0, 13, sys.name.toUpperCase(), {
        fontFamily: FONT_STACK,
        fontSize: '11px',
        color: css(visited ? COLORS.peach : COLORS.slate),
      })
      .setOrigin(0.5, 0)
      .setLetterSpacing(1.5)
    const container = this.add.container(p.x, p.y, [glow, label]).setDepth(2)
    const baseAlpha = visited ? 1 : 0.45
    container.setAlpha(baseAlpha)

    const zone = this.add.zone(p.x, p.y, 36, 36).setInteractive({
      hitArea: new Phaser.Geom.Circle(18, 18, 18),
      hitAreaCallback: Phaser.Geom.Circle.Contains,
      useHandCursor: true,
    })
    zone.on('pointerover', () => {
      container.setAlpha(Math.min(1, baseAlpha + 0.35))
      glow.setScale(1.18)
    })
    zone.on('pointerout', () => {
      container.setAlpha(baseAlpha)
      glow.setScale(1)
    })
    zone.on('pointerdown', () => this.callbacks.onSystemSelected(sys.id))

    this.nodes.set(sys.id, { sys, container, glow, zone, baseAlpha })

    if (sys.type === 'anomaly') {
      this.tweens.add({
        targets: glow,
        props: { alpha: 0.45 },
        duration: 1600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    }
  }

  private drawSystemGlyph(g: Phaser.GameObjects.Graphics, type: SystemType): void {
    switch (type) {
      case 'starbase':
        fillGlowDot(g, 0, 0, 2.6, COLORS.slate)
        strokeGlowCircle(g, 0, 0, 7.5, COLORS.slate, 0.8)
        g.lineStyle(1.2, mix(COLORS.slate, COLORS.white, 0.5), 0.9)
        g.strokeRect(-3.5, -3.5, 7, 7) // station glyph
        break
      case 'colony':
        fillGlowDot(g, 0, 0, 3.2, COLORS.peach)
        strokeGlowCircle(g, 0, 0, 6.5, COLORS.peach, 0.7, 0.8)
        break
      case 'anomaly':
        fillGlowDot(g, 0, 0, 3, COLORS.lavender)
        strokeGlowCircle(g, 0, 0, 7, COLORS.lavender, 0.9)
        break
      case 'empty':
        fillGlowDot(g, 0, 0, 2.4, COLORS.emptySystem, 0.8)
        break
    }
  }

  private addMissionRing(state: GameState): void {
    if (state.mission.stage !== 'active') return
    const target = SYSTEMS[state.mission.targetSystemId]
    if (!target) return
    const p = projectMap(this.proj, target.pos)
    const g = this.add.graphics()
    const seg = (Math.PI * 2) / 5
    for (let i = 0; i < 5; i++) {
      strokeArcSegment(g, 0, 0, 15, i * seg, seg * 0.28, 3.5, COLORS.torpedo, 0.25)
      strokeArcSegment(g, 0, 0, 15, i * seg, seg * 0.28, 1.6, COLORS.torpedo, 0.9)
    }
    const ring = this.add.container(p.x, p.y, [g]).setDepth(2)
    this.tweens.add({ targets: ring, props: { rotation: Math.PI * 2 }, duration: 9000, repeat: -1 })
    this.missionRing = ring
  }

  private addPlayerMarker(state: GameState): void {
    const sys = SYSTEMS[state.galaxy.currentSystemId]
    if (!sys) return
    const p = projectMap(this.proj, sys.pos)
    const g = this.add.graphics()
    drawMarkerArrow(g, 13, COLORS.fed)
    g.setRotation(-Math.PI / 2) // point the arrowhead up
    const marker = this.add.container(p.x, p.y - 17, [g]).setDepth(4)
    this.tweens.add({
      targets: marker,
      props: { y: p.y - 21 },
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    this.marker = marker
  }

  private drawSelection(): void {
    const g = this.selectGfx
    g.clear()
    if (!this.selectedId) return
    const node = this.nodes.get(this.selectedId)
    if (!node) return
    strokeGlowCircle(g, node.container.x, node.container.y, 12, mix(COLORS.peach, COLORS.white, 0.5))
  }
}
