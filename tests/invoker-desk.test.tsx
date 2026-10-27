import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'spectree',
  component: 'Pane',
  requestId: 'invoker-desk',
  props: {
    title: 'Invoker',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// The kit's find ignores `alt`: the Svg is picked out of all of them by its alt.
async function svgSource(ui: any, alt: string): Promise<string> {
  const svgs = (await ui.findAll({ type: 'Svg' })) as any[]
  return String(svgs.find(one => one?.props?.alt === alt)?.props?.source ?? '')
}

const ENGINE = { plugin: 'engine', tier: 'core' } as const

async function spawn($: any, agentId: string, subagentType: string, description: string) {
  return $.agent.spawn({
    tool_use_id: `tu-${agentId}`,
    prompt: 'mission',
    description,
    subagentType,
    provider: ENGINE,
    parentModel: 'model',
    background: false,
    fork: false,
  })
}

function engine(on: any, agentId: string, model = 'model') {
  const clock = mock.clock(on, { now: 1_000_000 })
  // Each spawn answers the agent id its tool_use_id names (`tu-<id>`), the first one by default.
  on('agent.spawn', (_: unknown, e: any) => ({ model, agentId: String(e.tool_use_id ?? '').replace(/^tu-/, '') || agentId }))
  // A TaskCreate answers the id of the task it made, numbered from 1.
  let created = 0
  // Helper Desk's plan tool answers as that plugin does.
  on('tool.call', (_: unknown, e: any) => ({
    result:
      e.tool === 'TaskCreate'
        ? { task: { id: String(++created), subject: e.subject } }
        : e.tool === 'mcp__helper-desk__plan'
          ? `Plan saved: 0 of ${e.steps.length} steps done.`
          : {},
  }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: {} }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  return clock
}

test('a finished subagent is a card with its role, steps, tokens and status', async ($, on) => {
  engine(on, 'a1')
  await spawn($, 'a1', 'spectree:quality-engineer', 'QE pass 2 for platform-hardening')
  await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'a1' } as any)
  await $.tool.call({ tool: 'Read', file_path: '/repo/docs/specs/account/spec.md', agentId: 'a1' } as any)
  await $.turn.complete({
    answer: 'done',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    agentId: 'a1',
    reason: 'answer',
    usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 6_000_000, cache_creation_input_tokens: 200_000, model: 'm' },
  } as any)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /subagente nesta conversa/ }))?.text).toBe('1 subagente nesta conversa')
    expect(await ui.find({ type: 'Text', text: /Concluído · 2 passos/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^spectree:quality-engineer · model$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /6\.2M tokens/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Running: npm test/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Using Read: \/repo\/docs\/specs/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Invoker em repouso/ })).toBeDefined()
    if (surface !== 'terminal') {
      // The card's avatar is the orb painting, not the vector sphere: a finished card's the small tracing.
      const svgs = (await (ui as any).findAll({ type: 'Svg' })) as any[]
      const orb = svgs.find(one => one?.props?.alt === 'Quality Engineer')
      expect(String(orb?.props?.source ?? '')).toContain('viewBox="0 0 56 56"')
      expect(String(orb?.props?.source ?? '')).not.toContain('<use ')
      expect(String(orb?.props?.source ?? '')).not.toContain('<image')
      expect(String(orb?.props?.source ?? '').length).toBeLessThanOrEqual(131072)
    }
    await ui.unmount()
  }
})

test('while a subagent runs the Invoker orchestrates and its orb pulses', async ($, on) => {
  engine(on, 'p1')
  await spawn($, 'p1', 'spectree:platform-engineer', 'PE: merge PR 4 and close')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Invocando Platform Engineer/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Em execução · 1/ })).toBeDefined()
  const avatar = await ui.find({ type: 'Svg', alt: /Invoker orquestrando 1/ } as any)
  expect(avatar).toBeDefined()
  expect(String((avatar as any)?.props?.source ?? '')).toContain('animateTransform')
  expect(String((avatar as any)?.props?.source ?? '')).toContain('preserveAspectRatio="xMidYMid slice" viewBox="0 0 260 273"')
  expect(String((avatar as any)?.props?.source ?? '')).toContain('<use href="#art-wex"')
  // The desktop app strips an <image> from an Svg: every picture in it is traced paths.
  expect(String((avatar as any)?.props?.source ?? '')).not.toContain('<image')
  // The engine refuses an Svg source past 131072 characters; the portrait and the orbs ride inside it.
  expect(String((avatar as any)?.props?.source ?? '').length).toBeLessThanOrEqual(131072)
  await ui.unmount()
})

test('a section collapses and the steps of a card expand', async ($, on) => {
  engine(on, 'd1')
  await spawn($, 'd1', 'spectree:full-stack-developer', 'account module')
  for (const command of ['a', 'b', 'c', 'd', 'e']) {
    await $.tool.call({ tool: 'Bash', command: `step ${command}`, agentId: 'd1' } as any)
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Running: step a/ })).toBeUndefined()
  await ui.press({ key: 'steps-d1' })
  expect(await ui.find({ type: 'Text', text: /Running: step a/ })).toBeDefined()
  await ui.press({ key: 'isRunningCollapsed' })
  expect(await ui.find({ type: 'Text', text: /Running: step e/ })).toBeUndefined()
  await ui.unmount()
})

test('a long session stays in budget: each step writes its own subagent, the pane draws a bounded tree', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = engine(on, 'f0')
  // What each write puts in the state, by key.
  const written: Record<string, number> = {}
  on('state.set', (_: unknown, e: any, next: any) => {
    written[e.key] = (written[e.key] ?? 0) + JSON.stringify(e.value ?? null).length
    return next(e)
  })
  // Dispatched first, it ends last: the card that just ended stays.
  await spawn($, 'early', 'spectree:solutions-architect', 'early run')
  for (let i = 0; i < 60; i++) {
    await spawn($, `f${i}`, 'spectree:full-stack-developer', `module ${i}`)
    for (let s = 0; s < 40; s++) await $.tool.call({ tool: 'Bash', command: `npm test step ${s} ${'x'.repeat(80)}`, agentId: `f${i}` } as any)
    await clock.advance(1000)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: `t${i}`, agentId: `f${i}`, reason: 'answer' } as any)
  }
  await clock.advance(1000)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 'te', agentId: 'early', reason: 'answer' } as any)
  for (let r = 0; r < 8; r++) await spawn($, `r${r}`, 'spectree:quality-engineer', `QE ${r}`)

  // A step late in a long session writes its own steps, never the list of subagents.
  for (const key of Object.keys(written)) delete written[key]
  for (let s = 0; s < 10; s++) await $.tool.call({ tool: 'Bash', command: `late ${s}`, agentId: 'r0' } as any)
  expect(written.agents ?? 0).toBe(0)
  expect(written.steps ?? 0).toBeLessThan(10 * 5_000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svgs = (await ui.findAll({ type: 'Svg' })) as any[]
  const sources = svgs.map(one => String(one?.props?.source ?? ''))
  // The engine draws the whole pane at every tick: the large painting rides on the Invoker alone.
  expect(sources.filter(source => source.length > 20_000).length).toBe(1)
  expect(sources.reduce((sum, source) => sum + source.length, 0)).toBeLessThan(250_000)
  // A frame only for what moves: the Invoker and the avatar, spinner and bar of each running card.
  expect(svgs.filter(one => one?.props?.isInteractive).length).toBe(1 + 3 * 8)
  expect(await ui.find({ type: 'Text', text: /Concluídos · 50/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^early run$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^module 59$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^module 55$/ })).toBeUndefined()
  await ui.press({ key: 'finished-whole' })
  expect(await ui.find({ type: 'Text', text: /^module 11$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^module 10$/ })).toBeUndefined()
  await ui.unmount()
})

test('the clock runs only while a subagent runs', async ($, on) => {
  const clock = engine(on, 'c1')
  let ticks = 0
  on('state.set', (_: unknown, e: any, next: any) => {
    if (e.key === 'now') ticks++
    return next(e)
  })
  await spawn($, 'c1', 'spectree:platform-engineer', 'PE')
  ticks = 0
  await clock.advance(3000)
  expect(ticks).toBeGreaterThanOrEqual(3)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', agentId: 'c1', reason: 'answer' } as any)
  ticks = 0
  await clock.advance(5000)
  expect(ticks).toBe(0)
})

test('a drawing that fails leaves a pane that says so', async ($, on) => {
  engine(on, 'x1')
  // A row the drawing cannot read: no type to name its orb by.
  await spawn($, 'x1', undefined as any, 'PE')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Painel do Invoker em recuperação/ })).toBeDefined()
  await ui.unmount()
})

test('the main loop adds no card and its task list fills the plan bar in place of the figures', async ($, on) => {
  engine(on, 'x')
  await $.tool.call({ tool: 'Bash', command: 'ls' } as any)

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Nenhum subagente/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Nenhum plano em andamento/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Custo da conversa|Tokens dos subagentes|^Tempo$/ })).toBeUndefined()
  await ui.unmount()

  for (const subject of ['Bump plugin', 'T-ID-REG', 'Pass 2', 'Close']) {
    await $.tool.call({ tool: 'TaskCreate', subject, description: subject, activeForm: `Doing ${subject}` } as any)
  }
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as any)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' } as any)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '4', status: 'deleted' } as any)
  // A subagent's own task list is not the plan.
  await spawn($, 'd1', 'spectree:full-stack-developer', 'Developer')
  await $.tool.call({ tool: 'TaskCreate', subject: 'inner', description: 'inner', agentId: 'd1' } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Tarefas 1\/3 · 33%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Agora: Doing T-ID-REG$/ })).toBeDefined()
    await ui.unmount()
  }
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const bar = await svgSource(ui, 'Tarefas 1 de 3')
  expect(bar).toContain('viewBox="0 0 300 14"')
  expect(bar).toContain('<animate')
  for (const mid of ['#38b6ff', '#e040fb', '#ff8a1f']) expect(bar).toContain(mid)
  await ui.unmount()

  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' } as any)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'completed' } as any)
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Plano concluído$/ })).toBeDefined()
  const full = await svgSource(ui, 'Tarefas 3 de 3')
  expect(full).toContain('viewBox="0 0 300 14"')
  expect(full).not.toContain('<animate')
  await ui.unmount()
})

test('a todo list fills the plan bar too, the next task named while none is under way', async ($, on) => {
  engine(on, 'x')
  const todos = [
    { content: 'Write the delta', status: 'completed', activeForm: 'Writing the delta' },
    { content: 'Run pass 1', status: 'pending', activeForm: 'Running pass 1' },
  ]
  await $.tool.call({ tool: 'TodoWrite', todos } as any)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Tarefas 1\/2 · 50%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^A seguir: Run pass 1$/ })).toBeDefined()
  await ui.unmount()
})

test('a card is bordered in its orb colour, the sections in Quas and Exort, and a fetch shows its site', async ($, on) => {
  engine(on, 'i1')
  await spawn($, 'i1', 'spectree:integration-engineer', 'IE: WebAuthn research')
  await $.tool.call({ tool: 'WebFetch', url: 'https://www.w3.org/TR/webauthn-3/', prompt: 'read', agentId: 'i1' } as any)
  await $.tool.call({ tool: 'WebSearch', query: 'passkeys conditional ui', agentId: 'i1' } as any)
  await $.tool.call({ tool: 'WebFetch', url: 'https://user:secret@example.com:8443/x', prompt: 'read', agentId: 'i1' } as any)
  await spawn($, 'q1', 'spectree:quality-engineer', 'QE pass 2')
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', agentId: 'q1', reason: 'answer', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' } } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Opening www\.w3\.org$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Searching: passkeys conditional ui/ })).toBeDefined()
    const boxes = ((await (ui as any).findAll({ type: 'Box' })) as any[]).map(one => one?.props ?? {})
    expect(boxes.some(one => one.borderColor === '#38b6ff')).toBe(true)
    expect(boxes.some(one => one.backgroundColor === '#38b6ff')).toBe(true)
    expect(boxes.some(one => one.borderColor === '#e040fb')).toBe(true)
    expect(boxes.some(one => one.backgroundColor === '#ff8a1f')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /Opening example\.com$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /secret/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a long step is cut inside its card and the avatar keeps its place', async ($, on) => {
  engine(on, 'a1')
  await spawn($, 'a1', 'spectree:solutions-architect', 'Architect: exploration round 3')
  const path = `C:\\Users\\someone\\AppData\\Local\\Temp\\claude\\${'very-long-folder\\'.repeat(20)}DOMAIN.md`
  await $.tool.call({ tool: 'Grep', path, agentId: 'a1' } as any)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const boxes = ((await (ui as any).findAll({ type: 'Box' })) as any[]).map(one => one?.props ?? {})
  // The card clips what does not fit, the avatar never shrinks, the text column may.
  expect(boxes.some(one => one.borderColor === '#38b6ff' && one.overflow === 'hidden')).toBe(true)
  const avatar = ((await (ui as any).findAll({ type: 'Box' })) as any[]).find(one =>
    (one?.children ?? []).some((child: any) => child?.type === 'Svg' && child?.props?.alt === 'Solutions Architect'),
  )
  expect(avatar?.props?.flexShrink).toBe(0)
  expect(boxes.some(one => one.minWidth === 0 && one.overflow === 'hidden' && one.flexGrow === 1)).toBe(true)
  const step = await ui.find({ type: 'Text', text: /Using Grep: / })
  expect((step as any)?.props?.wrap).toBe('truncate-end')
  await ui.unmount()
})

test('a card names the subagent type, its model and its effort', async ($, on) => {
  engine(on, 'a1', 'claude-opus-5-5[1m]')
  // A request of the subagent's loop, streamed: the engine below answers it with nothing.
  on('turn.step', async function* (_: unknown, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as any
  })
  await spawn($, 'a1', 'spectree:solutions-architect', 'Architect: exploration round 3')
  for await (const _ of ($ as any).turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1, agentId: 'a1' })) void _

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^spectree:solutions-architect · Opus 5\.5 · medium$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a running card heads with the step under way and the three orbs turning', async ($, on) => {
  engine(on, 'd1')
  await spawn($, 'd1', 'spectree:full-stack-developer', 'Developer: surface')

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Invocando…$/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Read', file_path: '/repo/server/src/http/app.ts', agentId: 'd1' } as any)
  await $.tool.call({ tool: 'Bash', command: 'pnpm typecheck', agentId: 'd1' } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Passo 2 · Running: pnpm typecheck$/ })).toBeDefined()
    // The step under way heads the card once; the list holds the steps before it.
    expect(await (ui as any).findAll({ type: 'Text', text: /Running: pnpm typecheck/ })).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /Using Read: \/repo\/server\/src\/http\/app\.ts/ })).toBeDefined()
    await ui.unmount()
  }

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const spinner = await svgSource(ui, 'Em andamento')
  expect(spinner).toContain('viewBox="0 0 16 16"')
  expect(spinner).toContain('animateTransform')
  for (const mid of ['#38b6ff', '#e040fb', '#ff8a1f']) expect(spinner).toContain(mid)
  await ui.unmount()
})

test('the Invoker keeps its own plan tool: the main loop saves a titled plan, a subagent is told no', async ($, on) => {
  engine(on, 'x')
  on('prompt.compose', () => ({ sections: [] }))
  on('command.register', () => ({ value: { command: 'invoker-desk' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__spectree__plan' } }))
  on('fs.exists', () => ({ value: false }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  const steps = [
    { text: 'Branch from main', status: 'completed' },
    { text: 'Architect proposal', status: 'in_progress' },
    { text: 'Gate 1', status: 'pending' },
  ]
  const said = await $.tool.call({ tool: 'mcp__spectree__plan', title: 'role-integrity — início', steps } as any)
  expect(String((said as any).result)).toBe('Plan saved: 1 of 3 steps done.')
  const refused = await $.tool.call({ tool: 'mcp__spectree__plan', steps: [{ text: 'x' }] } as any)
  expect(String((refused as any).result)).toMatch(/^Plan not saved: "x" needs a status/)
  const inner = await $.tool.call({ tool: 'mcp__spectree__plan', steps: [], agentId: 'd1' } as any)
  expect(String((inner as any).deny)).toMatch(/^Only the main loop keeps a plan/)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^role-integrity — início$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Tarefas 1\/3 · 33%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Agora: Architect proposal$/ })).toBeDefined()
    await ui.unmount()
  }

  // The model is told to keep it, on the main loop and not on a teammate's.
  const main = await ($ as any).prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['desktop'], tools: [], outputStyle: null, traits: [] })
  expect(main.sections.map((one: any) => one.id)).toContain('spectree:plan')
  const mate = await ($ as any).prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['desktop'], tools: [], outputStyle: null, traits: ['teammate'] })
  expect(mate.sections).toHaveLength(0)
})

test("Helper Desk's plan tool feeds the bar when its call reaches the panel", async ($, on) => {
  engine(on, 'x')
  const steps = [
    { text: 'Pull the numbers', status: 'completed' },
    { text: 'Write the summary', status: 'pending' },
  ]
  await $.tool.call({ tool: 'mcp__helper-desk__plan', title: 'Weekly report', steps } as any)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Weekly report$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^A seguir: Write the summary$/ })).toBeDefined()
  await ui.unmount()
})

test('with no plan tool registered, the prompt does not name one', async ($, on) => {
  engine(on, 'x')
  on('prompt.compose', () => ({ sections: [] }))
  on('command.register', () => ({ value: { command: 'invoker-desk' } }))
  on('tool.register', () => {
    throw new Error('refused')
  })
  on('fs.exists', () => ({ value: false }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)

  const composed = await ($ as any).prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['desktop'], tools: [], outputStyle: null, traits: [] })
  expect(composed.sections).toHaveLength(0)
})

test('a plan after a finished one starts untitled, and a todo list carries no title', async ($, on) => {
  engine(on, 'x')
  await $.tool.call({ tool: 'mcp__spectree__plan', title: 'role-integrity', steps: [{ text: 'a', status: 'completed' }] } as any)
  await $.tool.call({ tool: 'mcp__spectree__plan', steps: [{ text: 'b', status: 'in_progress' }] } as any)
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Plano$/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'mcp__spectree__plan', title: 'deck', steps: [{ text: 'c', status: 'in_progress' }] } as any)
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'd', status: 'pending', activeForm: 'Doing d' }] } as any)
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^deck$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Plano$/ })).toBeDefined()
  await ui.unmount()
})
