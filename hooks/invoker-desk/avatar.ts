import { defs, GRADIENT_ID, nest, ORB_COLOR, orbMarkup, ROLES } from './orbs'
import type { OrbKind, Role } from './orbs'
import { PORTRAIT } from './portrait'

const CX = 130
const CY = 108
const ORBIT = 92
// The figure is drawn on a 216-high canvas and set 14 lower, so the top orb's
// glow has room above it.
const DROP = 14
const OY = CY + DROP

// An original drawing in the spirit of the hero, no game art copied: purple
// cape, gold pauldrons, cream robe, magenta collar, swept blond hair and the
// white glow of the eyes.
const FIGURE =
  // aura
  `<circle cx="${CX}" cy="${CY}" r="70" fill="url(#aura)"/>` +
  // cape
  `<path d="M84 112 Q130 92 176 112 L196 206 L64 206 Z" fill="#4a1559"/>` +
  `<path d="M92 118 Q130 104 168 118 L182 206 L78 206 Z" fill="#6b2280"/>` +
  // collar wings behind the head
  `<path d="M112 98 L96 52 L120 84 Z" fill="#a3245e"/>` +
  `<path d="M148 98 L164 52 L140 84 Z" fill="#a3245e"/>` +
  `<path d="M113 96 L101 60 L120 86 Z" fill="#d4a017" opacity="0.55"/>` +
  `<path d="M147 96 L159 60 L140 86 Z" fill="#d4a017" opacity="0.55"/>` +
  // robe
  `<path d="M108 104 L152 104 L162 206 L98 206 Z" fill="#e9dfc6"/>` +
  `<path d="M124 104 L136 104 L140 206 L120 206 Z" fill="#5a2a8a"/>` +
  `<path d="M108 104 L152 104 L150 112 L110 112 Z" fill="#d4a017"/>` +
  // chest sigil
  `<circle cx="${CX}" cy="132" r="9" fill="#d4a017"/>` +
  `<circle cx="${CX}" cy="132" r="5.5" fill="#7a3b0c"/>` +
  `<circle cx="${CX}" cy="132" r="2.5" fill="#ffd970"/>` +
  // pauldrons, layered
  `<path d="M78 124 Q82 100 110 102 Q112 116 104 126 Q90 132 78 124 Z" fill="#b8860b"/>` +
  `<path d="M82 118 Q88 102 108 104 Q108 114 102 120 Q92 124 82 118 Z" fill="#e3b341"/>` +
  `<path d="M182 124 Q178 100 150 102 Q148 116 156 126 Q170 132 182 124 Z" fill="#b8860b"/>` +
  `<path d="M178 118 Q172 102 152 104 Q152 114 158 120 Q168 124 178 118 Z" fill="#e3b341"/>` +
  // neck and face
  `<rect x="124" y="88" width="12" height="16" fill="#d9a77c"/>` +
  `<ellipse cx="${CX}" cy="76" rx="13" ry="16" fill="#e8b98f"/>` +
  `<path d="M118 82 Q130 96 142 82 Q138 92 130 93 Q122 92 118 82 Z" fill="#d9a77c"/>` +
  // hair swept back into a crest
  `<path d="M116 76 Q114 54 130 50 Q148 52 145 76 Q142 62 130 60 Q120 62 116 76 Z" fill="#e8c66a"/>` +
  `<path d="M122 56 Q130 34 140 50 Q134 46 128 54 Z" fill="#f2d98c"/>` +
  // glowing eyes
  `<ellipse cx="124.5" cy="76" rx="3" ry="1.4" fill="#ffffff" filter="url(#blur)"/>` +
  `<ellipse cx="135.5" cy="76" rx="3" ry="1.4" fill="#ffffff" filter="url(#blur)"/>` +
  `<ellipse cx="124.5" cy="76" rx="2.2" ry="0.9" fill="#ffffff"/>` +
  `<ellipse cx="135.5" cy="76" rx="2.2" ry="0.9" fill="#ffffff"/>`

// The traced portrait, when one is shipped: an oval inside the orbit whose
// edge fades into the panel, warmer while the Invoker orchestrates.
function portraitMarkup(isOrchestrating: boolean): string {
  return (
    `<defs><radialGradient id="fade" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0.72" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></radialGradient>` +
    `<mask id="soft"><ellipse cx="${CX}" cy="${OY}" rx="82" ry="86" fill="url(#fade)"/></mask></defs>` +
    `<circle cx="${CX}" cy="${OY}" r="80" fill="url(#aura)"/>` +
    `<g mask="url(#soft)" opacity="${isOrchestrating ? 1 : 0.88}"><g filter="url(#soften)">${nest(PORTRAIT, CX - 82, OY - 86, 164, 172)}</g></g>`
  )
}

// The Invoker with the six orbs around him. Idle, they rest on the circle;
// orchestrating, they orbit him, and the orb of every role with a subagent
// running pulses. The markup depends only on those two facts, so a redraw
// for a timer or a token count sends the same source and the orbit runs on.
export function invokerMarkup(isOrchestrating: boolean, active: readonly Role[]): string {
  const orbs = ROLES.map((one, i) => {
    const angle = (i / ROLES.length) * 2 * Math.PI - Math.PI / 2
    const x = Math.round((CX + ORBIT * Math.cos(angle)) * 10) / 10
    const y = Math.round((OY + ORBIT * Math.sin(angle)) * 10) / 10
    return `<g><title>${one.label}</title>${orbMarkup(one.orb, x, y, 15, GRADIENT_ID[one.orb], active.includes(one.role))}</g>`
  }).join('')
  const orbit = isOrchestrating
    ? `<g>${orbs}<animateTransform attributeName="transform" type="rotate" from="0 ${CX} ${OY}" to="360 ${CX} ${OY}" dur="7s" repeatCount="indefinite"/></g>`
    : `<g opacity="0.8">${orbs}</g>`
  const ring = `<circle cx="${CX}" cy="${OY}" r="${ORBIT}" fill="none" stroke="#ffffff" stroke-opacity="${isOrchestrating ? 0.12 : 0.05}" stroke-dasharray="2 6"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 240" width="260" height="240">` +
    `<defs>${defs()}<radialGradient id="aura" cx="50%" cy="45%" r="50%">` +
    `<stop offset="0" stop-color="#ffb347" stop-opacity="${isOrchestrating ? 0.35 : 0.18}"/>` +
    `<stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient></defs>` +
    (PORTRAIT ? portraitMarkup(isOrchestrating) : `<g transform="translate(0 ${DROP})">${FIGURE}</g>`) +
    ring +
    orbit +
    `</svg>`
  )
}

// The running step's spinner: Quas, Wex and Exort turning like a clock hand,
// the subagent's own orb the largest of the three.
export function spinnerMarkup(kind: OrbKind): string {
  const dots = (['quas', 'wex', 'exort'] as const)
    .map((orb, i) => {
      const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2
      const x = Math.round((8 + 5.2 * Math.cos(angle)) * 10) / 10
      const y = Math.round((8 + 5.2 * Math.sin(angle)) * 10) / 10
      return `<circle cx="${x}" cy="${y}" r="${orb === kind ? 2.6 : 1.8}" fill="${ORB_COLOR[orb].mid}"/>`
    })
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">` +
    `<circle cx="8" cy="8" r="5.2" fill="none" stroke="${ORB_COLOR[kind].mid}" stroke-opacity="0.25" stroke-width="1"/>` +
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
// Quas through Wex to Exort as tasks close and dusted with sparkles. While a
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
    `<defs><linearGradient id="plan-fill"><stop offset="0" stop-color="${ORB_COLOR.quas.mid}"/>` +
    `<stop offset="0.5" stop-color="${ORB_COLOR.wex.mid}"/><stop offset="1" stop-color="${ORB_COLOR.exort.mid}"/></linearGradient>` +
    `<linearGradient id="plan-shine"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/>` +
    `<stop offset="0.5" stop-color="#ffffff" stop-opacity="0.5"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="plan-track"><rect x="0" y="0" width="300" height="14" rx="7"/></clipPath>` +
    `<clipPath id="plan-clip"><rect x="0" y="0" width="${width}" height="14"/></clipPath></defs>` +
    `<rect x="0" y="0" width="300" height="14" rx="7" fill="#ffffff" opacity="0.08"/>` +
    `<g clip-path="url(#plan-track)">` +
    (liveWidth > 0 ? `<rect class="lv" x="${width}" y="0" width="${liveWidth}" height="14" fill="${ORB_COLOR.wex.mid}"/>` : '') +
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

// The terminal's plan bar, a colour per filled cell: the same Quas, Wex and
// Exort gradient as the drawing, spread over however many cells are full, in
// twelve shades so a wide bar is a dozen texts and not one per cell.
export function planCellColors(cells: number): string[] {
  return Array.from({ length: cells }, (_, i) => {
    const t = Math.round((cells > 1 ? i / (cells - 1) : 1) * 11) / 11
    return t < 0.5 ? mix(ORB_COLOR.quas.mid, ORB_COLOR.wex.mid, t * 2) : mix(ORB_COLOR.wex.mid, ORB_COLOR.exort.mid, (t - 0.5) * 2)
  })
}
