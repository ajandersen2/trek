// Tiny DOM builders shared by the LCARS screens. UI helpers only — no sim imports.

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
  b.addEventListener('click', onClick)
  return b
}

export function hint(text: string, warn = false): HTMLDivElement {
  return div(warn ? 'hint warn' : 'hint', text)
}

/** One-decimal readout formatting: 11 → '11.0' (matches the sim's round2 values). */
export function fmt1(n: number): string {
  return n.toFixed(1)
}
