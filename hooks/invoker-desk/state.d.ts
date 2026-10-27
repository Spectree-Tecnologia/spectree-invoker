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
  // What the subagent runs on, as the engine resolved it, and its effort, once a request names one.
  model?: string
  effort?: string
}

// A subagent's steps, kept apart from its row so a step writes only its own:
// the last few labels, and how many it has taken.
export type AgentSteps = { count: number; labels: string[] }

export type PlanTask = {
  id: string
  subject: string
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed'
}

// The title is what the plan tool names the job; a task tool's list has none.
export type Plan = { title?: string; tasks: PlanTask[] }

export type DeskUi = {
  isRunningCollapsed: boolean
  isFinishedCollapsed: boolean
  // Every finished card shown, not only the last few.
  isFinishedWhole: boolean
  expanded: string[]
  isAutoOpened: boolean
}

declare module 'claude-code' {
  interface PluginState {
    spectree: {
      agents: Shaped<Record<string, AgentRow>>
      steps: StateFamily<AgentSteps>
      ui: Shaped<DeskUi>
      plan: Shaped<Plan>
      now: number
    }
  }
}
