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
}

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
      costUsd: number | null
      startedAt: number | null
      now: number
    }
  }
}
