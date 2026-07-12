// Tiny DOM builders shared by the LCARS screens. UI helpers only — no sim imports.

import type { UiBeepKind } from './api'

// UI feedback sounds: every btn() press beeps through this sink. The shell
// installs the real UICallbacks.onUiBeep once at creation; until then, silent.
let beeper: (kind: UiBeepKind) => void = () => {}

export function setBeeper(fn: (kind: UiBeepKind) => void): void {
  beeper = fn
}

/** Fire-and-forget UI beep for interactions outside btn() (deny taps, keyboard). */
export function beep(kind: UiBeepKind): void {
  beeper(kind)
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

export function div(className = '', text = ''): HTMLDivElement {
  return el('div', className, text)
}

export interface BtnOpts {
  /** Extra classes appended after `btn`. */
  classes?: string
  disabled?: boolean
  /** Toggle/selector state: sets aria-pressed and the `on` style. */
  pressed?: boolean
  title?: string
  /** Beep on press; defaults to 'tap'. Pass null to silence (handler beeps itself). */
  beep?: UiBeepKind | null
}

export function btn(label: string, onClick: () => void, opts: BtnOpts = {}): HTMLButtonElement {
  const b = el('button', opts.classes ? `btn ${opts.classes}` : 'btn', label)
  b.type = 'button'
  if (opts.disabled) b.disabled = true
  if (opts.pressed !== undefined) {
    b.setAttribute('aria-pressed', String(opts.pressed))
    if (opts.pressed) b.classList.add('on')
  }
  if (opts.title) b.title = opts.title
  b.addEventListener('click', () => {
    if (opts.beep !== null) beep(opts.beep ?? 'tap')
    onClick()
  })
  return b
}

export function hint(text: string, warn = false): HTMLDivElement {
  return div(warn ? 'hint warn' : 'hint', text)
}

/** SEED label + free-text field row, shared by the campaign menu and skirmish setup. */
export function seedRow(value: string, ariaLabel: string, onInput: (text: string) => void): HTMLDivElement {
  const input = el('input', 'seed-input')
  input.type = 'text'
  input.inputMode = 'numeric'
  input.placeholder = 'RANDOM'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.value = value
  input.setAttribute('aria-label', ariaLabel)
  input.addEventListener('input', () => onInput(input.value))
  const row = div('menu-seed')
  row.append(el('span', 'lbl', 'SEED'), input)
  return row
}

/** Optional numeric seed; anything blank/unparsable falls back to a random uint32. */
export function parseSeed(text: string): number {
  const trimmed = text.trim()
  if (trimmed) {
    const n = Number(trimmed)
    if (Number.isFinite(n)) return Math.abs(Math.floor(n)) >>> 0
  }
  return Math.floor(Math.random() * 4294967296)
}

/** One-decimal readout formatting: 11 → '11.0' (matches the sim's round2 values). */
export function fmt1(n: number): string {
  return n.toFixed(1)
}
