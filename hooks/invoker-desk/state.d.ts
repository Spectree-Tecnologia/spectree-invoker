export type OrbKind = 'quas' | 'wex' | 'exort' | 'neutral'

export type AgentStatus = 'running' | 'completed' | 'failed' | 'killed'

export type AgentRow = {
  id: string
  description: string
  type: string
  status: AgentStatus
  startedAt: number
  endedAt: number | null
  tokens: number
  steps: string[]
  stepCount: number
  // What the subagent runs on, as the engine resolved it, and its effort, once a request names one.
  model?: string
  effort?: string
}

export type PlanTask = {
  id: string
  subject: string
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type Plan = { tasks: PlanTask[] }

export type DeskUi = {
  isRunningCollapsed: boolean
  isFinishedCollapsed: boolean
  expanded: string[]
  isAutoOpened: boolean
}

declare module 'claude-code' {
  interface PluginState {
    spectree: {
      agents: Shaped<Record<string, AgentRow>>
      ui: Shaped<DeskUi>
      plan: Shaped<Plan>
      now: number
    }
  }
}
