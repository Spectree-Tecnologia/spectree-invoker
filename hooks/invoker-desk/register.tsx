import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, AgentStatus, AgentSteps, DeskUi, Plan } from './state'
import { heroMarkup, mascotAvatar, planBarMarkup, planCellColors, spinnerMarkup } from './avatar'
import { formatDuration, formatTokens, modelLabel, plural, stepLabel, tokensOf } from './format'
import { applyToPlan, planFromTool, planProgress } from './plan'
import { artOf, faceOf, labelOf, PALETTE, roleOf } from './roles'
import type { Art } from './roles'

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

// Neighbouring cells of one colour drawn as one text.
function runs(colors: string[]): [string, number][] {
  const out: [string, number][] = []
  for (const color of colors) {
    const last = out[out.length - 1]
    if (last && last[0] === color) last[1] += 1
    else out.push([color, 1])
  }
  return out
}

// The plan on the terminal, where nothing is drawn as a vector: a row of
// blocks from Depth to Spirit, the task under way shimmering once a second
// while the clock runs, and a light track for the rest.
function planBlocks(Text: any, progress: ReturnType<typeof planProgress>, cells: number, at: number) {
  const filled = progress.total === 0 ? 0 : Math.round((cells * progress.done) / progress.total)
  const live = progress.isLive ? Math.max(0, Math.round((cells * Math.min(progress.total, progress.done + 1)) / progress.total) - filled) : 0
  return (
    <Text>
      {runs(planCellColors(filled)).map(([color, count]) => (
        <Text color={color}>{'█'.repeat(count)}</Text>
      ))}
      {live > 0 && <Text color={Math.floor(at / 1000) % 2 ? PALETTE.spirit : PALETTE.depth}>{'▓'.repeat(live)}</Text>}
      <Text dimColor>{'░'.repeat(Math.max(0, cells - filled - live))}</Text>
    </Text>
  )
}

// A plan shows above the terminal's prompt until it is done and the person has written again.
const isBandPlan = (current: Plan) =>
  current.tasks.length > 0 && !(current.isSettled && current.tasks.every(one => one.status === 'completed'))

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

  // A plan done stays above the prompt for the turn that finished it, until the person writes again:
  // a notification, a trigger or a dropped prompt leaves it there.
  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)
    if (e.origin.kind !== 'composer' || e.isMeta || entered.drop !== undefined) return entered
    await update($, plan, current =>
      current.tasks.length > 0 && !current.isSettled && current.tasks.every(one => one.status === 'completed')
        ? { ...current, isSettled: true }
        : current,
    ).catch(error => logFailure($, error))
    return entered
  })

  // The terminal has no sidebar: the plan bar sits above the prompt, under any other plugin's band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const current = await read($, plan)
    if (!isBandPlan(current)) return next(e)
    const drawn = await next(e)
    const rest = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null
    const { Box, Text } = $.ui.resolve(e)
    const progress = planProgress(current)
    // Only a task under way shimmers, so only then does the band follow the clock.
    const at = progress.isLive ? (await read($, now)) || Date.now() : 0
    const label = `Tarefas ${progress.done}/${progress.total}`
    const percent = `${progress.percent}%`
    const columns = e.props.bodyColumns > 0 ? Math.floor(e.props.bodyColumns) : 80
    const titleWidth = Math.max(6, Math.min(28, progress.title.length, Math.floor(columns / 3)))
    // Gaps between the five parts, and the dot.
    const cells = Math.max(6, columns - titleWidth - label.length - percent.length - 6)
    return (
      <Box flexDirection="column">
        {rest as never}
        <Box flexDirection="row" gap={1}>
          <Text color={PALETTE.spirit}>●</Text>
          <Box width={titleWidth} flexShrink={0}>
            <Text weight="semibold" wrap="truncate-end">
              {progress.title}
            </Text>
          </Box>
          {planBlocks(Text, progress, cells, at)}
          <Text weight="semibold">{label}</Text>
          <Text dimColor tabular>
            {percent}
          </Text>
        </Box>
        <Text dimColor wrap="truncate-end">
          {progress.now}
        </Text>
      </Box>
    )
  }).catch(($, e, next) => {
    // A band that fails to draw leaves the prompt as it was.
    logFailure($, `band failed (${next.error.kind}${next.error.message ? `: ${next.error.message}` : ''})`)
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
    const isOrchestrating = running.length > 0
    // The specialist last dispatched takes the mascot's place; idle, the mascot smiles over a plan done.
    const latest = running.reduce<AgentRow | null>((last, row) => (!last || row.startedAt >= last.startedAt ? row : last), null)
    const hero: Art = latest ? artOf(latest.type) : progress.total > 0 && progress.done === progress.total ? 'happy' : 'mascot'
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

    // Terminal: no vector drawing, so the mascot is its two eyes, open while a specialist works.
    const glyphMascot = () => <Text color={PALETTE.spirit}>{isOrchestrating ? '◉ ◉' : '● ●'}</Text>

    // The plan in progress, in place of the cost, token and time figures.
    const planBar = () =>
      progress.total === 0 ? (
        <Text dimColor>Nenhum plano em andamento.</Text>
      ) : (
        // Clean: no frame around the plan, the title in the text colour; the bar alone carries the colour.
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
                  source={planBarMarkup(progress.done, progress.total, progress.isLive)}
                  alt={`Tarefas ${progress.done} de ${progress.total}`}
                  height={14}
                  isInteractive={progress.done < progress.total}
                />
              ) : (
                planBlocks(Text, progress, 12, at)
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
      const color = PALETTE.spirit
      const isOpen = view.expanded.includes(row.id)
      // A running card heads with the step under way; the list holds the ones before it.
      const { count, labels } = stepsBy.get(row.id) ?? NO_STEPS
      const done = row.status === 'running' ? labels.slice(0, -1) : labels
      const steps = isOpen ? done : done.slice(-SHOWN_STEPS)
      const current = labels[labels.length - 1]
      const elapsed = (row.endedAt ?? at) - row.startedAt
      // A frame per drawing is only for what moves: a finished card's avatar is an image.
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
        // Clean: every card is framed in the dim text colour; the mascot's face says how it goes.
        <Box flexDirection="row" borderStyle="round" borderColor="inactive" paddingX={1} gap={1} overflow="hidden">
          <Box flexDirection="column" justifyContent="center" flexShrink={0}>
            {Svg ? (
              <Svg source={mascotAvatar(row.status, faceOf(row.type))} alt={labelOf(row.type)} width={40} height={40} isInteractive={isMoving} />
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
                  {Svg ? <Svg source={spinnerMarkup()} alt="Em andamento" width={16} height={16} isInteractive /> : <Text color={color}>◐</Text>}
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
              source={heroMarkup(hero)}
              alt={latest ? labelOf(latest.type) : 'Invoker em repouso'}
              width={130}
              height={120}
              isInteractive
            />
          ) : (
            glyphMascot()
          )}
          <Text dimColor>
            {isOrchestrating
              ? `Invocando ${running.map(row => labelOf(row.type)).join(', ')}`
              : 'Invoker em repouso'}
          </Text>
        </Box>

        {planBar()}

        {list.length === 0 && <Text dimColor>Nenhum subagente despachado ainda.</Text>}
        {section('Em execução', running, 'isRunningCollapsed', PALETTE.depth)}
        {section('Concluídos', finished, 'isFinishedCollapsed', 'success', shownFinished)}
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
