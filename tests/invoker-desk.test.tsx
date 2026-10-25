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
  mock.clock(on, { now: 1_000_000 })
  // Each spawn answers the agent id its tool_use_id names (`tu-<id>`), the first one by default.
  on('agent.spawn', (_: unknown, e: any) => ({ model, agentId: String(e.tool_use_id ?? '').replace(/^tu-/, '') || agentId }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: {} }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
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
      // The card's avatar is the orb painting, not the vector sphere.
      const svgs = (await (ui as any).findAll({ type: 'Svg' })) as any[]
      const orb = svgs.find(one => one?.props?.alt === 'Quality Engineer')
      expect(String(orb?.props?.source ?? '')).toContain('viewBox="0 0 160 160"')
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

test('cost comes from the session measure and the main loop adds no card', async ($, on) => {
  engine(on, 'x')
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))
  await $.session.measure({ context: {}, rateLimits: [], cost: { usd: 401.49 }, changed: ['cost'] } as any)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as any)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /\$401\.49/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Nenhum subagente/ })).toBeDefined()
  await ui.unmount()
})

test('in a resumed squad session the time counts from this launch and runs on with no subagent', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('command.register', () => ({ value: { command: 'invoker-desk' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  on('fs.exists', () => ({ value: true }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('ui.status', () => ({ value: {} }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(65_000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^1:05$/ })).toBeDefined()
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
  const spinner = String(((await ui.find({ type: 'Svg', alt: /Em andamento/ } as any)) as any)?.props?.source ?? '')
  expect(spinner).toContain('animateTransform')
  for (const mid of ['#38b6ff', '#e040fb', '#ff8a1f']) expect(spinner).toContain(mid)
  await ui.unmount()
})
