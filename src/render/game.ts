// Phaser bootstrap for the render layer: one Game, two vector scenes (sector
// map + tactical board) that the GameRender facade wakes and sleeps. The
// createRender promise resolves only after both scenes have run create(),
// hooked via their scene-level CREATE events.

import Phaser from 'phaser'
import type { CreateRender, GameRender } from './api'
import { SECTOR_SCENE_KEY, SectorScene } from './sectorScene'
import { TACTICAL_SCENE_KEY, TacticalScene } from './tacticalScene'

declare global {
  interface Window {
    /** Automation/debug handle; see the assignment in createRender. */
    __scRender?: { game: Phaser.Game; sector: SectorScene; tactical: TacticalScene }
  }
}

export const createRender: CreateRender = async (parent, callbacks) => {
  const sector = new SectorScene(callbacks)
  const tactical = new TacticalScene(callbacks) // replay emits onCue sound cues

  const game = await new Promise<Phaser.Game>((resolve) => {
    new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: '#000008',
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: Math.max(parent.clientWidth, 2),
        height: Math.max(parent.clientHeight, 2),
      },
      callbacks: {
        postBoot: (booted) => {
          // Add without auto-start so the CREATE hooks are in place before
          // create() can run, then start both scenes.
          booted.scene.add(SECTOR_SCENE_KEY, sector)
          booted.scene.add(TACTICAL_SCENE_KEY, tactical)
          let remaining = 2
          const onCreated = (): void => {
            remaining -= 1
            if (remaining > 0) return
            // Start asleep: black viewport until the controller shows a screen.
            booted.scene.sleep(SECTOR_SCENE_KEY)
            booted.scene.sleep(TACTICAL_SCENE_KEY)
            resolve(booted)
          }
          sector.sys.events.once(Phaser.Scenes.Events.CREATE, onCreated)
          tactical.sys.events.once(Phaser.Scenes.Events.CREATE, onCreated)
          booted.scene.start(SECTOR_SCENE_KEY)
          booted.scene.start(TACTICAL_SCENE_KEY)
        },
      },
    })
  })

  const sleep = (key: string): void => {
    if (!game.scene.isSleeping(key)) game.scene.sleep(key)
  }
  const wake = (key: string): void => {
    if (game.scene.isSleeping(key)) game.scene.wake(key)
  }

  const render: GameRender = {
    showSector(state) {
      tactical.cancelActiveRun()
      // Campaign resumed (the sector map never shows during hot-seat): any
      // skirmish POV override is stale here, so the playerShipId default is
      // back for the next campaign encounter.
      tactical.resetPovToDefault()
      sleep(TACTICAL_SCENE_KEY)
      wake(SECTOR_SCENE_KEY)
      sector.showSector(state)
    },
    setSelectedSystem(systemId) {
      sector.setSelected(systemId)
    },
    showEncounter(state) {
      sleep(SECTOR_SCENE_KEY)
      wake(TACTICAL_SCENE_KEY)
      tactical.showEncounter(state)
    },
    animateRound(events, finalState) {
      sleep(SECTOR_SCENE_KEY)
      wake(TACTICAL_SCENE_KEY)
      return tactical.animateRound(events, finalState)
    },
    hide() {
      // Resolve any in-flight replay so callers awaiting it are not stranded.
      tactical.cancelActiveRun()
      sleep(SECTOR_SCENE_KEY)
      sleep(TACTICAL_SCENE_KEY)
    },
    setPov(shipId) {
      tactical.setPov(shipId)
    },
  }
  // Render-side automation handle (sibling of main.ts's window.__sc): lets the
  // Playwright smoke drive assert what the viewport actually shows — cloak/POV
  // visibility above all — without resorting to screenshot archaeology.
  window.__scRender = { game, sector, tactical }
  return render
}
