import { MASCOT_ART } from './mascot-art'
import { PALETTE } from './roles'
import type { AgentStatus } from './state'
import type { Art, Face } from './roles'

// The panel's centre: the mascot, or the specialist that took its place, in a
// Spirit aura with its own glow laid over it. Drawn floating, so it is always
// a frame; the markup depends only on the drawing shown, so a redraw for a
// timer sends the same source and the float runs on.
export function heroMarkup(art: Art): string {
  const drawing = MASCOT_ART[art].replace('<svg ', '<svg x="20" y="10" width="220" height="220" ')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 240" width="260" height="240">` +
    `<style>.fl{animation:fl 3.2s ease-in-out infinite}@keyframes fl{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}` +
    `.gl{animation:gl 3.2s ease-in-out infinite}@keyframes gl{0%,100%{opacity:.35}50%{opacity:.7}}` +
    `@media (prefers-reduced-motion: reduce){.fl,.gl{animation:none}}</style>` +
    `<defs><radialGradient id="aura" cx="50%" cy="48%" r="50%"><stop offset="0" stop-color="${PALETTE.spirit}" stop-opacity="0.22"/>` +
    `<stop offset="1" stop-color="${PALETTE.spirit}" stop-opacity="0"/></radialGradient>` +
    `<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>` +
    `<filter id="soften"><feGaussianBlur stdDeviation="0.45"/></filter></defs>` +
    `<circle cx="130" cy="120" r="112" fill="url(#aura)"/>` +
    `<g class="fl"><g id="hero" filter="url(#soften)">${drawing}</g>` +
    `<use href="#hero" class="gl" filter="url(#glow)" style="mix-blend-mode:screen"/></g>` +
    `</svg>`
  )
}

// A card's avatar. While the subagent runs, its role's expression from the
// mascot's sheet, glowing softly; once it ends, the mascot's hood drawn small,
// smiling when done and frowning when it failed or was stopped.
export function mascotAvatar(status: AgentStatus, face: Face = 'focused'): string {
  if (status === 'running') {
    const drawing = MASCOT_ART[`face_${face}`].replace('<svg ', '<svg x="0" y="0" width="48" height="48" ')
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="40" height="40">` +
      `<style>.gl{animation:gl 1.6s ease-in-out infinite}@keyframes gl{0%,100%{opacity:.25}50%{opacity:.6}}` +
      `@media (prefers-reduced-motion: reduce){.gl{animation:none}}</style>` +
      `<defs><filter id="m-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.4"/></filter>` +
      `<filter id="m-soft"><feGaussianBlur stdDeviation="0.25"/></filter></defs>` +
      `<g id="face" filter="url(#m-soft)">${drawing}</g>` +
      `<use href="#face" class="gl" filter="url(#m-glow)" style="mix-blend-mode:screen"/>` +
      `</svg>`
    )
  }
  const eyes =
    status === 'completed'
      ? `<path d="M15.5 28 Q18.5 24 21.5 28 M26.5 28 Q29.5 24 32.5 28" fill="none" stroke="${PALETTE.spirit}" stroke-width="1.8" stroke-linecap="round"/>`
      : `<path d="M15.5 25.5 L21.5 27.5 L15.5 29 Z M32.5 25.5 L26.5 27.5 L32.5 29 Z"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="40" height="40">` +
    `<defs><filter id="m-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter></defs>` +
    `<circle cx="24" cy="24" r="23" fill="${PALETTE.surface}"/>` +
    `<path d="M24 5 C14 9 8 17 8.5 27 C9 36 15.5 41 24 41 C32.5 41 39 36 39.5 27 C40 17 34 9 24 5 Z" fill="${PALETTE.void}" stroke="${PALETTE.depth}" stroke-width="1.6"/>` +
    `<ellipse cx="24" cy="28" rx="11" ry="9" fill="#000000"/>` +
    `<g fill="${PALETTE.spirit}" filter="url(#m-glow)" opacity="0.7">${eyes}</g>` +
    `<g fill="${PALETTE.spirit}">${eyes}</g>` +
    `</svg>`
  )
}

// The running step's spinner: three Spirit dots turning like a clock hand.
export function spinnerMarkup(): string {
  const dots = [2.6, 2.1, 1.6]
    .map((r, i) => {
      const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2
      const x = Math.round((8 + 5.2 * Math.cos(angle)) * 10) / 10
      const y = Math.round((8 + 5.2 * Math.sin(angle)) * 10) / 10
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${PALETTE.spirit}" opacity="${1 - i * 0.3}"/>`
    })
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">` +
    `<circle cx="8" cy="8" r="5.2" fill="none" stroke="${PALETTE.depth}" stroke-opacity="0.5" stroke-width="1"/>` +
    `<g>${dots}<animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1.2s" repeatCount="indefinite"/></g>` +
    `</svg>`
  )
}

// Fixed noise, so the sparkles sit still between redraws and only their twinkle moves.
const noise = (x: number, y: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return v - Math.floor(v)
}

// Sparkles over the fill: a dither of tiny squares, sparse where the fill
// starts and dense at its head, each twinkling out of phase with its neighbours.
function sparkles(width: number): string {
  const out: string[] = []
  const cols = Math.floor(width / 3)
  for (let c = 0; c < cols; c++) {
    const density = 0.12 + 0.4 * Math.pow(c / Math.max(1, cols), 1.3)
    for (let r = 0; r < 4; r++) {
      if (noise(c, r) < density) out.push(`<rect class="s${Math.floor(noise(r, c) * 4)}" x="${c * 3 + 0.5}" y="${r * 3 + 1.5}" width="1.6" height="1.6"/>`)
    }
  }
  return out.join('')
}

// The plan's progress: a track cut into one segment per task, filled from
// Depth to Spirit as tasks close and dusted with sparkles. While a
// task remains a light sweeps the fill and the task under way glows; a plan
// done is a still image.
export function planBarMarkup(done: number, total: number, isLive = false): string {
  const width = total === 0 ? 0 : Math.round((done / total) * 300)
  const isMoving = done < total
  const liveWidth = isLive && isMoving ? Math.round((Math.min(total, done + 1) * 300) / total) - width : 0
  // A tick under the fill would cut it: only the segments still to go are marked.
  const ticks = Array.from({ length: Math.max(0, total - 1) }, (_, i) => Math.round(((i + 1) * 300) / total))
    .filter(x => x > width + 3)
    .map(x => `<rect x="${x}" y="3" width="1" height="8" fill="#ffffff" opacity="0.18"/>`)
    .join('')
  const motion = isMoving
    ? `<style>.s0,.s1,.s2,.s3{animation:tw 2.1s ease-in-out infinite}.s1{animation-duration:2.7s;animation-delay:-.7s}` +
      `.s2{animation-duration:1.8s;animation-delay:-1.3s}.s3{animation-duration:3.1s;animation-delay:-.4s}` +
      `@keyframes tw{0%,100%{opacity:.95}50%{opacity:.15}}` +
      `.lv{animation:gl 1.6s ease-in-out infinite}@keyframes gl{0%,100%{opacity:.18}50%{opacity:.5}}` +
      `.sh{animation:sw 2.6s linear infinite}@keyframes sw{from{transform:translateX(-70px)}to{transform:translateX(${width + 70}px)}}` +
      `@media (prefers-reduced-motion: reduce){.s0,.s1,.s2,.s3,.lv,.sh{animation:none}}</style>`
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 14" width="300" height="14" preserveAspectRatio="none">` +
    motion +
    `<defs><linearGradient id="plan-fill"><stop offset="0" stop-color="${PALETTE.depth}"/>` +
    `<stop offset="1" stop-color="${PALETTE.spirit}"/></linearGradient>` +
    `<linearGradient id="plan-shine"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/>` +
    `<stop offset="0.5" stop-color="#ffffff" stop-opacity="0.5"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="plan-track"><rect x="0" y="0" width="300" height="14" rx="7"/></clipPath>` +
    `<clipPath id="plan-clip"><rect x="0" y="0" width="${width}" height="14"/></clipPath></defs>` +
    `<rect x="0" y="0" width="300" height="14" rx="7" fill="#ffffff" opacity="0.08"/>` +
    `<g clip-path="url(#plan-track)">` +
    (liveWidth > 0 ? `<rect class="lv" x="${width}" y="0" width="${liveWidth}" height="14" fill="${PALETTE.spirit}"/>` : '') +
    (width > 0 ? `<rect x="0" y="0" width="${width}" height="14" fill="url(#plan-fill)"/>` : '') +
    `<g fill="#ffffff">${sparkles(width)}</g>` +
    (width > 0 && isMoving ? `<g clip-path="url(#plan-clip)"><rect class="sh" x="0" y="0" width="70" height="14" fill="url(#plan-shine)"/></g>` : '') +
    ticks +
    `</g></svg>`
  )
}

// A colour between `a` and `b`, both #rrggbb; `t` from 0 to 1.
function mix(a: string, b: string, t: number): string {
  const at = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map(i => Math.round(at(a, i) + (at(b, i) - at(a, i)) * t).toString(16).padStart(2, '0')).join('')}`
}

// The terminal's plan bar, a colour per filled cell: the same Depth to Spirit
// gradient as the drawing, spread over however many cells are full, in
// twelve shades so a wide bar is a dozen texts and not one per cell.
export function planCellColors(cells: number): string[] {
  return Array.from({ length: cells }, (_, i) => {
    const t = Math.round((cells > 1 ? i / (cells - 1) : 1) * 11) / 11
    return mix(PALETTE.depth, PALETTE.spirit, t)
  })
}
