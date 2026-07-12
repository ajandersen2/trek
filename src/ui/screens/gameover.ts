// Game-over screen: red-alert epitaph over a blank viewport.

import type { GameState } from '../../sim/game'
import type { ScreenContent, ShellCtx } from '../context'
import { btn, div } from '../dom'

export function gameOverScreen(game: GameState, ctx: ShellCtx): ScreenContent {
  const box = div('outcome-box defeat gameover')
  box.append(
    div('outcome-title blink', `${game.ship.name.toUpperCase()} — LOST WITH ALL HANDS`),
    div('outcome-sub', `STARDATE ${game.galaxy.stardate.toFixed(1)} — ALL STATIONS SILENT`),
    btn('RETURN TO MAIN MENU', () => ctx.callbacks.onMainMenu(), { classes: 'danger' }),
  )
  return { left: [], right: [], overlay: box, overlayMode: 'opaque' }
}
