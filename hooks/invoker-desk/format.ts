import type { ModelUsage } from 'claude-code'

export function tokensOf(usage: ModelUsage | undefined): number {
  if (!usage) return 0
  return usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export function formatUsd(usd: number | null): string {
  return usd === null ? '—' : `$${usd.toFixed(2)}`
}

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// What a step of a subagent reads as on its card: the command a Bash call
// runs, the file a file tool touches, else the tool's name.
export function stepLabel(tool: string, input: Record<string, unknown>): string {
  const field = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
  if (tool === 'Bash') return `Running: ${clip(field('command'), 120)}`
  const path = field('file_path') || field('path') || field('pattern')
  return path ? `Using ${tool}: ${clip(path, 100)}` : `Using ${tool}`
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
