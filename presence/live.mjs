import { createPresenceClient } from './client.mjs';
import { freshSurface, startPageLifecycle } from './lifecycle.mjs';
import { createVoiceController } from './voice.mjs';

const labels = { offline: 'Sem conexão', disconnected: 'Desconectado', connecting: 'Conectando', ready: 'Disponível', running: 'Elaborando resposta',
  interrupting: 'Interrompendo', completed: 'Resposta concluída', interrupted: 'Interrompido', error: 'Sessão com erro' };
const errors = { E_CHATGPT_LOGIN: 'Entre no Codex com sua conta ChatGPT pelo terminal e tente conectar novamente.',
  E_INPUT: 'Revise sua mensagem: use de 1 a 8.000 caracteres. O texto foi preservado.',
  E_CODEX_UNAVAILABLE: 'Codex não encontrado. Instale o CLI oficial e confira se codex está no PATH.',
  E_APPROVAL_UNSUPPORTED: 'O Codex pediu uma ação que esta etapa ainda não suporta. A sessão foi encerrada.',
  E_HOOKS_UNSUPPORTED: 'Há hooks ativos na configuração do Codex. Esta sessão de canário exige uma configuração sem hooks.',
  E_CONFIGURATION: 'A configuração do Codex não é compatível com a sessão restrita desta etapa.',
  E_CONTACT_LOST: 'Perdemos contato com a sessão. Verifique a conexão; mensagens não serão reenviadas automaticamente.',
  E_ACTION_UNKNOWN: 'Não recebemos a confirmação. Verifique a conexão e a conversa antes de enviar novamente.',
  E_HISTORY_LIMIT: 'Esta conversa atingiu o limite local. Encerre a sessão e conecte novamente.',
  E_SESSION: 'Abra o endereço completo impresso no terminal para acessar esta sessão.',
  E_TURN_FAILED: 'O Codex não concluiu a resposta. Confira seu acesso e limite de uso antes de tentar novamente.' };

function mount() {
  const root = document.querySelector('#presence'), $ = s => root.querySelector(s), surface = freshSurface(root);
  const token = new URLSearchParams(location.hash.slice(1)).get('session');
  const events = new AbortController(), options = { signal: events.signal };
  let scene, snapshot, disposed = false, visible = true, motion = true, online = false, pending = false;
  let notice = '', shownMessages = '';
  let voice, voiceView = { config: { enabled: false }, state: 'idle', automatic: false, metrics: {} };
  $('.messages').replaceChildren(); $('.brand').href = `./${location.hash}`;
  $('.fallback').hidden = true; $('[data-motion]').disabled = false;
  function paint() {
    const status = online ? snapshot.status : 'offline', working = ['connecting', 'running', 'interrupting'].includes(status);
    $('[data-state]').textContent = `${labels[status] ?? 'Indisponível'} · Invoker`;
    $('[data-caption]').textContent = status === 'running' ? 'Estou elaborando sua resposta.' :
      status === 'offline' ? 'Verifique a conexão para consultar o estado da sessão.' :
      status === 'connecting' ? 'Preparando nossa sessão local.' :
      status === 'interrupting' ? 'Aguardando a confirmação de interrupção do Codex.' :
      status === 'error' ? 'Não foi possível concluir esta sessão.' :
      status === 'interrupted' ? 'Podemos retomar a conversa quando você quiser.' :
      ['ready', 'completed'].includes(status) ? 'Estou aqui. O que vamos explorar?' : 'Conecte o Codex para conversar com o Invoker.';
    $('[data-model]').textContent = snapshot?.model ? `Codex · ${snapshot.model}` : 'Login ChatGPT pelo Codex local';
    $('[data-connect]').disabled = pending || !online || !['disconnected', 'error'].includes(status);
    $('[data-disconnect]').disabled = !online || status === 'disconnected';
    $('[data-refresh]').hidden = online || !token;
    $('[data-send]').disabled = pending || !online || working || !['ready', 'completed', 'interrupted'].includes(status);
    $('#message').disabled = $('[data-send]').disabled;
    const audioBusy = ['requesting', 'recording', 'transcribing'].includes(voiceView.state);
    $('[data-send]').disabled ||= audioBusy || $('#message').value.length > 8000;
    $('[data-interrupt]').disabled = !online || !snapshot?.canInterrupt;
    $('[data-motion]').textContent = motion ? 'Pausar movimento' : 'Ativar movimento';
    $('[data-motion]').setAttribute('aria-pressed', String(motion));
    const error = notice || snapshot?.error;
    $('[data-notice]').textContent = error ? `${errors[error] ?? 'Não foi possível concluir. Encerre a sessão e conecte novamente.'} (${error})` :
      voiceView.config.enabled ? 'Canário isolado · sem acesso a projetos · voz opcional' : 'Canário isolado · sem acesso a projetos · conversa por texto';
    $('[data-notice]').dataset.error = String(!!error);
    const signature = JSON.stringify(snapshot?.messages ?? []);
    if (signature !== shownMessages) {
      const log = $('.messages'), atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
      const fragment = document.createDocumentFragment();
      for (const message of snapshot?.messages ?? []) {
        const article = document.createElement('article'), author = document.createElement('strong'), text = document.createElement('p');
        article.className = 'message'; article.dataset.role = message.role;
        author.textContent = message.role === 'user' ? 'VOCÊ' : 'INVOKER'; text.textContent = message.text;
        article.append(author, text); fragment.append(article);
      }
      log.replaceChildren(fragment); if (atEnd) log.scrollTop = log.scrollHeight; shownMessages = signature;
    }
    paintVoice();
    root.dataset.origin = 'codex'; root.dataset.status = status; root.dataset.speaker = voiceView.state === 'speaking' ? 'invoker' : 'none'; scene?.invalidate();
  }
  function paintVoice() {
    const v = voiceView, panel = $('[data-voice-panel]');
    panel.hidden = v.config.reason === 'E_VOICE_DISABLED' || (!v.config.provider && !v.error);
    panel.dataset.state = v.error ? 'error' : v.state;
    const explanations = { E_AUDIO_KEY: 'Configure OPENAI_API_KEY no terminal que inicia a Presence.',
      E_VOICE_BUDGET: 'Limite local de chamadas atingido ou orçamento não configurado.', E_AUDIO_CONFIG: 'Não foi possível consultar a configuração de voz.',
      E_MIC_PERMISSION: 'Microfone não autorizado. Você pode continuar por texto.', E_MIC_UNAVAILABLE: 'Microfone indisponível neste navegador.',
      E_MIC_TIMEOUT: 'A permissão do microfone demorou. Tente novamente quando estiver pronto.', E_MIC_LOST: 'O microfone foi desconectado.',
      E_AUDIO_SHORT: 'Grave ao menos meio segundo de áudio.', E_AUDIO_PLAYBACK: 'O navegador não liberou a reprodução. Ative Ouvir respostas novamente.',
      E_VOICE_DUPLICATE: 'Este áudio já foi solicitado. Ele não será cobrado novamente automaticamente.',
      E_AUDIO_CANCELLED: 'Áudio interrompido. Nenhuma operação será repetida automaticamente.', E_VOICE_BUSY: 'O áudio anterior ainda está sendo encerrado. Tente novamente.',
      E_AUDIO_PROVIDER: 'O serviço de áudio falhou. Confira a chave e o saldo; o texto continua disponível.' };
    const states = { idle: v.automatic ? 'Voz ativa para novas respostas' : 'Pronto quando você quiser falar', requesting: 'Aguardando microfone…',
      recording: 'Ouvindo você · até 45 segundos', transcribing: 'Transcrevendo sua mensagem…', synthesizing: 'Preparando a voz do Invoker…', speaking: 'Invoker falando', error: 'Não foi possível concluir o áudio.' };
    const code = v.error || v.config.reason;
    $('[data-voice-status]').textContent = code ? explanations[code] ?? 'Não foi possível concluir o áudio. Continue por texto.' : states[v.state];
    $('[data-record]').textContent = v.state === 'recording' ? 'Concluir gravação' : 'Gravar mensagem';
    $('[data-record]').disabled = !v.config.enabled || !online || !['ready', 'completed', 'interrupted'].includes(snapshot?.status) || ['requesting', 'transcribing', 'synthesizing'].includes(v.state);
    $('[data-auto-voice]').disabled = !v.config.enabled || !online;
    $('[data-auto-voice]').textContent = v.automatic ? 'Silenciar respostas' : 'Ouvir respostas';
    $('[data-auto-voice]').setAttribute('aria-pressed', String(v.automatic));
    $('[data-stop-voice]').disabled = ['idle', 'error'].includes(v.state);
    const times = [['transcriptionMs', 'transcrição'], ['codexMs', 'Codex'], ['responseToAudioMs', 'resposta → áudio']]
      .filter(([key]) => Number.isFinite(v.metrics[key])).map(([key, label]) => `${label}: ${(v.metrics[key] / 1000).toFixed(1)} s`);
    $('[data-voice-metrics]').textContent = v.config.provider ? `Reserva local: US$ ${(v.config.reservedUsd ?? 0).toFixed(2)} / ${(v.config.budgetUsd ?? 0).toFixed(2)} · não é o extrato do provedor${times.length ? ' · ' + times.join(' · ') : ''}` : '';
    if (v.config.provider) { $('.demo').textContent = 'CODEX LOCAL · VOZ OPCIONAL'; $('footer span').textContent = 'SESSÃO LOCAL · P3'; }
    if (v.state === 'speaking') { $('[data-state]').textContent = 'FALANDO · INVOKER'; $('[data-caption]').textContent = 'Minha resposta, em voz.'; }
    else if (v.state === 'recording') { $('[data-state]').textContent = 'OUVINDO · INVOKER'; $('[data-caption]').textContent = 'Estou ouvindo. Conclua a gravação quando terminar.'; }
  }
  voice = createVoiceController({ token, onState(value) { if (!disposed) { voiceView = value; paint(); } },
    onTranscript(text) { if (!disposed) { const draft = $('#message'); draft.value = [draft.value.trim(), text].filter(Boolean).join('\n');
      if (draft.value.length > 8000) notice = 'E_INPUT'; draft.focus(); } } });
  const client = createPresenceClient({ token, onUpdate(value) {
    if (disposed) return; snapshot = value.snapshot; online = value.online;
    if (value.error) notice = value.error; voice.sync(snapshot, online); paint();
  } });
  async function action(name, text) {
    if (name === 'send') voice.beforeSend(); else voice.stop();
    notice = ''; pending = true; paint();
    try { await client.action(name, text); if (name === 'send') $('#message').value = ''; }
    catch (e) { if (!disposed) notice = /^E_[A-Z_]+$/.test(e.message) ? e.message : 'E_ACTION_UNKNOWN'; }
    finally { if (!disposed) { pending = false; paint(); } }
  }
  $('[data-connect]').addEventListener('click', () => void action('connect'), options);
  $('[data-disconnect]').addEventListener('click', () => void action('disconnect'), options);
  $('[data-interrupt]').addEventListener('click', () => void action('interrupt'), options);
  $('[data-record]').addEventListener('click', () => void voice.record(), options);
  $('[data-auto-voice]').addEventListener('click', () => void voice.toggle(), options);
  $('[data-stop-voice]').addEventListener('click', () => voice.stop(), options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) voice.stop(); }, options);
  $('[data-refresh]').addEventListener('click', () => { notice = ''; void client.refresh(); }, options);
  $('[data-composer]').addEventListener('submit', e => { e.preventDefault(); if (!$('[data-send]').disabled) void action('send', $('#message').value); }, options);
  $('#message').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!$('[data-send]').disabled) void action('send', $('#message').value); }
  }, options);
  $('#message').addEventListener('input', () => { if (notice === 'E_INPUT') notice = ''; paint(); }, options);
  $('[data-motion]').addEventListener('click', () => { motion = !motion; paint(); }, options);
  const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; scene?.invalidate(); }); observer.observe($('.world'));
  const unavailable = () => { if (disposed) return; scene?.dispose(); scene = undefined; surface.canvas.hidden = true;
    $('.fallback').hidden = false; root.dataset.engine = 'fallback'; $('[data-motion]').disabled = true; };
  import('./renderer.mjs').then(({ createPresenceRenderer }) => {
    if (disposed) return;
    scene = createPresenceRenderer({ canvas: surface.canvas, world: $('.world'), onUnavailable: unavailable,
      read: () => ({ ...voice.sample(), status: voiceView.state === 'recording' ? 'listening' : online && snapshot?.status === 'running' ? 'processing' : 'available',
        speaker: voiceView.state === 'speaking' ? 'invoker' : null, focus: 'invoker', specialist: null, visible, motion }) });
    root.dataset.engine = 'three-webgl2'; scene.invalidate();
  }).catch(unavailable);
  paint(); if (/^[a-f0-9]{64}$/.test(token ?? '')) { void client.refresh(); void voice.init(); } else { notice = 'E_SESSION'; paint(); }
  return { dispose() { disposed = true; events.abort(); observer.disconnect(); voice.dispose(); client.dispose(); scene?.dispose(); } };
}
startPageLifecycle(window, mount);
