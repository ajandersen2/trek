// Main menu: new mission (optional seed), continue, load slots, import save.
// Rails carry decorative LCARS blocks while the menu owns the center.

import type { ViewState } from '../api'
import type { ScreenContent, ShellCtx } from '../context'
import { btn, div, el, hint } from '../dom'

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

  const seedInput = el('input', 'seed-input')
  seedInput.type = 'text'
  seedInput.inputMode = 'numeric'
  seedInput.placeholder = 'RANDOM'
  seedInput.autocomplete = 'off'
  seedInput.spellcheck = false
  seedInput.value = ctx.ui.seedText
  seedInput.setAttribute('aria-label', 'Mission seed (optional)')
  seedInput.addEventListener('input', () => {
    ctx.ui.seedText = seedInput.value
  })
  const seedRow = div('menu-seed')
  seedRow.append(el('span', 'lbl', 'SEED'), seedInput)

  const actions = div('menu-actions')
  actions.append(
    btn('NEW MISSION', () => ctx.callbacks.onNewGame(parseSeed(ctx.ui.seedText)), {
      classes: 'primary execute wide',
    }),
    seedRow,
  )

  const auto = view.saveSlots.find((s) => s.slot === 0)
  actions.append(
    btn('CONTINUE', () => ctx.callbacks.onContinue(), {
      classes: 'wide',
      disabled: !auto?.label,
      title: auto?.label ?? 'NO AUTOSAVE ON RECORD',
    }),
  )
  if (auto?.label) actions.append(hint(`AUTOSAVE — ${auto.label}`))

  for (const slot of [1, 2, 3]) {
    const info = view.saveSlots.find((s) => s.slot === slot)
    actions.append(
      btn(`LOAD SLOT ${slot} — ${info?.label ?? 'EMPTY'}`, () => ctx.callbacks.onLoadSlot(slot), {
        classes: 'wide sm',
        disabled: !info?.label,
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
  actions.append(btn('IMPORT SAVE FILE', () => fileInput.click(), { classes: 'wide sm' }), fileInput)

  box.append(actions)
  return { left: decoRail(LEFT_DECO), right: decoRail(RIGHT_DECO), overlay: box, overlayMode: 'opaque' }
}

/** Optional numeric seed; anything blank/unparsable falls back to a random uint32. */
function parseSeed(text: string): number {
  const trimmed = text.trim()
  if (trimmed) {
    const n = Number(trimmed)
    if (Number.isFinite(n)) return Math.abs(Math.floor(n)) >>> 0
  }
  return Math.floor(Math.random() * 4294967296)
}

function decoRail(blocks: ReadonlyArray<readonly [string, string, number]>): HTMLElement[] {
  const rail = div('deco')
  for (const [color, label, grow] of blocks) {
    const block = div('deco-block', label)
    block.style.background = `var(--lcars-${color})`
    block.style.flexGrow = String(grow)
    rail.append(block)
  }
  return [rail]
}
