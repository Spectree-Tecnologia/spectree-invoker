import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, AgentStatus, DeskUi } from './state'
import { barMarkup, invokerMarkup } from './avatar'
import { formatDuration, formatTokens, formatUsd, plural, stepLabel, tokensOf } from './format'
import { labelOf, ORB_COLOR, orbAvatar, orbOf, roleOf, ROLES } from './orbs'
import type { Role } from './orbs'

const PANE = 'invoker-desk'
const TITLE = 'Invoker'
const STEPS_KEPT = 100
const SHOWN_STEPS = 3

// Change a tag when the stored shape changes: an earlier value is then read
// as the initial one instead of breaking the drawing.
const agents = atom({ plugin: 'spectree', key: 'agents' } as const, {}, { shape: 'agents-1' })
const ui = atom(
  { plugin: 'spectree', key: 'ui' } as const,
  { isRunningCollapsed: false, isFinishedCollapsed: false, expanded: [], isAutoOpened: false },
  { shape: 'ui-2' },
)
const costUsd = atom({ plugin: 'spectree', key: 'costUsd' } as const, null)
const startedAt = atom({ plugin: 'spectree', key: 'startedAt' } as const, null)
const now = atom({ plugin: 'spectree', key: 'now' } as const, 0)

type Agents = Record<string, AgentRow>

const isRunning = (row: AgentRow) => row.status === 'running'

// A reload starts the module over; the next event that needs the clock
// starts it again. It ticks once a second for the session time and the
// running cards' durations.
let tick: { cancel: () => void } | null = null

async function syncClock($: EngineInterface, list: Agents) {
  const at = await $.clock.now()
  await update($, now, () => at)
  if (!tick) tick = $.clock.every(1000, () => void $.clock.now().then(t => update($, now, () => t)))
  const running = Object.values(list).filter(isRunning).length
  $.ui.status(running > 0 ? `Invoker orquestrando ${plural(running, 'subagente', 'subagentes')}` : undefined)
}

async function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE })
}

// Opened unasked once a session, and only where a pane is a sidebar: the
// desktop and the editor. After the person hides it, /invoker-desk brings it back.
async function openWhereSidebar($: EngineInterface) {
  if ((await read($, ui)).isAutoOpened) return
  const surfaces = await $.session.surfaces()
  if (!surfaces.some(one => one === 'desktop' || one === 'vscode')) return
  const opened = await openPane($)
  if (opened.isPlaced) await update($, ui, v => ({ ...v, isAutoOpened: true }))
}

async function isSpectreeProject($: EngineInterface, cwd: string) {
  return (await $.fs.exists(`${cwd}/.spectree`)) || (await $.fs.exists(`${cwd}/docs/changes`))
}

async function recordSpawn($: EngineInterface, id: string, description: string, type: string) {
  const at = await $.clock.now()
  const list = await update($, agents, all => {
    const known = all[id]
    const row: AgentRow = known
      ? { ...known, status: 'running', endedAt: null }
      : { id, description: description || labelOf(type), type, status: 'running', startedAt: at, endedAt: null, tokens: 0, steps: [], stepCount: 0 }
    return { ...all, [id]: row }
  })
  await syncClock($, list)
  if (roleOf(type)) await openWhereSidebar($)
}

async function recordStep($: EngineInterface, id: string, label: string) {
  await update($, agents, all => {
    const row = all[id]
    if (!row) return all
    return { ...all, [id]: { ...row, steps: [...row.steps, label].slice(-STEPS_KEPT), stepCount: row.stepCount + 1 } }
  })
}

async function recordEnd($: EngineInterface, id: string, status: AgentStatus, tokens: number) {
  const at = await $.clock.now()
  const list = await update($, agents, all => {
    const row = all[id]
    if (!row) return all
    return { ...all, [id]: { ...row, status, endedAt: at, tokens: row.tokens + tokens } }
  })
  await syncClock($, list)
}

// The panel only watches: a failure in its bookkeeping is logged and never
// stops a spawn, a tool call or a turn.
function logFailure($: EngineInterface, error: unknown) {
  $.ui.log(`invoker-desk: ${error instanceof Error ? error.message : String(error)}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'invoker-desk',
      description: 'Abre o painel do Invoker: subagentes, custo, tokens e tempo',
    })
    // Time counts from this launch: a resumed session's own start is its
    // first launch, days back, and the panel would show hundreds of hours.
    const launchedAt = await $.clock.now()
    await update($, startedAt, () => launchedAt)
    const usage = await $.session.usage()
    if (usage.cost) await update($, costUsd, () => usage.cost?.usd ?? null)
    // The clock starts here only in a squad project; elsewhere the first
    // dispatch starts it, so a session that never orchestrates pays nothing.
    if (await isSpectreeProject($, e.cwd)) {
      await syncClock($, await read($, agents))
      await openWhereSidebar($)
    } else {
      const at = await $.clock.now()
      await update($, now, () => at)
    }

    return next(e)
  })

  on('command.run', { command: 'invoker-desk' }, async $ => {
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Painel do Invoker aberto.' : `Painel do Invoker não pôde abrir: ${opened.reason ?? 'sem superfície'}` }
  })

  on('session.measure', async ($, e, next) => {
    if (e.cost) await update($, costUsd, () => e.cost?.usd ?? null)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const id = started.agentId
    if (!id) return started

    await recordSpawn($, id, e.description, e.subagentType).catch(error => logFailure($, error))

    return started
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    // An observer: whatever happens to the bookkeeping, the call goes on.
    if (id) await recordStep($, id, stepLabel(String(e.tool), e as unknown as Record<string, unknown>)).catch(error => logFailure($, error))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const status: AgentStatus = e.reason === 'answer' ? 'completed' : e.reason === 'aborted' ? 'killed' : 'failed'
      await recordEnd($, id, status, tokensOf(e.usage)).catch(error => logFailure($, error))
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = 'Svg' in els ? els.Svg : null

    const list = Object.values(await read($, agents)).sort((a, b) => a.startedAt - b.startedAt)
    const view: DeskUi = await read($, ui)
    const cost = await read($, costUsd)
    const since = await read($, startedAt)
    const at = (await read($, now)) || Date.now()

    const running = list.filter(isRunning)
    const finished = list.filter(row => !isRunning(row)).reverse()
    const active = [...new Set(running.map(row => roleOf(row.type)).filter((r): r is Role => r !== null))]
    const tokens = list.reduce((sum, row) => sum + row.tokens, 0)
    const isOrchestrating = running.length > 0

    const toggle = (field: 'isRunningCollapsed' | 'isFinishedCollapsed') => () =>
      update($, ui, v => ({ ...v, [field]: !v[field] }))
    const toggleSteps = (id: string) => () =>
      update($, ui, v => ({
        ...v,
        expanded: v.expanded.includes(id) ? v.expanded.filter(one => one !== id) : [...v.expanded, id],
      }))

    // Terminal: no vector drawing, so the orbs are glyphs, turning one seat
    // a second while the Invoker orchestrates.
    const glyphOrbs = () => {
      const shift = isOrchestrating ? Math.floor(at / 1000) % ROLES.length : 0
      const seats = ROLES.map((_, i) => ROLES[(i + shift) % ROLES.length]!)
      return (
        <Text>
          {seats.map(one => (
            <Text color={ORB_COLOR[one.orb].text} weight={active.includes(one.role) ? 'bold' : 'regular'}>
              {active.includes(one.role) ? '◉ ' : '○ '}
            </Text>
          ))}
        </Text>
      )
    }

    const stat = (label: string, value: string) => (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} flexGrow={1}>
        <Text dimColor size="footnote">
          {label}
        </Text>
        <Text color="#ff8a5c" weight="semibold" tabular>
          {value}
        </Text>
      </Box>
    )

    const card = (row: AgentRow) => {
      const kind = orbOf(row.type)
      const color = ORB_COLOR[kind].text
      const isOpen = view.expanded.includes(row.id)
      const steps = isOpen ? row.steps : row.steps.slice(-SHOWN_STEPS)
      const elapsed = (row.endedAt ?? at) - row.startedAt
      const state = row.status === 'running' ? 'running' : row.status === 'completed' ? 'done' : 'failed'
      const headline =
        row.status === 'running'
          ? `Orquestrando · ${plural(row.stepCount, 'passo', 'passos')}`
          : row.status === 'completed'
            ? `Concluído · ${plural(row.stepCount, 'passo', 'passos')}`
            : row.status === 'killed'
              ? `Interrompido · ${plural(row.stepCount, 'passo', 'passos')}`
              : `Falhou · ${plural(row.stepCount, 'passo', 'passos')}`
      const headColor = row.status === 'completed' ? 'success' : row.status === 'running' ? color : 'error'

      return (
        <Box flexDirection="row" borderStyle="round" borderColor={ORB_COLOR[kind].mid} paddingX={1} gap={1} overflow="hidden">
          <Box flexDirection="column" justifyContent="center" flexShrink={0}>
            {Svg ? (
              <Svg source={orbAvatar(kind, row.status === 'running')} alt={labelOf(row.type)} width={40} height={40} isInteractive />
            ) : (
              <Text color={color}>◉</Text>
            )}
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <Box flexDirection="row" justifyContent="space-between">
              <Text weight="semibold" wrap="truncate-end">
                {row.description}
              </Text>
              <Text color={headColor}>{row.status === 'completed' ? '✓' : row.status === 'running' ? '…' : '✗'}</Text>
            </Box>
            <Box flexDirection="row" justifyContent="space-between">
              <Text dimColor wrap="truncate-end">
                {labelOf(row.type)}
              </Text>
              <Text dimColor tabular>
                {formatTokens(row.tokens)} tokens · {formatDuration(elapsed)}
              </Text>
            </Box>
            <Text color={headColor}>{headline}</Text>
            {steps.map(step => (
              <Text dimColor wrap="truncate-end">
                {`  ${step}`}
              </Text>
            ))}
            {Svg ? (
              <Svg source={barMarkup(color, state)} alt={headline} height={6} isInteractive />
            ) : (
              <Text color={state === 'failed' ? 'error' : color}>{state === 'running' ? '━━━━━━━━──────' : '━━━━━━━━━━━━━━'}</Text>
            )}
            {row.stepCount > SHOWN_STEPS && (
              <Button key={`steps-${row.id}`} plain dimColor onPress={toggleSteps(row.id)}>
                {isOpen ? '▾ Menos passos' : `▸ Todos os ${row.stepCount} passos`}
              </Button>
            )}
          </Box>
        </Box>
      )
    }

    const section = (
      name: string,
      rows: AgentRow[],
      field: 'isRunningCollapsed' | 'isFinishedCollapsed',
      color: string,
    ) =>
      rows.length > 0 && (
        <Box flexDirection="column" gap={1}>
          <Box backgroundColor={color} paddingX={1}>
            <Button key={field} plain onPress={toggle(field)}>
              <Text color="#ffffff" weight="semibold">
                {view[field] ? '▸' : '▾'} {name} · {rows.length}
              </Text>
            </Button>
          </Box>
          {!view[field] && rows.map(card)}
        </Box>
      )

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text color="success" weight="semibold">
            {plural(list.length, 'subagente nesta conversa', 'subagentes nesta conversa')}
          </Text>
          <Button key="hide" label="Ocultar" onPress={() => $.ui.close({ id: PANE })} />
        </Box>

        <Box flexDirection="column" alignItems="center">
          {Svg ? (
            <Svg
              source={invokerMarkup(isOrchestrating, active)}
              alt={isOrchestrating ? `Invoker orquestrando ${running.length} subagentes` : 'Invoker em repouso'}
              width={260}
              height={240}
              isInteractive
            />
          ) : (
            glyphOrbs()
          )}
          <Text dimColor>
            {isOrchestrating
              ? `Invocando ${running.map(row => labelOf(row.type)).join(', ')}`
              : 'Invoker em repouso'}
          </Text>
        </Box>

        <Box flexDirection="row" gap={1}>
          {stat('Custo da conversa', formatUsd(cost))}
          {stat('Tokens dos subagentes', formatTokens(tokens))}
          {stat('Tempo', since === null ? '—' : formatDuration(at - since))}
        </Box>

        {list.length === 0 && <Text dimColor>Nenhum subagente despachado ainda.</Text>}
        {section('Em execução', running, 'isRunningCollapsed', ORB_COLOR.quas.mid)}
        {section('Concluídos', finished, 'isFinishedCollapsed', ORB_COLOR.exort.mid)}
      </Box>
    )
  })
}
