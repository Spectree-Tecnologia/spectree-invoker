// Explicitly synthetic. Never written into or combined with a consumer's state.
export function demoProject() {
  const change = 'adaptive-context';
  const at = '2026-10-03T18:42:00Z';
  const source = 'Demonstração · dados sintéticos';
  const events = [
    ['18:42', 'work.finished', 'Verificação de cenários concluída', 'reported_success'],
    ['18:38', 'work.reconciled', 'Interrupção inspecionada; efeitos reconciliados', null],
    ['18:31', 'work.finished', 'Limite de execução observado', 'interrupted'],
    ['18:24', 'transition', 'Implementação registrada', null],
    ['18:12', 'transition', 'Cenários adversariais registrados', null],
  ].map(([time, type, task, status], i) => ({ event_id: `demo-${i}`, at: `2026-10-03T${time}:00Z`, change_id: change, type, task, status, source }));
  return { id: 'demo', name: 'spectree / laboratório', mode: 'demo', initialized: true, health: 'readable', observed_at: new Date().toISOString(),
    changes: [{ change_id: change, scope: 'Contexto preciso. Execução confiável.', state: 'implemented', state_revision: 7, adapter: 'codex',
      next_action: { description: 'Preparar o fechamento e verificar a independência de QA.', role: 'platform_engineer' },
      allowed_paths: ['src/context/', 'tests/context/'], base_revision: '7ac42e9', source },
      { change_id: 'mission-recovery', scope: 'Retomada de missões interrompidas', state: 'blocked', blocked_from: 'baselined', blocked_reason: 'Inspecionar a fronteira de processo antes de retomar.', state_revision: 4, adapter: 'claude-code', source }],
    evidence: [
      ['baseline', 'suite.baseline', 'PASS', 'platform_engineer'],
      ['red', 'pass1.tests_failing', 'PASS', 'quality_engineer'],
      ['regression', 'context.regression', 'FAIL', 'quality_engineer'],
      ['repair', 'context.repair', 'PASS', 'full_stack_developer'],
    ].map(([evidence_id, property, result, role]) => ({ evidence_id, property, result, executor: { role }, source_kind: 'observed_execution', change_id: change, check: 'node --test tests/context/*.test.mjs', timestamp: at, revision: '7ac42e9', source })),
    dispatches: [
      ['solutions_architect', 'Decompor o contrato em missões verificáveis.'],
      ['full_stack_developer', 'Implementar a seleção de contexto por fase.'],
      ['quality_engineer', 'Exercitar cenários e inspecionar regressões.'],
      ['platform_engineer', 'Preparar o candidato para verificação.'],
    ].map(([role, mission], i) => ({ dispatch_id: `mission-${i}`, change_id: change, role, mission, attempt: 1, max_attempts: 3, created_at: at, source })),
    approvals: [], tasks: [
      { id: 'context-contract', mission: 'Contrato de contexto', depends_on: [], attempts: [{ status: 'succeeded' }], result: { valid: true, revision: '7ac42e9' } },
      { id: 'phase-router', mission: 'Roteamento por fase', depends_on: ['context-contract'], attempts: [{ status: 'interrupted' }, { status: 'succeeded' }], result: { valid: true } },
      { id: 'adversarial-check', mission: 'Verificação adversarial', depends_on: ['phase-router'], attempts: [], result: null },
    ].map(t => ({ ...t, change_id: change, freshness: 'not_revalidated', source })),
    events, issues: [], legacy: { proposals: [], archives: 0 }, authorizes_execution: false, freshness: 'not_revalidated' };
}
