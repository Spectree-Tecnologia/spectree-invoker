const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const sum = (runs, field) => {
  const values = runs.map(r => r.metrics?.[field]).filter(number);
  return values.length ? { value: values.reduce((a, b) => a + b, 0), measured: values.length } : { value: null, measured: 0 };
};
const statusNames = { unresolved: 'Sem conclusão registrada', unknown: 'Desconhecido', interrupted: 'Interrompido', failed: 'Falhou', succeeded: 'Concluído com checks', reconciled: 'Reconciliado', active: 'Ativo na consulta', stopped: 'Encerrado', verified: 'Verificado na consulta', stale: 'Obsoleto na consulta', pending: 'Pendente', reconcile: 'Reconciliar', exhausted: 'Tentativas esgotadas' };
export function runtimePanel({ project, changeId, observation, inspecting, inspect }) {
  const runs = (project.runs ?? []).filter(r => r.change_id === changeId).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
  const tasks = (project.tasks ?? []).filter(t => t.change_id === changeId);
  const cost = sum(runs, 'cost_usd'), duration = sum(runs, 'elapsed_ms');
  const tokensIn = sum(runs, 'input_tokens'), tokensOut = sum(runs, 'output_tokens');
  const format = (metric, unit = '') => metric.value === null ? 'Não reportado' : `${metric.value.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}${unit}`;
  const plan = observation?.plan;
  const attempts = runs.filter(r => ['implement', 'repair'].includes(r.phase)).length;
  const interrupted = runs.filter(r => r.events?.some(e => e.type === 'run.finished' && e.status === 'interrupted')).length;
  const failedChecks = runs.flatMap(r => r.checks ?? []).filter(c => c.result !== 'PASS').length;
  return `<section class="panel runtime-panel"><div class="panel-heading"><div><span class="eyebrow">05 / RUNTIME CONECTADO</span><h2>Execuções & rastreabilidade</h2></div><button id="observe-runtime" class="wide-button" ${!changeId || inspecting || project.mode === 'demo' ? 'disabled' : ''}>${inspecting ? 'Consultando…' : 'Consultar runtime'} ↗</button></div>
    <div class="runtime-observation" role="status">${observation ? `<span class="eyebrow">CONSULTA ${esc(observation.observed_at ?? '')}</span><p>${esc(observation.status === 'observed' ? plan?.reason ?? 'Observação disponível.' : observation.message ?? observation.code ?? 'Consulta indisponível.')}</p>${plan ? `<div class="runtime-tags"><span class="badge">${esc(plan.action)}</span><span class="badge ${plan.status === 'blocked' ? 'warn' : ''}">${esc(plan.status)}</span>${observation.task_error ? '<span class="badge warn">Tarefas não verificadas</span>' : ''}</div>` : ''}` : '<p>Consulte os gates e a validade das tarefas usando o planner do runtime. A consulta lê o candidato e não executa agentes ou testes.</p>'}<small>Observação pontual, sem autorização. Alterações posteriores exigem nova consulta.</small></div>
    <div class="runtime-metrics"><div><span class="eyebrow">TEMPO DOS AGENTES</span><strong>${duration.value === null ? 'Não medido' : (duration.value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' s'}</strong><small>${duration.measured}/${runs.length} execuções medidas</small></div><div><span class="eyebrow">TOKENS REPORTADOS</span><strong>${format(tokensIn)} / ${format(tokensOut)}</strong><small>Entrada / saída · ${tokensIn.measured}/${runs.length} com entrada reportada</small></div><div><span class="eyebrow">CUSTO REPORTADO</span><strong>${format(cost, ' USD')}</strong><small>${cost.measured}/${runs.length} execuções com custo</small></div></div>
    <div class="panel-foot">${attempts} tentativa(s) · ${interrupted} interrupção(ões) registrada(s) · ${failedChecks} check(s) sem PASS</div>
    ${observation?.processes_truncated ? '<div class="panel-foot">Inspeção de processos limitada às 20 operações mais recentes.</div>' : ''}
    ${runs.length ? `<div class="run-list">${runs.map(r => {
      const process = observation?.processes?.find(p => p.operation_id === r.operation_id);
      return `<button class="task-row" ${inspect(r, `Execução ${r.operation_id}`)}><span class="task-number">↳</span><span><strong>${esc(r.task_id ?? r.phase ?? r.operation_id)}</strong><small>${esc(r.metrics?.adapter ?? 'Verificação')} · ${esc(r.metrics?.reported_models?.join(', ') ?? 'Modelo não reportado')}${r.metrics?.provenance === 'synthetic_transport' ? ' · transporte sintético' : ''}</small><small>${esc(r.operation_id)}</small></span><span class="badge ${['failed', 'interrupted', 'unknown'].includes(r.status) ? 'warn' : ''}">${esc(statusNames[r.status] ?? r.status)}</span>${process ? `<span class="badge">${esc(statusNames[process.state])}</span>` : ''}<span>↗</span></button>`;
    }).join('')}</div>` : '<div class="empty"><h3>Sem execuções instrumentadas</h3><p>Novas execuções pelo tasks.mjs do runtime 1.10 aparecerão aqui. Registros antigos não geram métricas retroativas.</p></div>'}
    <div class="panel-heading"><h2>Especificação → cenário → evidência</h2><span class="micro">VÍNCULOS DECLARADOS NO PLANO</span></div>
    ${tasks.map(task => {
      const state = observation?.tasks?.tasks?.find(t => t.id === task.id);
      return `<div class="trace-task"><div><strong>${esc(task.id)}</strong> ${state ? `<span class="badge ${state.status === 'stale' ? 'warn' : ''}">${esc(statusNames[state.status] ?? state.status)}</span>` : '<span class="badge">Validade não consultada</span>'}</div><small>Especificação: ${esc(task.refs?.join(', ') ?? 'Sem referências no registro')}</small>${(task.scenarios ?? []).map(scenario => {
        const checks = runs.flatMap(r => r.checks ?? []).filter(c => c.task_id === task.id && c.scenario === scenario);
        return `<button class="trace-scenario" ${inspect({ task_id: task.id, scenario, specification_refs: task.refs ?? [], acceptance: (task.checks ?? []).filter(c => c.scenario === scenario), observed_checks: checks, task_validity: state ?? null, observed_at: observation?.observed_at ?? null }, scenario)}><span>↳ ${esc(scenario)}</span><span>${checks.length} check(s) observado(s) ↗</span></button>`;
      }).join('')}</div>`;
    }).join('')}
    <div class="panel-foot">Duração soma execuções medidas; não é tempo total do projeto. Dados ausentes não contam como zero.</div></section>`;
}
