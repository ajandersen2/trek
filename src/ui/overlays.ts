// Full-screen LCARS overlays: the captain's-log archive and the how-to-play
// technical readout. Pure view — both render from ViewState data and report
// nothing but "close". The shell owns which overlay (if any) is open.

import { btn, div, el } from './dom'
import { lineClass } from './log'

/** Shared overlay frame: label bar with close pill on top, scrollable body below. */
function overlayFrame(
  title: string,
  bodyClass: string,
  body: HTMLElement[],
  onClose: () => void,
): HTMLElement {
  const box = div('modal-box')
  const bar = div('modal-bar')
  bar.append(
    el('span', 'modal-title', title),
    el('i', 'modal-tail'),
    btn('CLOSE', onClose, { classes: 'sm', title: 'ESC ALSO CLOSES' }),
  )
  const scroll = div(`modal-scroll ${bodyClass}`)
  scroll.append(...body)
  box.append(bar, scroll)
  return box
}

/** Captain's log archive: every story beat of the campaign, newest at the bottom. */
export function logOverlay(archive: readonly string[], onClose: () => void): HTMLElement {
  const lines = archive.length
    ? archive.map((line) => {
        const cls = lineClass(line)
        return div(cls ? `archive-line ${cls}` : 'archive-line', line)
      })
    : [div('archive-line dim', 'NO LOG ENTRIES ON RECORD.')]
  return overlayFrame("CAPTAIN'S LOG — ARCHIVE", 'archive', lines, onClose)
}

const HELP_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['MISSION', 'Travel the sector map. Answer the distress call at Veyra Colony.'],
  ['ROUNDS', 'Each round: set power and orders at every station, then EXECUTE. All ships move at once.'],
  ['POWER', 'Allocation over budget blocks execution. Hull damage shrinks the budget.'],
  ['FACING', 'Four shield arcs. Phasers cover 270°; torpedoes need the 60° forward arc.'],
  ['SCANS', 'Scan a target to reveal shields and subsystems — and unlock precision targeting.'],
  ['MERCY', "Disable an enemy's weapons and engines to win without killing."],
  ['CLOAK', 'Cloaked ships give no firing solution. Run tachyon sweeps and watch for bearing ghosts.'],
  ['HELM', 'Cut throttle and a faster attacker overshoots — into your forward arc.'],
  ['ESCAPE', 'Warping out needs range ≥ 15 and engines online. Repair and rearm at Starbase 4.'],
  ['KEYS', 'SPACE executes the round · M toggles audio · ESC closes overlays.'],
]

/** How-to-play, LCARS technical-readout style: short labeled rows, not prose. */
export function helpOverlay(onClose: () => void): HTMLElement {
  const rows = HELP_ROWS.map(([key, text]) => {
    const row = div('help-row')
    row.append(el('span', 'help-key', key), el('span', 'help-txt', text))
    return row
  })
  return overlayFrame('BRIDGE OPERATIONS — HOW TO PLAY', 'help', rows, onClose)
}
