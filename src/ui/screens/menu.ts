// Main menu: new mission (optional seed), continue, load slots, import save.
// Rails carry decorative LCARS blocks while the menu owns the center.

import type { ViewState } from '../api'
import type { ScreenContent, ShellCtx } from '../context'
import { btn, div, el, hint, parseSeed, seedRow } from '../dom'

const LEFT_DECO: ReadonlyArray<readonly [string, string, number]> = [
  ['gold', 'LCARS 105', 2],
  ['slate', 'SUBSPACE RELAY 47-C', 3],
  ['lavender', 'DECK 01 — BRIDGE', 2],
  ['peach', 'ENVIRONMENTAL', 1.5],
]

const RIGHT_DECO: ReadonlyArray<readonly [string, string, number]> = [
  ['peach', 'OPS 22', 1.5],
  ['gold', 'TACTICAL', 2],
  ['slate', 'SCIENCE 4-D', 3],
  ['lavender', 'COMMS ARRAY', 2],
]

export function menuScreen(view: ViewState, ctx: ShellCtx): ScreenContent {
  const box = div('menu-box')
  box.append(
    div('menu-sub', 'LCARS BRIDGE OPERATIONS'),
    el('h1', 'menu-title', 'STARSHIP COMMAND'),
    div('menu-rule'),
  )

  const actions = div('menu-actions')
  actions.append(
    btn(
      'NEW MISSION',
      () => ctx.callbacks.onNewGame(parseSeed(ctx.ui.seedText), { permadeath: ctx.ui.permadeath }),
      { classes: 'primary execute wide', beep: 'confirm' },
    ),
    seedRow(ctx.ui.seedText, 'Mission seed (optional)', (text) => {
      ctx.ui.seedText = text
    }),
    difficultyControl(ctx),
    btn('VERSUS — HOT-SEAT DUEL', () => ctx.callbacks.onOpenSkirmishSetup(), {
      classes: 'wide versus',
      title: 'TWO CAPTAINS, ONE CONSOLE — HIDDEN WEGO ORDERS',
      beep: 'confirm',
    }),
  )

  const auto = view.saveSlots.find((s) => s.slot === 0)
  actions.append(
    btn('CONTINUE', () => ctx.callbacks.onContinue(), {
      classes: 'wide',
      disabled: !auto?.label,
      title: auto?.label ?? 'NO AUTOSAVE ON RECORD',
      beep: 'confirm',
    }),
  )
  if (auto?.label) actions.append(hint(`AUTOSAVE — ${auto.label}`))

  for (const slot of [1, 2, 3]) {
    const info = view.saveSlots.find((s) => s.slot === slot)
    actions.append(
      btn(`LOAD SLOT ${slot} — ${info?.label ?? 'EMPTY'}`, () => ctx.callbacks.onLoadSlot(slot), {
        classes: 'wide sm',
        disabled: !info?.label,
        beep: 'confirm',
      }),
    )
  }

  const fileInput = el('input')
  fileInput.type = 'file'
  fileInput.accept = '.json,application/json'
  fileInput.hidden = true
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) ctx.callbacks.onImportSave(file)
    fileInput.value = ''
  })
  actions.append(
    btn('IMPORT SAVE FILE', () => fileInput.click(), { classes: 'wide sm', beep: 'confirm' }),
    fileInput,
  )

  box.append(actions)
  return { left: decoRail(LEFT_DECO), right: decoRail(RIGHT_DECO), overlay: box, overlayMode: 'opaque' }
}

/** Two-option LCARS segmented control for the campaign difficulty setting. */
function difficultyControl(ctx: ShellCtx): HTMLElement {
  const wrap = div('menu-difficulty')
  const seg = div('seg-ctl')
  seg.append(
    segOption('STANDARD', 'PERMADEATH', ctx.ui.permadeath, () => {
      ctx.ui.permadeath = true
      ctx.rerender()
    }),
    segOption("CAPTAIN'S MERCY", 'YOUR SHIP IS TOWED HOME ON DEFEAT', !ctx.ui.permadeath, () => {
      ctx.ui.permadeath = false
      ctx.rerender()
    }),
  )
  wrap.append(div('group-lbl', 'DIFFICULTY'), seg)
  return wrap
}

function segOption(name: string, desc: string, selected: boolean, onPick: () => void): HTMLElement {
  const b = btn('', onPick, { classes: 'seg-opt', pressed: selected })
  b.append(el('span', 'seg-name', name), el('span', 'seg-desc', desc))
  return b
}

/** Decorative LCARS rail blocks: [color, label, flex-grow]. Shared with the skirmish screens. */
export function decoRail(blocks: ReadonlyArray<readonly [string, string, number]>): HTMLElement[] {
  const rail = div('deco')
  for (const [color, label, grow] of blocks) {
    const block = div('deco-block', label)
    block.style.background = `var(--lcars-${color})`
    block.style.flexGrow = String(grow)
    rail.append(block)
  }
  return [rail]
}
