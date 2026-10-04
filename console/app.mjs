const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const names = { draft: 'Rascunho', proposed: 'Proposta', scope_approved: 'Escopo', isolated: 'Isolamento', baselined: 'Baseline', pass1_complete: 'Pass 1', implemented: 'Implementação', pass2_complete: 'Pass 2', ci_green: 'CI', integration_approved: 'Aprovação', integrated: 'Integração', closed: 'Fechamento', blocked: 'Bloqueada' };
const eventNames = { transition: 'Transição registrada', 'work.started': 'Operação iniciada', 'work.finished': 'Operação finalizada', 'work.reconciled': 'Efeitos reconciliados', adopted_as_draft: 'Mudança adotada', opened: 'Mudança aberta' };
const labels = { succeeded: 'Sucesso relatado', reported_success: 'Sucesso relatado', started: 'Início registrado', interrupted: 'Interrompida', failed: 'Falha registrada', unknown: 'Resultado desconhecido', reconciled: 'Reconciliada' };
const icons = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  changes: '<path d="M5 3v12a4 4 0 0 0 4 4h10M5 7h9a4 4 0 0 1 4 4v8"/><circle cx="5" cy="3" r="2"/><circle cx="19" cy="19" r="2"/>',
  evidence: '<path d="M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="M8 12l3 3 5-6"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-1 7M20 3v7h-7"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">${icons[name] ?? icons.overview}</svg>`;
const logo = '<svg viewBox="0 0 42 34" aria-hidden="true"><g fill="none" stroke="currentColor"><path d="M16 4h10M12 10h18M8 16h26M4 22h34M0 28h42"/><circle cx="21" cy="16" r="1.5" fill="currentColor"/></g></svg>';
let token = new URLSearchParams(location.hash.slice(1)).get('session');
// Keep the credential only in memory. Refreshing the page requires the original terminal URL.
history.replaceState(null, '', location.pathname);
let data, projectId, changeId, view = 'overview', query = '', resultFilter = 'all', paused = false, motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let offline = false, busy = false, records = [], lastFocus;
const project = () => data?.projects.find(p => p.id === projectId) ?? data?.projects[0];
const change = () => project()?.changes.find(c => c.change_id === changeId);
const scoped = key => changeId ? (project()?.[key] ?? []).filter(x => x.change_id === changeId) : [];
const badge = (text, type = '') => `<span class="badge ${type}">${esc(text)}</span>`;
const date = at => at && !Number.isNaN(Date.parse(at)) ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(at)) : 'sem horário';
const inspect = (doc, title = 'Registro') => {
  const i = records.push({ doc, title }) - 1;
  return `data-inspect="${i}"`;
};
function empty(title, text) { return `<div class="empty"><span class="empty-glyph">⌁</span><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`; }

function coreArt() {
  let particles = '';
  // Deterministic spherical lattice. Decorative geometry, never an activity indicator.
  for (let i = 0; i < 700; i++) {
    const z = 1 - 2 * (i + .5) / 700, theta = i * 2.39996323;
    const r = Math.sqrt(1 - z * z), x = r * Math.cos(theta), y = r * Math.sin(theta);
    const px = 240 + x * 112, py = 200 + z * 112;
    particles += `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${(.55 + (y + 1) * .5).toFixed(2)}" opacity="${(.14 + (y + 1) * .31).toFixed(2)}"/>`;
  }
  return `<svg class="core-art" viewBox="0 0 480 400" aria-hidden="true"><defs><radialGradient id="halo"><stop stop-color="#c6d6df" stop-opacity=".13"/><stop offset="1" stop-color="#c6d6df" stop-opacity="0"/></radialGradient><linearGradient id="rim"><stop stop-color="#eff6ff" stop-opacity=".05"/><stop offset=".5" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#eff6ff" stop-opacity=".05"/></linearGradient></defs><circle cx="240" cy="200" r="185" fill="url(#halo)"/><g class="orbital" fill="none" stroke="#a4b2bd"><circle cx="240" cy="200" r="158" stroke-opacity=".13"/><circle cx="240" cy="200" r="173" stroke-opacity=".2" stroke-dasharray="1 12"/><ellipse cx="240" cy="200" rx="185" ry="61" transform="rotate(-29 240 200)" stroke-opacity=".22"/><ellipse cx="240" cy="200" rx="160" ry="58" transform="rotate(52 240 200)" stroke-opacity=".12"/></g><g class="sphere" fill="#edf4fa">${particles}</g><circle cx="240" cy="200" r="113" fill="none" stroke="url(#rim)" stroke-width=".6"/><path d="M195 200h90M240 155v90" stroke="#fff" stroke-opacity=".1"/><circle cx="240" cy="200" r="3" fill="#fff"/><path d="M227 200h26M240 187v26" stroke="#fff" stroke-opacity=".5"/><g fill="#fff"><circle cx="82" cy="200" r="2"/><circle cx="372" cy="112" r="2"/></g></svg>`;
}

function squad() {
  const missions = scoped('dispatches');
  return `<section class="panel constellation" aria-labelledby="squad-title"><div class="panel-heading"><div><span class="eyebrow">01 / INTELIGÊNCIA COORDENADA</span><h2 id="squad-title">Squad topology</h2></div><span class="micro">6 ESPECIALISTAS <span class="dim">/</span> 1 ORQUESTRADOR</span></div>
  <div class="starfield" aria-hidden="true"></div><div class="topology"><svg class="connections" viewBox="0 0 800 430" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor"><path d="M175 78L295 78 400 205 505 78 625 78M175 207H625M175 336L290 336 400 205 510 336 625 336"/><circle cx="400" cy="205" r="188" stroke-dasharray="2 15"/></g></svg>
  <div class="core">${coreArt()}<div class="core-caption"><span class="eyebrow">SPECTREE</span><strong>INVOKER</strong><span>${esc(change() ? names[change().state] ?? change().state : 'Aguardando registros')}</span></div></div>
  <div class="agents">${data.roles.map((role, i) => {
    const entries = missions.filter(m => m.role === role.id);
    return `<button class="agent agent-${i}" ${inspect({ specialist: role, missions: entries, execution: 'Não inferida a partir de missões registradas.' }, role.name)}><span class="agent-symbol">${role.short}<span class="node-dot ${entries.length ? 'recorded' : ''}"></span></span><span class="agent-copy"><strong>${esc(role.name)}</strong><small>${esc(role.purpose)}</small><span class="agent-state">${entries.length ? `${entries.length} ${entries.length > 1 ? 'missões' : 'missão'} registrada${entries.length > 1 ? 's' : ''}` : 'Sem missão registrada'}</span></span><span class="agent-arrow">↗</span></button>`;
  }).join('')}</div></div><div class="panel-foot"><span><span class="tiny-dot"></span> Topologia do protocolo · execução não inferida</span><button class="text-button" id="motion" aria-pressed="${motion}">${motion ? 'Pausar' : 'Ativar'} movimento decorativo ${motion ? 'Ⅱ' : '▷'}</button></div></section>`;
}
function pipelineView() {
  const c = change(), index = data.pipeline.findIndex(p => p.id === (c?.state === 'blocked' ? c.blocked_from : c?.state));
  return `<section class="panel pipeline"><div class="panel-heading"><div><span class="eyebrow">02 / SPEC → SOFTWARE</span><h2>Pipeline da mudança</h2></div>${badge(c ? 'Estado registrado' : 'Sem mudança')}</div><div class="steps">${data.pipeline.map((step, i) => `<button class="step ${c && i === index ? 'current' : ''} ${c && i < index ? 'past' : ''}" ${inspect({ state: step.id, requirements: step.requirements, recorded_state: c?.state ?? null, gate_evaluation: 'Não reavaliado. Use state.mjs plan para consultar os gates do candidato.' }, names[step.id])}><span class="step-dot">${String(i + 1).padStart(2, '0')}</span><span>${names[step.id]}</span></button>`).join('')}</div><div class="panel-foot">${c?.state === 'blocked' ? '⚠ Mudança bloqueada · ' + esc(c.blocked_reason ?? 'Inspecione o registro.') : 'Selecione uma etapa para inspecionar seus requisitos.'}<span>Gates não reavaliados</span></div></section>`;
}
function taskList() {
  const tasks = scoped('tasks');
  return `<section class="panel"><div class="panel-heading"><div><span class="eyebrow">03 / MISSÕES VERIFICÁVEIS</span><h2>Plano de execução</h2></div><span class="count">${tasks.length.toString().padStart(2, '0')}</span></div>${tasks.length ? `<div class="task-list">${tasks.map((t, i) => {
    const latest = t.attempts.at(-1)?.status;
    return `<button class="task-row" ${inspect(t, t.mission)}><span class="task-number">${String(i + 1).padStart(2, '0')}</span><span><strong>${esc(t.mission)}</strong><small>${t.depends_on.length ? 'depende de ' + esc(t.depends_on.join(', ')) : 'Sem dependências'} · ${t.attempts.length} tentativa(s)</small></span>${badge(t.result ? 'Resultado registrado' : labels[latest] ?? 'Pendente', latest === 'interrupted' || latest === 'failed' ? 'warn' : '')}<span>↗</span></button>`;
  }).join('')}</div>` : empty('Sem plano estruturado', 'As tarefas aparecerão quando o runtime registrar um plano para esta mudança.')}<div class="panel-foot">Evidências das tarefas não revalidadas contra o candidato atual.</div></section>`;
}
function evidenceRows(limit = Infinity) {
  let rows = scoped('evidence').filter(e => (view !== 'evidence' || resultFilter === 'all' || e.result === resultFilter) && `${e.property} ${e.evidence_id}`.toLowerCase().includes(query.toLowerCase()));
  return rows.length ? `<div class="evidence-list">${rows.slice(0, limit).map(e => `<button class="evidence-row" ${inspect(e, e.property)}><span class="result-symbol ${e.result === 'FAIL' ? 'danger' : e.result === 'PASS' ? 'success' : 'warn'}">${e.result === 'PASS' ? '✓' : e.result === 'FAIL' ? '×' : '?'}</span><span><strong>${esc(e.property)}</strong><small>${esc(e.source_kind)} · ${esc(e.revision?.slice(0, 8) ?? 'sem revisão')}</small></span>${badge(e.result, e.result === 'FAIL' ? 'danger' : e.result === 'PASS' ? 'success' : 'warn')}<span>↗</span></button>`).join('')}</div>` : empty('Nenhuma evidência encontrada', 'A ausência de evidência não representa aprovação.');
}
function timeline(limit = Infinity) {
  const events = scoped('events').filter(e => `${e.type} ${e.task ?? ''} ${e.status ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return `<section class="panel"><div class="panel-heading"><div><span class="eyebrow">TRILHA OBSERVÁVEL</span><h2>Linha do tempo</h2></div><span class="micro">${events.length} EVENTOS</span></div>${events.length ? `<div class="timeline">${events.slice(0, limit).map(e => `<button class="event" ${inspect(e, eventNames[e.type] ?? e.type)}><time datetime="${esc(e.at)}">${date(e.at)}</time><span class="event-node ${e.status === 'interrupted' || e.status === 'failed' ? 'warn' : ''}"></span><span><strong>${esc(e.task ?? eventNames[e.type] ?? e.type)}</strong><small>${esc(labels[e.status] ?? eventNames[e.type] ?? e.type)}${e.from ? ' · ' + esc(e.from) + ' → ' + esc(e.to) : ''}</small></span><span class="event-arrow">↗</span></button>`).join('')}</div>` : empty('A história começa no primeiro registro', 'Eventos de transição, interrupção e reconciliação aparecerão aqui.')}</section>`;
}
function detailPanel() {
  const p = project(), c = change();
  return `<aside class="details"><section class="panel focus-panel"><div class="panel-heading"><span class="eyebrow">MISSION BRIEF</span><span class="crosshair">⌖</span></div><div class="brief-body"><span class="micro">${c ? 'MUDANÇA SELECIONADA' : 'FONTE CONECTADA'}</span><h2>${esc(c?.scope ?? 'Pronto para observar.')}</h2><p>${esc(c ? c.blocked_reason ?? 'Da especificação à evidência. Cada etapa deixa um registro inspecionável.' : 'O Console está conectado ao projeto. As missões aparecerão quando o squad produzir registros estruturados.')}</p>${badge(c ? names[c.state] ?? c.state : 'Sem mudanças registradas', c?.state === 'blocked' ? 'warn' : '')}</div><dl class="metadata"><div><dt>Adapter</dt><dd>${esc(c?.adapter ?? 'Não registrado')}</dd></div><div><dt>Modelo</dt><dd>Não observado</dd></div><div><dt>Revisão do estado</dt><dd>${c?.state_revision ?? '—'}</dd></div><div><dt>Autoridade</dt><dd>Somente leitura</dd></div></dl><div class="next-step"><span class="eyebrow">↳ PRÓXIMO PASSO REGISTRADO</span><p>${esc(c?.next_action?.description ?? 'Sem recomendação persistida.')}</p><small>Consulte o planner do runtime antes de agir.</small></div>${c ? `<button class="wide-button" ${inspect(c, c.change_id)}>Inspecionar mudança <span>↗</span></button>` : ''}</section>
  <section class="signal-card"><span class="eyebrow">EVIDENCE FIRST</span><h3>Confiança exige<br>rastreabilidade<span>.</span></h3><p>O Console mostra o que foi registrado. A validade atual continua sob os gates do runtime.</p><div class="signal-lines" aria-hidden="true">${'<i></i>'.repeat(26)}</div></section>
  ${p.legacy.archives || p.legacy.proposals.length ? `<section class="panel legacy"><span class="eyebrow">ARTEFATOS LEGADOS</span><p>${p.legacy.proposals.length} propostas · ${p.legacy.archives} pastas arquivadas</p><small>Inventário de diretórios; não comprova conclusão.</small></section>` : ''}</aside>`;
}
function mainView() {
  if (view === 'changes') return `<section class="panel"><div class="panel-heading"><h2>Mudanças do projeto</h2><span class="count">${project().changes.length}</span></div>${project().changes.length ? project().changes.filter(c => `${c.change_id} ${c.scope}`.toLowerCase().includes(query.toLowerCase())).map(c => `<button class="change-row" data-change="${esc(c.change_id)}"><span class="change-icon">⌘</span><span><strong>${esc(c.scope)}</strong><small>${esc(c.change_id)} · ${esc(c.adapter)}</small></span>${badge(names[c.state] ?? c.state, c.state === 'blocked' ? 'warn' : '')}<span>→</span></button>`).join('') : empty('Nenhuma mudança estruturada', 'O Console não converte artefatos legados em estados de execução.')}</section>`;
  if (view === 'evidence') return `<section class="panel"><div class="panel-heading"><div><span class="eyebrow">RESULTADOS PERSISTIDOS</span><h2>Biblioteca de evidências</h2></div><label class="filter">Resultado <select id="result-filter"><option value="all">Todos</option>${['PASS', 'FAIL', 'EXPECTED_REJECTION', 'INFRA_ERROR', 'NOT_RUN', 'INCONCLUSIVE'].map(v => `<option ${resultFilter === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>${evidenceRows()}<div class="panel-foot">PASS é o resultado registrado naquele candidato; não certifica o conteúdo atual.</div></section><section class="panel approvals"><div class="panel-heading"><h2>Aprovações registradas</h2>${badge('Autoridade não reavaliada')}</div>${scoped('approvals').length ? scoped('approvals').map(a => `<button class="change-row" ${inspect(a, a.gate)}><strong>${esc(a.gate)}</strong><span>${esc(a.approval_id)}</span><span>↗</span></button>`).join('') : empty('Sem aprovações vinculadas', 'Autorizações de outras mudanças não são atribuídas a esta seleção.')}</section>`;
  if (view === 'activity') return timeline();
  return `<div class="workspace-grid"><div class="primary">${squad()}${pipelineView()}${taskList()}<section class="panel"><div class="panel-heading"><div><span class="eyebrow">04 / VERIFICABILIDADE</span><h2>Evidências recentes</h2></div><button class="text-button" data-view="evidence">Ver todas ↗</button></div>${evidenceRows(4)}</section>${timeline(5)}</div>${detailPanel()}</div>`;
}
function render() {
  if (!data) return;
  const p = project();
  const active = document.activeElement;
  const selection = active?.id === 'search' ? [active.selectionStart, active.selectionEnd] : null;
  const focusRecord = active?.dataset?.inspect !== undefined ? records[Number(active.dataset.inspect)] : null;
  const focusView = active?.dataset?.view;
  records = [];
  const c = change(), evidence = scoped('evidence');
  const titles = { overview: ['Centro de operações', 'Inteligência, em operação.'], changes: ['Registro de mudanças', 'Especificar. Construir. Verificar.'], evidence: ['Evidências do squad', 'Cada resultado, rastreável.'], activity: ['Histórico operacional', 'O trabalho deixa uma trilha.'] };
  const focusId = document.activeElement?.id;
  document.body.classList.toggle('no-motion', !motion);
  $('#app').innerHTML = `<header class="topbar"><a class="brand" href="#" aria-label="Spectree Console — início" data-home>${logo}<span>spectree<span class="brand-slash"> / </span><span class="brand-console">console</span></span></a><div class="topbar-context"><span class="dim">WORKSPACE</span><span>/</span><span>${esc(p.name)}</span></div><div class="session"><span class="tiny-dot ${offline ? 'warn' : ''}"></span><span>${data.mode === 'demo' ? 'DEMONSTRAÇÃO' : 'SESSÃO LOCAL'}</span><span class="version">v1.9</span></div></header>
  <div class="app-layout"><aside class="sidebar"><div><label class="eyebrow" for="project-select">SEU WORKSPACE</label><select id="project-select">${data.projects.map(x => `<option value="${esc(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div><div class="nav-label eyebrow">OBSERVABILIDADE</div><nav aria-label="Navegação principal">${[['overview', 'Visão geral'], ['changes', 'Mudanças'], ['evidence', 'Evidências'], ['activity', 'Atividade']].map(([v, name]) => `<button data-view="${v}" ${view === v ? 'aria-current="page"' : ''}>${icon(v)}<span>${name}</span>${v === 'changes' ? `<span class="nav-count">${p.changes.length}</span>` : v === 'overview' ? '<span class="nav-spark">✦</span>' : ''}</button>`).join('')}</nav><div class="sidebar-note"><span class="tiny-dot"></span><span>OBSERVAÇÃO LOCAL</span><p>Especificações guiam.<br>Evidências sustentam.</p></div><div class="sidebar-bottom"><span class="mono-mark">S</span><div>spectree engineering<small>spec-driven by design</small></div><span>↗</span></div></aside>
  <main id="main" tabindex="-1"><div class="breadcrumb">SPECTREE INVOKER <span>/</span> ${esc(titles[view][0].toUpperCase())}</div><div class="page-heading"><div><span class="eyebrow">${data.mode === 'demo' ? 'LABORATÓRIO / DADOS SINTÉTICOS' : 'SPEC-DRIVEN ENGINEERING'}</span><h1>${titles[view][1]}</h1><p>Visibilidade sobre o squad. Precisão em cada decisão.</p></div><div class="refresh-controls"><span class="sync-label">${offline ? 'Conexão perdida' : paused ? 'Leitura pausada' : 'Leitura às ' + date(p.observed_at)}</span><button id="pause" class="icon-button" aria-label="${paused ? 'Retomar' : 'Pausar'} atualização">${paused ? '▷' : 'Ⅱ'}</button><button id="refresh" class="icon-button" aria-label="Atualizar dados">${icon('refresh')}</button></div></div>
  ${data.mode === 'demo' ? '<div class="notice demo-notice"><span>◇</span><strong>Ambiente de demonstração</strong><span>Todos os dados abaixo são sintéticos. Nenhum agente está sendo executado.</span></div>' : ''}
  ${offline ? '<div class="notice error-notice" role="alert">Conexão indisponível. Os dados exibidos estão desatualizados; tente atualizar.</div>' : ''}
  ${p.issues.length ? `<div class="notice error-notice"><strong>Leitura parcial · ${p.issues.length} alerta(s)</strong><button class="text-button" ${inspect(p.issues, 'Problemas de leitura')}>Inspecionar fontes ↗</button></div>` : ''}
  ${!p.initialized ? '<div class="notice">Projeto sem estado estruturado legível. O Console não inicializa nem altera o projeto.</div>' : ''}
  <div class="command-strip"><div class="change-select"><label for="change-select">MUDANÇA</label><select id="change-select" ${!p.changes.length ? 'disabled' : ''}>${!p.changes.length ? '<option>Sem mudanças registradas</option>' : p.changes.map(x => `<option value="${esc(x.change_id)}" ${x.change_id === c?.change_id ? 'selected' : ''}>${esc(x.change_id)}</option>`).join('')}</select></div><div class="strip-stat"><strong>${scoped('dispatches').length.toString().padStart(2, '0')}</strong><span>missões<br>registradas</span></div><div class="strip-stat"><strong>${evidence.length.toString().padStart(2, '0')}</strong><span>evidências<br>persistidas</span></div><label class="search"><span>⌕</span><input id="search" type="search" placeholder="Buscar registros…" aria-label="Buscar registros" value="${esc(query)}"><kbd>/</kbd></label></div>
  <div id="view-content">${mainView()}</div><footer class="footer"><span>${logo} SPEC → EVIDENCE → SOFTWARE</span><span>SOMENTE LEITURA <span class="dim">/</span> ${data.mode === 'demo' ? 'DADOS SINTÉTICOS' : 'FONTES LOCAIS'}</span></footer></main></div>`;
  if (focusId) {
    document.getElementById(focusId)?.focus({ preventScroll: true });
    if (selection?.[0] !== null && selection) $('#search')?.setSelectionRange(...selection);
  }
  else if (focusView) document.querySelector(`nav [data-view="${focusView}"]`)?.focus({ preventScroll: true });
  else if (focusRecord) {
    const index = records.findIndex(r => r.title === focusRecord.title && r.doc.source === focusRecord.doc.source);
    document.querySelector(`[data-inspect="${index}"]`)?.focus({ preventScroll: true });
  }
}
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    if (!token) throw new Error('Sessão ausente. Abra o endereço completo exibido pelo comando npm run console.');
    const response = await fetch('/api/snapshot', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 401 ? 'Sessão expirada. Abra novamente o endereço exibido no terminal.' : 'Não foi possível ler as fontes locais.');
    const next = await response.json();
    // Keep the displayed snapshot coherent while the user is typing or inspecting a record.
    // A subsequent poll will publish a new snapshot once the interaction ends.
    if (data && !offline && ($('#inspector').open || ['INPUT', 'SELECT'].includes(document.activeElement?.tagName))) return;
    const content = snapshot => JSON.stringify(snapshot, (key, value) => key === 'observed_at' ? undefined : value);
    const changed = !data || offline || content(data) !== content(next);
    data = next;
    if (!data.projects.some(p => p.id === projectId)) projectId = data.projects[0].id;
    if (!project().changes.some(c => c.change_id === changeId)) changeId = project().changes[0]?.change_id;
    if (offline) $('#announcement').textContent = 'Conexão restabelecida.';
    offline = false;
    if (changed) render();
    else if ($('.sync-label')) $('.sync-label').textContent = paused ? 'Leitura pausada' : 'Leitura às ' + date(project().observed_at);
  } catch (error) {
    offline = true;
    if (data) render();
    else $('#app').innerHTML = `<main class="boot">${logo}<h1>Conexão necessária.</h1><p>${esc(error.message)}</p><button id="refresh" class="wide-button">Tentar novamente ↻</button></main>`;
    $('#announcement').textContent = 'Não foi possível atualizar as observações.';
  } finally { busy = false; }
}
document.addEventListener('click', event => {
  const target = event.target.closest('button, [data-home]');
  if (!target) return;
  if (target.hasAttribute('data-home')) { event.preventDefault(); view = 'overview'; query = ''; render(); }
  else if (target.dataset.view) { view = target.dataset.view; query = ''; render(); $('#main').focus(); }
  else if (target.dataset.change) { changeId = target.dataset.change; view = 'overview'; render(); }
  else if (target.dataset.inspect !== undefined) {
    const entry = records[Number(target.dataset.inspect)];
    if (!entry) return;
    lastFocus = target;
    $('#inspector-title').textContent = entry.title;
    $('#inspector-json').textContent = JSON.stringify(entry.doc, null, 2);
    $('#inspector').showModal();
  } else if (target.id === 'close-dialog') $('#inspector').close();
  else if (target.id === 'refresh') { target.blur(); refresh(); }
  else if (target.id === 'pause') { paused = !paused; render(); }
  else if (target.id === 'motion') { motion = !motion; render(); }
});
$('#inspector').addEventListener('close', () => lastFocus?.isConnected && lastFocus.focus());
document.addEventListener('change', event => {
  if (event.target.id === 'project-select') { projectId = event.target.value; changeId = project().changes[0]?.change_id; query = ''; render(); }
  if (event.target.id === 'change-select') { changeId = event.target.value; query = ''; render(); }
  if (event.target.id === 'result-filter') { resultFilter = event.target.value; render(); }
});
document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  query = event.target.value;
  if (view === 'overview') { view = 'evidence'; const pos = event.target.selectionStart; render(); $('#search').focus(); if (pos !== null) try { $('#search').setSelectionRange(pos, pos); } catch {} }
  else render();
});
document.addEventListener('keydown', event => {
  if (event.key === '/' && !$('#inspector').open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) { event.preventDefault(); $('#search')?.focus(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && !paused) refresh(); });
setInterval(() => { if (!paused && !document.hidden) refresh(); }, 5000);
refresh();
