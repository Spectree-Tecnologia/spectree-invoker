import { audioEnergy } from './audio.mjs';

export function createRealtimeConversation({ token, onState, environment = globalThis, fetcher = fetch }) {
  let session, generation = 0, context, peer, channel, stream, inputSource, outputSource, inputMeter, outputMeter, gain;
  let timer, controller, startId, remoteAudio, disposed = false, speaking = false, muted = false, phase = 'idle', error = null;
  let server = { messages: [] }, samples = new Float32Array(1024);
  const emit = () => { if (!disposed) onState({ ...server, phase, error, muted, active: !!startId, speaker: speaking ? 'invoker' : null }); };
  async function request(path, body, signal) {
    let response;
    try { response = await fetcher(`/presence/api/realtime/${path}`, { method: body ? 'POST' : 'GET', signal,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw new Error('E_REALTIME_NETWORK'); }
    const value = await response.json();
    if (!response.ok) throw new Error(/^E_[A-Z_]+$/.test(value.error ?? '') ? value.error : 'E_REALTIME_PROVIDER');
    return value;
  }
  function cleanup() {
    generation++; clearTimeout(timer); controller?.abort(); controller = undefined; speaking = false;
    stream?.getTracks().forEach(track => track.stop()); stream = undefined;
    remoteAudio?.pause(); if (remoteAudio) remoteAudio.srcObject = null; remoteAudio = undefined;
    if (peer) { peer.ontrack = peer.onconnectionstatechange = null; }
    if (channel) channel.onmessage = channel.onopen = channel.onclose = channel.onerror = null;
    channel?.close(); peer?.close(); channel = peer = undefined;
    inputSource?.disconnect(); outputSource?.disconnect(); inputMeter?.disconnect(); outputMeter?.disconnect(); gain?.disconnect();
    inputSource = outputSource = inputMeter = outputMeter = gain = undefined;
    if (context) context.onstatechange = null;
    void context?.close().catch(() => {}); context = undefined;
  }
  function stop(nextPhase, code = null) {
    const targetRequestId = startId, wasActive = !!startId || phase === 'connecting'; startId = undefined; cleanup();
    const stoppedGeneration = generation;
    phase = nextPhase ?? (wasActive ? 'ended' : 'idle'); error = code; emit();
    if (targetRequestId && session) void request('action', { action: 'stop', targetRequestId, requestId: crypto.randomUUID(), sessionId: session.sessionId }, AbortSignal.timeout(12000)).then(value => {
      if (generation === stoppedGeneration && !disposed) { server = value; emit(); }
    }).catch(() => { if (generation === stoppedGeneration && !disposed) { server = { ...server, hangup: 'unconfirmed' }; emit(); } });
  }
  async function poll(epoch) {
    if (epoch !== generation || !startId) return;
    try {
      const value = await request('snapshot', undefined, AbortSignal.timeout(5000));
      if (epoch !== generation) return;
      server = value;
      if (['ended', 'error'].includes(value.status)) { stop(value.status, value.error); return; }
      emit();
    } catch { if (epoch === generation) { stop('error', 'E_REALTIME_NETWORK'); return; } }
    if (epoch === generation) timer = setTimeout(() => void poll(epoch), 500);
  }
  return {
    sync(value) {
      if (session && session.sessionId !== value?.sessionId && startId) stop(); session = value;
      if (startId && value?.status === 'disconnected') stop();
    },
    async start({ deviceId = '' } = {}) {
      if (disposed || startId || !['ready', 'completed', 'interrupted'].includes(session?.status)) return;
      cleanup(); const epoch = generation; phase = 'connecting'; error = null; muted = false; emit();
      controller = new AbortController(); const signal = controller.signal;
      let timeout = setTimeout(() => { if (epoch === generation) stop('error', 'E_REALTIME_TIMEOUT'); }, 20000);
      try {
        let playbackReady;
        try {
          context = new environment.AudioContext();
          playbackReady = Promise.resolve(context.resume()).then(() => true, () => false);
        } catch { throw new Error('E_AUDIO_PLAYBACK'); }
        // Start both permission-sensitive operations in the button's gesture.
        // A playback rejection is distinct from a microphone permission denial.
        let obtained;
        try {
          obtained = await environment.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true,
            noiseSuppression: true, autoGainControl: true, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } });
        } catch (e) { throw new Error(e.name === 'NotAllowedError' ? 'E_MIC_PERMISSION' : 'E_MIC_UNAVAILABLE'); }
        if (epoch !== generation) { obtained.getTracks().forEach(track => track.stop()); return; }
        stream = obtained;
        if (!await playbackReady) throw new Error('E_AUDIO_PLAYBACK');
        if (epoch !== generation) return;
        peer = new environment.RTCPeerConnection(); const current = peer;
        inputMeter = context.createAnalyser(); inputMeter.fftSize = 1024;
        inputSource = context.createMediaStreamSource(stream); inputSource.connect(inputMeter);
        outputMeter = context.createAnalyser(); outputMeter.fftSize = 1024;
        // WebRTC uses the native media element for playout. The silent graph only
        // measures the same stream, without routing a second copy to the speaker.
        gain = context.createGain(); gain.gain.value = 0; outputMeter.connect(gain); gain.connect(context.destination);
        remoteAudio = new environment.Audio(); remoteAudio.autoplay = true;
        current.ontrack = event => {
          if (epoch !== generation) return;
          const received = event.streams[0] ?? new environment.MediaStream([event.track]);
          outputSource?.disconnect(); outputSource = context.createMediaStreamSource(received); outputSource.connect(outputMeter);
          remoteAudio.srcObject = received;
          void remoteAudio.play().catch(() => { if (epoch === generation) stop('error', 'E_AUDIO_PLAYBACK'); });
        };
        current.onconnectionstatechange = () => {
          if (epoch !== generation) return;
          if (['failed', 'closed', 'disconnected'].includes(current.connectionState)) stop('error', 'E_REALTIME_NETWORK');
        };
        context.onstatechange = () => { if (epoch === generation && context?.state !== 'running') stop('error', 'E_AUDIO_PLAYBACK'); };
        for (const track of stream.getAudioTracks()) {
          current.addTrack(track, stream);
          track.addEventListener('ended', () => { if (epoch === generation) stop('error', 'E_MIC_LOST'); }, { once: true });
        }
        channel = current.createDataChannel('oai-events');
        channel.onclose = channel.onerror = () => { if (epoch === generation) stop('error', 'E_REALTIME_NETWORK'); };
        channel.onmessage = event => {
          if (epoch !== generation) return;
          try {
            const value = JSON.parse(event.data);
            if (value.type === 'input_audio_buffer.speech_started') { speaking = false; remoteAudio.muted = true; phase = 'listening'; emit(); }
            else if (value.type === 'input_audio_buffer.speech_stopped') { phase = 'thinking'; emit(); }
            else if (value.type === 'output_audio_buffer.started') { speaking = true; remoteAudio.muted = false; phase = 'speaking'; emit(); }
            else if (['output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(value.type)) { speaking = false; phase = 'listening'; emit(); }
          } catch { stop('error', 'E_REALTIME_PROTOCOL'); }
        };
        const offer = await current.createOffer(); await current.setLocalDescription(offer);
        if (epoch !== generation) return;
        startId = crypto.randomUUID();
        const value = await request('action', { action: 'start', sessionId: session.sessionId, requestId: startId, sdp: offer.sdp }, signal);
        if (epoch !== generation) return;
        await current.setRemoteDescription({ type: 'answer', sdp: value.sdp });
        if (epoch !== generation) return;
        if (channel.readyState !== 'open') await new Promise((resolve, reject) => {
          channel.onopen = resolve;
          signal.addEventListener('abort', () => reject(new Error('E_AUDIO_CANCELLED')), { once: true });
        });
        if (epoch !== generation) return;
        server = { ...server, reservedUsd: value.reservedUsd }; phase = 'listening'; emit();
        clearTimeout(timeout); timeout = undefined; void poll(epoch);
      } catch (e) {
        if (epoch === generation) stop('error', /^E_[A-Z_]+$/.test(e.message) ? e.message : 'E_REALTIME_PROVIDER');
      } finally { clearTimeout(timeout); }
    },
    stop,
    toggleMute() { if (!stream) return; muted = !muted; stream.getAudioTracks().forEach(track => { track.enabled = !muted; }); emit(); },
    sample() {
      const meter = speaking ? remoteAudio?.paused || remoteAudio?.muted ? null : outputMeter : muted ? null : inputMeter;
      if (!meter || context?.state !== 'running') return { energy: 0, rms: 0 };
      meter.getFloatTimeDomainData(samples); return audioEnergy(samples);
    },
    dispose() { if (disposed) return; stop(); disposed = true; },
  };
}
