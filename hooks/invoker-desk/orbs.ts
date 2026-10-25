import type { OrbKind } from './state'

// The six specialists, two per orb. Quas (ice, intellect) thinks before the
// build, Wex (storm, speed) builds and attacks, Exort (fire, strength) holds
// the blast radius: git, database, deploy and the paid credential.
export const ROLES = [
  { role: 'solutions-architect', label: 'Solutions Architect', orb: 'quas' },
  { role: 'full-stack-developer', label: 'Full Stack Developer', orb: 'wex' },
  { role: 'platform-engineer', label: 'Platform Engineer', orb: 'exort' },
  { role: 'integration-engineer', label: 'Integration Engineer', orb: 'quas' },
  { role: 'quality-engineer', label: 'Quality Engineer', orb: 'wex' },
  { role: 'typesafe-engineer', label: 'TypeSafe Engineer', orb: 'exort' },
] as const

export type Role = (typeof ROLES)[number]['role']

export const ORB_COLOR: Record<OrbKind, { core: string; mid: string; edge: string; text: string }> = {
  quas: { core: '#e6f7ff', mid: '#38b6ff', edge: '#0a3d8f', text: '#4fb3ff' },
  wex: { core: '#ffe6fb', mid: '#e040fb', edge: '#5a0f7a', text: '#e35cf5' },
  exort: { core: '#fff3c4', mid: '#ff8a1f', edge: '#9e1f05', text: '#ff8a2a' },
  neutral: { core: '#f2f2f3', mid: '#9a9aa3', edge: '#3a3a40', text: '#9a9aa3' },
}

// `spectree:quality-engineer`, `quality-engineer` and a card renamed by the
// harness all end in the role's name.
export function roleOf(agentType: string): Role | null {
  const name = agentType.split(':').pop() ?? ''
  return ROLES.find(one => one.role === name)?.role ?? null
}

export function orbOf(agentType: string): OrbKind {
  const role = roleOf(agentType)
  return ROLES.find(one => one.role === role)?.orb ?? 'neutral'
}

export function labelOf(agentType: string): string {
  const role = roleOf(agentType)
  return ROLES.find(one => one.role === role)?.label ?? agentType
}

function gradient(kind: OrbKind, id: string): string {
  const c = ORB_COLOR[kind]
  return (
    `<radialGradient id="${id}" cx="38%" cy="35%" r="70%">` +
    `<stop offset="0" stop-color="${c.core}"/>` +
    `<stop offset="0.45" stop-color="${c.mid}"/>` +
    `<stop offset="1" stop-color="${c.edge}"/></radialGradient>`
  )
}

// One orb drawn at (cx, cy): a glow, the sphere and a swirl that tells the
// three apart without colour (a spiral, a bolt, a flame).
export function orbMarkup(kind: OrbKind, cx: number, cy: number, r: number, gid: string, isActive: boolean): string {
  const c = ORB_COLOR[kind]
  const s = r / 10
  const mark =
    kind === 'quas'
      ? `<path d="M${cx - 4 * s} ${cy + 1 * s} a4 4 0 1 1 ${8 * s} 0 a3 3 0 1 1 -${6 * s} 0 a2 2 0 1 1 ${4 * s} 0" fill="none" stroke="#ffffff" stroke-opacity="0.75" stroke-width="${1.2 * s}" stroke-linecap="round"/>`
      : kind === 'wex'
        ? `<path d="M${cx + 1 * s} ${cy - 6 * s} L${cx - 3 * s} ${cy + 1 * s} L${cx + 1 * s} ${cy + 1 * s} L${cx - 1 * s} ${cy + 6 * s}" fill="none" stroke="#ffffff" stroke-opacity="0.8" stroke-width="${1.3 * s}" stroke-linejoin="round" stroke-linecap="round"/>`
        : kind === 'exort'
          ? `<path d="M${cx} ${cy - 6 * s} C${cx + 4 * s} ${cy - 2 * s} ${cx + 4 * s} ${cy + 5 * s} ${cx} ${cy + 5 * s} C${cx - 4 * s} ${cy + 5 * s} ${cx - 4 * s} ${cy} ${cx - 1 * s} ${cy - 2 * s} C${cx - 1 * s} ${cy + 1 * s} ${cx + 1 * s} ${cy + 1 * s} ${cx} ${cy - 6 * s}Z" fill="#ffffff" fill-opacity="0.55"/>`
          : ''
  const pulse = isActive
    ? `<animate attributeName="r" values="${r * 1.5};${r * 2.1};${r * 1.5}" dur="1.4s" repeatCount="indefinite"/>`
    : ''
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r * (isActive ? 1.7 : 1.45)}" fill="${c.mid}" opacity="${isActive ? 0.45 : 0.22}" filter="url(#blur)">${pulse}</circle>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${gid})"/>` +
    mark
  )
}

const BLUR = '<filter id="blur" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="3"/></filter>'

// The small avatar of one subagent's card.
export function orbAvatar(kind: OrbKind, isActive: boolean): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="40" height="40">` +
    `<defs>${BLUR}${gradient(kind, `g-${kind}`)}</defs>` +
    orbMarkup(kind, 24, 24, 9, `g-${kind}`, isActive) +
    `</svg>`
  )
}

export function defs(): string {
  return BLUR + gradient('quas', 'gq') + gradient('wex', 'gw') + gradient('exort', 'ge')
}

export const GRADIENT_ID: Record<OrbKind, string> = { quas: 'gq', wex: 'gw', exort: 'ge', neutral: 'gq' }
