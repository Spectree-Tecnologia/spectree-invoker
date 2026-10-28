// The six specialists, each with the drawing that takes the mascot's place while it works.
export const ROLES = [
  { role: 'solutions-architect', label: 'Solutions Architect', art: 'architect' },
  { role: 'full-stack-developer', label: 'Full Stack Developer', art: 'developer' },
  { role: 'platform-engineer', label: 'Platform Engineer', art: 'platform' },
  { role: 'integration-engineer', label: 'Integration Engineer', art: 'integration' },
  { role: 'quality-engineer', label: 'Quality Engineer', art: 'quality' },
  { role: 'typesafe-engineer', label: 'TypeSafe Engineer', art: 'typesafe' },
] as const

export type Role = (typeof ROLES)[number]['role']
export type Art = (typeof ROLES)[number]['art'] | 'mascot' | 'happy'

// The Spectree rebrand palette (2026-10-28): the panel's whole colour.
export const PALETTE = {
  void: '#080b10',
  surface: '#151d24',
  mist: '#dde8e8',
  spirit: '#58e5d4',
  depth: '#187e7d',
} as const

// `spectree:quality-engineer`, `quality-engineer` and a card renamed by the
// harness all end in the role's name.
export function roleOf(agentType: string): Role | null {
  const name = agentType.split(':').pop() ?? ''
  return ROLES.find(one => one.role === name)?.role ?? null
}

export function labelOf(agentType: string): string {
  const role = roleOf(agentType)
  return ROLES.find(one => one.role === role)?.label ?? agentType
}

// A subagent of no squad role works under the mascot itself.
export function artOf(agentType: string): Art {
  const role = roleOf(agentType)
  return ROLES.find(one => one.role === role)?.art ?? 'mascot'
}
