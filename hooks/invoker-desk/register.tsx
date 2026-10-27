import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, AgentStatus, AgentSteps, DeskUi } from './state'
import { barMarkup, invokerMarkup, planBarMarkup, spinnerMarkup } from './avatar'
import { formatDuration, formatTokens, modelLabel, plural, stepLabel, tokensOf } from './format'
import { applyToPlan, planFromTool, planProgress } from './plan'
import { labelOf, ORB_COLOR, orbAvatar, orbOf, roleOf, ROLES } from './orbs'
import type { Role } from './orbs'

const PANE = 'invoker-desk'
const TITLE = 'Invoker'
// Steps past the last few show only when a card is expanded.
const STEPS_KEPT = 30
const SHOWN_STEPS = 3
// The pane redraws whole every second: a long session's finished cards are
// shown the last few at a time and kept up to a bound.
const SHOWN_FINISHED = 5
const FINISHED_KEPT = 50
const PLAN_TOOLS = ['TaskCreate', 'TaskUpdate', 'TodoWrite']
// The desktop app has no TodoWrite: the Invoker brings its own plan tool, and
// reads Helper Desk's too when that one reaches it.
const PLAN_TOOL = 'mcp__spectree__plan'
const HELPER_PLAN_TOOL = 'mcp__helper-desk__plan'
const PLAN_PROMPT =
  'Your to-do list is the mcp__spectree__plan tool; the user watches it as a progress bar in the Invoker panel. ' +
  'For any task that needs 2 or more steps or tool calls, call it first, before other tools, with a short title and every step in order, the first one in_progress. ' +
  'Call it again with the full list each time a step finishes or a new one starts, and mark the last step completed before your final answer. ' +
  'A step that dispatches subagents is one step. Skip it only for a one-line answer with no tool calls.'

// Change a tag when the stored shape changes: an earlier value is then read
// as the initial one instead of breaking the drawing.
const agents = atom({ plugin: 'spectree', key: 'agents' } as const, {}, { shape: 'agents-2' })
const NO_STEPS: AgentSteps = { count: 0, labels: [] }
const ui = atom(
  { plugin: 'spectree', key: 'ui' } as const,
  { isRunningCollapsed: false, isFinishedCollapsed: false, isFinishedWhole: false, expanded: [], isAutoOpened: false },
  { shape: 'ui-3' },
)
const plan = atom({ plugin: 'spectree', key: 'plan' } as const, { tasks: [] }, { shape: 'plan-1' })
const now = atom({ plugin: 'spectree', key: 'now' } as const, 0)

type Agents = Record<string, AgentRow>

// Set once the plan tool is registered; the prompt names it only then.
let hasPlanTool = false

const isRunning = (row: AgentRow) => row.status === 'running'

// A reload starts the module over; the next event that needs the clock
// starts it again. It ticks once a second for the running cards' durations,
// and only while one runs: each tick redraws the whole pane.
let tick: { cancel: () => void } | null = null

// The last effort recorded per subagent, so a request that repeats it reads nothing.
const efforts = new Map<string, string>()

async function syncClock($: EngineInterface, list: Agents) {
  const at = await $.clock.now()
  await update($, now, () => at)
  const running = Object.values(list).filter(isRunning).length
  if (running > 0 && !tick) tick = $.clock.every(1000, () => void $.clock.now().then(t => update($, now, () => t)))
  if (running === 0 && tick) {
    tick.cancel()
    tick = null
  }
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

async function recordSpawn($: EngineInterface, id: string, description: string, type: string, model: string) {
  const at = await $.clock.now()
  const list = await update($, agents, all => {
    const known = all[id]
    const row: AgentRow = known
      ? { ...known, status: 'running', endedAt: null, model }
      : { id, description: description || labelOf(type), type, model, status: 'running', startedAt: at, endedAt: null, tokens: 0 }
    return { ...all, [id]: row }
  })
  await syncClock($, list)
  if (roleOf(type)) await openWhereSidebar($)
}

// A step writes its own subagent's steps and nothing else, whatever the session has done.
async function recordStep($: EngineInterface, id: string, label: string) {
  await update($, { plugin: 'spectree', key: 'steps', id } as const, (steps = NO_STEPS) => ({
    count: steps.count + 1,
    labels: [...steps.labels, label].slice(-STEPS_KEPT),
  }))
}

async function recordEffort($: EngineInterface, id: string, effort: string) {
  if (efforts.get(id) === effort) return
  const row = (await read($, agents))[id]
  // A step that comes before its spawn is recorded has no row yet: the next one tries again.
  if (!row) return
  if (row.effort !== effort) await update($, agents, all => (all[id] ? { ...all, [id]: { ...all[id], effort } } : all))
  efforts.set(id, effort)
}

async function recordEnd($: EngineInterface, id: string, status: AgentStatus, tokens: number) {
  const at = await $.clock.now()
  let gone: string[] = []
  const list = await update($, agents, all => {
    const row = all[id]
    if (!row) return all
    const next = { ...all, [id]: { ...row, status, endedAt: at, tokens: row.tokens + tokens } }
    // The first to end go first, a card that just ended never.
    const finished = Object.values(next)
      .filter(one => !isRunning(one))
      .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0) || a.startedAt - b.startedAt)
    gone = finished.slice(0, Math.max(0, finished.length - FINISHED_KEPT)).map(one => one.id)
    for (const one of gone) delete next[one]
    return next
  })
  // A card that left takes its steps and its open toggle along.
  for (const one of gone) {
    await update($, { plugin: 'spectree', key: 'steps', id: one } as const, () => NO_STEPS)
    efforts.delete(one)
  }
  if (gone.length > 0) {
    await update($, ui, v => (v.expanded.every(one => one in list) ? v : { ...v, expanded: v.expanded.filter(one => one in list) }))
  }
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
      description: 'Abre o painel do Invoker: o plano em andamento e os subagentes',
    })
    await $.tool.register({
      name: 'plan',
      description:
        'Save the plan for the job in front of you: a short title and the steps in order, each pending, in_progress or completed. ' +
        'It draws the progress bar of the Invoker panel. Send the whole list every time.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A short name for the job, a few words.' },
          steps: {
            type: 'array',
            description: 'Every step, in order.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'The step in a few plain words.' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['text', 'status'],
            },
          },
        },
        required: ['steps'],
      },
      // In the prompt's tool list: a tool behind ToolSearch never gets called.
      isDeferred: false,
    })
      .then(() => {
        hasPlanTool = true
      })
      .catch(error => logFailure($, error))
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

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const id = started.agentId
    if (!id) return started

    await recordSpawn($, id, e.description, e.subagentType, started.model).catch(error => logFailure($, error))

    return started
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (e.tool === PLAN_TOOL) {
      if (id) return { deny: 'Only the main loop keeps a plan. Carry on with your task.' }
      const input = (key: string) => (e as unknown as Record<string, unknown>)[key]
      let said = 'Plan not saved: something went wrong. Carry on.'
      await update($, plan, current => {
        const taken = planFromTool(current, input)
        said = taken.said
        return taken.plan
      }).catch(error => logFailure($, error))
      return { result: said }
    }
    // An observer: whatever happens to the bookkeeping, the call goes on.
    if (id) await recordStep($, id, stepLabel(String(e.tool), e as unknown as Record<string, unknown>)).catch(error => logFailure($, error))

    const answered = await next(e)
    // The plan bar follows the main loop's own task list; a subagent's is its own.
    if (!id && answered.result !== undefined && !answered.isError) {
      const input = (key: string) => (e as unknown as Record<string, unknown>)[key]
      if (PLAN_TOOLS.includes(String(e.tool))) {
        await update($, plan, current => applyToPlan(current, String(e.tool), input, answered.result)).catch(error => logFailure($, error))
      } else if (e.tool === HELPER_PLAN_TOOL && /^Plan saved/.test(String(answered.result))) {
        await update($, plan, current => planFromTool(current, input).plan).catch(error => logFailure($, error))
      }
    }
    return answered
  })

  // The plan tool's instruction, for the main loop only.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    // No tool, no instruction: the model would open every task with a call that fails.
    if (!hasPlanTool || e.traits.includes('teammate') || e.traits.includes('bare')) return composed
    return { sections: [...composed.sections, { id: 'spectree:plan', text: PLAN_PROMPT, scope: 'session' as const }] }
  })

  // A subagent's effort is known only from its requests: the card shows the last one's.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId && e.effort !== undefined) await recordEffort($, e.agentId, String(e.effort)).catch(error => logFailure($, error))
    return yield* next(e)
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
    const progress = planProgress(await read($, plan))
    const at = (await read($, now)) || Date.now()

    const running = list.filter(isRunning)
    // The last to end on top.
    const finished = list.filter(row => !isRunning(row)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0) || b.startedAt - a.startedAt)
    const active = [...new Set(running.map(row => roleOf(row.type)).filter((r): r is Role => r !== null))]
    const isOrchestrating = running.length > 0
    const shownFinished = view.isFinishedWhole ? finished.length : SHOWN_FINISHED
    // Only the cards on screen read their steps.
    const shown = [...(view.isRunningCollapsed ? [] : running), ...(view.isFinishedCollapsed ? [] : finished.slice(0, shownFinished))]
    const stepsBy = new Map(
      await Promise.all(shown.map(async row => [row.id, (await read($, { plugin: 'spectree', key: 'steps', id: row.id } as const)) ?? NO_STEPS] as const)),
    )

    const toggle = (field: 'isRunningCollapsed' | 'isFinishedCollapsed' | 'isFinishedWhole') => () =>
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

    // The plan in progress, in place of the cost, token and time figures.
    const planBar = () =>
      progress.total === 0 ? (
        <Text dimColor>Nenhum plano em andamento.</Text>
      ) : (
        // Clean: no frame around the plan, the title in the text colour; the bar alone carries the orbs.
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Box flexShrink={1} minWidth={0}>
              <Text weight="semibold" wrap="truncate-end">
                {progress.title}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              {Svg ? (
                <Svg
                  source={planBarMarkup(progress.done, progress.total)}
                  alt={`Tarefas ${progress.done} de ${progress.total}`}
                  height={14}
                  isInteractive={progress.done < progress.total}
                />
              ) : (
                <Text color={ORB_COLOR.wex.text}>{'━'.repeat(Math.round(progress.percent / 10)) + '─'.repeat(10 - Math.round(progress.percent / 10))}</Text>
              )}
            </Box>
            <Box flexShrink={0}>
              <Text dimColor tabular>
                {`Tarefas ${progress.done}/${progress.total} · ${progress.percent}%`}
              </Text>
            </Box>
          </Box>
          <Text dimColor wrap="truncate-end">
            {progress.now}
          </Text>
        </Box>
      )

    const card = (row: AgentRow) => {
      const kind = orbOf(row.type)
      const color = ORB_COLOR[kind].text
      const isOpen = view.expanded.includes(row.id)
      // A running card heads with the step under way; the list holds the ones before it.
      const { count, labels } = stepsBy.get(row.id) ?? NO_STEPS
      const done = row.status === 'running' ? labels.slice(0, -1) : labels
      const steps = isOpen ? done : done.slice(-SHOWN_STEPS)
      const current = labels[labels.length - 1]
      const elapsed = (row.endedAt ?? at) - row.startedAt
      const state = row.status === 'running' ? 'running' : row.status === 'completed' ? 'done' : 'failed'
      // A frame per drawing is only for what moves: a finished card's avatar and bar are images.
      const isMoving = row.status === 'running'
      const headline =
        row.status === 'running'
          ? current
            ? `Passo ${count} · ${current}`
            : 'Invocando…'
          : row.status === 'completed'
            ? `Concluído · ${plural(count, 'passo', 'passos')}`
            : row.status === 'killed'
              ? `Interrompido · ${plural(count, 'passo', 'passos')}`
              : `Falhou · ${plural(count, 'passo', 'passos')}`
      const headColor = row.status === 'completed' ? 'success' : row.status === 'running' ? color : 'error'

      return (
        <Box flexDirection="row" borderStyle="round" borderColor={ORB_COLOR[kind].mid} paddingX={1} gap={1} overflow="hidden">
          <Box flexDirection="column" justifyContent="center" flexShrink={0}>
            {Svg ? (
              <Svg source={orbAvatar(kind, isMoving, 'small')} alt={labelOf(row.type)} width={40} height={40} isInteractive={isMoving} />
            ) : (
              <Text color={color}>◉</Text>
            )}
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <Box flexDirection="row" justifyContent="space-between" gap={1}>
              <Box flexShrink={1} minWidth={0}>
                <Text weight="semibold" wrap="truncate-end">
                  {row.description}
                </Text>
              </Box>
              <Box flexShrink={0}>
                <Text color={headColor}>{row.status === 'completed' ? '✓' : row.status === 'running' ? '…' : '✗'}</Text>
              </Box>
            </Box>
            <Box flexDirection="row" justifyContent="space-between" gap={1}>
              <Box flexShrink={1} minWidth={0}>
                <Text dimColor wrap="truncate-end">
                  {[row.type, row.model && modelLabel(row.model), row.effort].filter(Boolean).join(' · ')}
                </Text>
              </Box>
              <Box flexShrink={0}>
                <Text dimColor tabular>
                  {formatTokens(row.tokens)} tokens · {formatDuration(elapsed)}
                </Text>
              </Box>
            </Box>
            {row.status === 'running' ? (
              <Box flexDirection="row" gap={1} alignItems="center">
                <Box flexShrink={0}>
                  {Svg ? <Svg source={spinnerMarkup(kind)} alt="Em andamento" width={16} height={16} isInteractive /> : <Text color={color}>◐</Text>}
                </Box>
                <Box flexShrink={1} minWidth={0}>
                  <Text color={headColor} weight="semibold" wrap="truncate-end">
                    {headline}
                  </Text>
                </Box>
              </Box>
            ) : (
              <Text color={headColor}>{headline}</Text>
            )}
            {steps.map(step => (
              <Text dimColor wrap="truncate-end">
                {`  ${step}`}
              </Text>
            ))}
            {Svg ? (
              <Svg source={barMarkup(color, state)} alt={isMoving ? 'Progresso' : headline} height={6} isInteractive={isMoving} />
            ) : (
              <Text color={state === 'failed' ? 'error' : color}>{state === 'running' ? '━━━━━━━━──────' : '━━━━━━━━━━━━━━'}</Text>
            )}
            {done.length > SHOWN_STEPS && (
              <Button key={`steps-${row.id}`} plain dimColor onPress={toggleSteps(row.id)}>
                {isOpen ? '▾ Menos passos' : `▸ Mais ${done.length - SHOWN_STEPS} passos`}
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
      limit = rows.length,
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
          {!view[field] && rows.slice(0, limit).map(card)}
          {!view[field] && rows.length > SHOWN_FINISHED && field === 'isFinishedCollapsed' && (
            <Button key="finished-whole" plain dimColor onPress={toggle('isFinishedWhole')}>
              {view.isFinishedWhole ? `▾ Só os últimos ${SHOWN_FINISHED}` : `▸ Todos os ${rows.length} concluídos`}
            </Button>
          )}
        </Box>
      )

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="row" justifyContent="flex-end" alignItems="center">
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

        {planBar()}

        {list.length === 0 && <Text dimColor>Nenhum subagente despachado ainda.</Text>}
        {section('Em execução', running, 'isRunningCollapsed', ORB_COLOR.quas.mid)}
        {section('Concluídos', finished, 'isFinishedCollapsed', ORB_COLOR.exort.mid, shownFinished)}
      </Box>
    )
  }).catch(($, e, next) => {
    // A drawing that failed leaves a pane that says so, never a blank one.
    logFailure($, `drawing failed (${next.error.kind}${next.error.message ? `: ${next.error.message}` : ''})`)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Text weight="semibold">Painel do Invoker em recuperação</Text>
        <Text dimColor>Os subagentes seguem rodando; o painel volta no próximo evento.</Text>
      </Box>
    )
  })
}
