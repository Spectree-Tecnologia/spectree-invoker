// UI state is a projection. It never grants runtime authority or executes commands.
export const AGENTS = Object.freeze({
  invoker: Object.freeze({ name: 'Invoker', color: 0xffffff, label: 'Branco' }),
  architect: Object.freeze({ name: 'Architect', color: 0x2470ff, label: 'Azul · arquitetura' }),
  developer: Object.freeze({ name: 'Developer', color: 0xff253a, label: 'Vermelho · implementação' }),
  quality: Object.freeze({ name: 'Quality', color: 0xffc600, label: 'Amarelo · qualidade' }),
});
const types = new Set(['ready', 'listen', 'think', 'speak', 'end', 'delegate', 'pause', 'cancel', 'error', 'reset']);
function refuse(code) { throw Object.assign(new Error(code), { code }); }
export function createSession(sessionId, origin = 'demo') {
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(sessionId) || !['demo', 'session'].includes(origin)) refuse('E_SESSION');
  return Object.freeze({ version: 1, sessionId, origin, sequence: 0, status: 'available',
    participants: Object.freeze(['invoker']), focus: 'invoker', speaker: null, sync: 'ready', reason: '' });
}
export function applyEvent(state, event) {
  if (!event || event.version !== 1 || !types.has(event.type) ||
      !Object.hasOwn(AGENTS, event.participantId) || !Number.isSafeInteger(event.sequence) || event.sequence < 1) refuse('E_EVENT');
  if (event.sessionId !== state.sessionId || event.origin !== state.origin) refuse('E_SESSION');
  if (event.sequence <= state.sequence) refuse('E_SEQUENCE');
  if (state.sync !== 'ready') refuse('E_RESYNC_REQUIRED');
  if (event.sequence !== state.sequence + 1) return Object.freeze({ ...state, sync: 'required',
    status: 'interrupted', speaker: null, reason: 'Sequência incompleta. Reinicie a demonstração.' });
  if (event.reason !== undefined && (typeof event.reason !== 'string' || event.reason.length > 240)) refuse('E_EVENT');
  if (!state.participants.includes(event.participantId)) refuse('E_PARTICIPANT');
  const next = { ...state, sequence: event.sequence, focus: event.participantId, reason: '', speaker: null };
  if (['interrupted', 'error'].includes(state.status) && !['ready', 'reset', 'cancel', 'error'].includes(event.type)) refuse('E_TRANSITION');
  switch (event.type) {
    case 'reset': return Object.freeze({ ...createSession(state.sessionId, state.origin), sequence: event.sequence });
    case 'ready': next.status = 'available'; break;
    case 'listen': next.status = 'listening'; break;
    case 'think': next.status = 'processing'; break;
    case 'delegate':
      if (event.participantId !== 'invoker' || !Object.hasOwn(AGENTS, event.targetId) || event.targetId === 'invoker') refuse('E_PARTICIPANT');
      next.status = 'delegating'; next.participants = Object.freeze([...new Set([...state.participants, event.targetId])]); break;
    case 'speak':
      if (state.speaker && state.speaker !== event.participantId) refuse('E_SPEAKER');
      next.status = 'speaking'; next.speaker = event.participantId; break;
    case 'end':
      if (state.speaker !== event.participantId) refuse('E_SPEAKER');
      next.status = 'available'; break;
    case 'pause': next.status = 'available'; next.reason = event.reason ?? 'Reprodução pausada.'; break;
    case 'cancel': next.status = 'interrupted'; next.reason = event.reason ?? 'Demonstração interrompida.'; break;
    case 'error': next.status = 'error'; next.reason = event.reason ?? 'Áudio indisponível. Consulte a transcrição.'; break;
  }
  return Object.freeze(next);
}
