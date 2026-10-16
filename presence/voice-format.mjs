// Fixed wire formats bound capture, billing inputs and browser allocation.
export const MAX_SECONDS = 45;
export const CAPTURE_RATE = 16000;
export const SPEECH_RATE = 24000;
export const MAX_WAV_BYTES = 44 + CAPTURE_RATE * MAX_SECONDS * 2;
export function encodeWav(samples, sampleRate) {
  if (!Number.isFinite(sampleRate) || sampleRate < 16000 || sampleRate > 192000 ||
    samples.length > sampleRate * MAX_SECONDS) throw new Error('E_AUDIO_LIMIT');
  const count = Math.floor(samples.length * CAPTURE_RATE / sampleRate);
  const bytes = new Uint8Array(44 + count * 2), view = new DataView(bytes.buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, CAPTURE_RATE, true);
  view.setUint32(28, CAPTURE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const from = Math.floor(i * sampleRate / CAPTURE_RATE), to = Math.floor((i + 1) * sampleRate / CAPTURE_RATE);
    let sum = 0; for (let j = from; j < to; j++) sum += Number.isFinite(samples[j]) ? samples[j] : 0;
    const value = Math.max(-1, Math.min(1, sum / (to - from)));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
export function wavDuration(bytes) {
  if (bytes.length < 44 || bytes.length > MAX_WAV_BYTES || bytes.length % 2) throw new Error('E_AUDIO_FORMAT');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (o, n) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE' || text(12, 4) !== 'fmt ' || text(36, 4) !== 'data' ||
    v.getUint32(4, true) !== bytes.length - 8 || v.getUint32(16, true) !== 16 || v.getUint16(20, true) !== 1 ||
    v.getUint16(22, true) !== 1 || v.getUint32(24, true) !== CAPTURE_RATE || v.getUint32(28, true) !== CAPTURE_RATE * 2 ||
    v.getUint16(32, true) !== 2 || v.getUint16(34, true) !== 16 || v.getUint32(40, true) !== bytes.length - 44 ||
    bytes.length < 44 + CAPTURE_RATE) throw new Error('E_AUDIO_FORMAT');
  return (bytes.length - 44) / (CAPTURE_RATE * 2);
}
export function speechParts(text) {
  const parts = []; let remaining = text.trim();
  while (remaining) {
    let end = Math.min(1200, remaining.length);
    if (end < remaining.length) {
      const space = remaining.lastIndexOf(' ', end); if (space > 600) end = space;
      if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
    }
    parts.push(remaining.slice(0, end)); remaining = remaining.slice(end).trimStart();
  }
  return parts;
}
