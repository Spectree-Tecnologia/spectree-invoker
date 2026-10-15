import { createPresenceClient } from './client.mjs';
import { freshSurface, startPageLifecycle } from './lifecycle.mjs';

const labels = { offline: 'Sem conexão', disconnected: 'Desconectado', connecting: 'Conectando', ready: 'Disponível', running: 'Elaborando resposta',
  interrupting: 'Interrompendo', completed: 'Resposta concluída', interrupted: 'Interrompido', error: 'Sessão com erro' };
const errors = { E_CHATGPT_LOGIN: 'Entre no Codex com sua conta ChatGPT pelo terminal e tente conectar novamente.',
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
    $('[data-interrupt]').disabled = !online || !snapshot?.canInterrupt;
    $('[data-motion]').textContent = motion ? 'Pausar movimento' : 'Ativar movimento';
    $('[data-motion]').setAttribute('aria-pressed', String(motion));
    const error = notice || snapshot?.error;
    $('[data-notice]').textContent = error ? `${errors[error] ?? 'Não foi possível concluir. Encerre a sessão e conecte novamente.'} (${error})` : 'Canário isolado · sem acesso a projetos · sem microfone ou voz';
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
    root.dataset.origin = 'codex'; root.dataset.status = status; root.dataset.speaker = 'none'; scene?.invalidate();
  }
  const client = createPresenceClient({ token, onUpdate(value) {
    if (disposed) return; snapshot = value.snapshot; online = value.online;
    if (value.error) notice = value.error; paint();
  } });
  async function action(name, text) {
    notice = ''; pending = true; paint();
    try { await client.action(name, text); if (name === 'send') $('#message').value = ''; }
    catch (e) { if (!disposed) notice = /^E_[A-Z_]+$/.test(e.message) ? e.message : 'E_ACTION_UNKNOWN'; }
    finally { if (!disposed) { pending = false; paint(); } }
  }
  $('[data-connect]').addEventListener('click', () => void action('connect'), options);
  $('[data-disconnect]').addEventListener('click', () => void action('disconnect'), options);
  $('[data-interrupt]').addEventListener('click', () => void action('interrupt'), options);
  $('[data-refresh]').addEventListener('click', () => { notice = ''; void client.refresh(); }, options);
  $('[data-composer]').addEventListener('submit', e => { e.preventDefault(); if (!$('[data-send]').disabled) void action('send', $('#message').value); }, options);
  $('#message').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!$('[data-send]').disabled) void action('send', $('#message').value); }
  }, options);
  $('[data-motion]').addEventListener('click', () => { motion = !motion; paint(); }, options);
  const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; scene?.invalidate(); }); observer.observe($('.world'));
  const unavailable = () => { if (disposed) return; scene?.dispose(); scene = undefined; surface.canvas.hidden = true;
    $('.fallback').hidden = false; root.dataset.engine = 'fallback'; $('[data-motion]').disabled = true; };
  import('./renderer.mjs').then(({ createPresenceRenderer }) => {
    if (disposed) return;
    scene = createPresenceRenderer({ canvas: surface.canvas, world: $('.world'), onUnavailable: unavailable,
      read: () => ({ energy: 0, rms: 0, status: online && snapshot?.status === 'running' ? 'processing' : 'available',
        speaker: null, focus: 'invoker', specialist: null, visible, motion }) });
    root.dataset.engine = 'three-webgl2'; scene.invalidate();
  }).catch(unavailable);
  paint(); if (/^[a-f0-9]{64}$/.test(token ?? '')) void client.refresh(); else { notice = 'E_SESSION'; paint(); }
  return { dispose() { disposed = true; events.abort(); observer.disconnect(); client.dispose(); scene?.dispose(); } };
}
startPageLifecycle(window, mount);
