// No microphone data leaves the page from this worklet. The output is silence.
class PresenceCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(4096); this.used = 0; this.total = 0; }
  flush() { if (this.used) { const data = this.buffer.slice(0, this.used); this.port.postMessage({ samples: data }, [data.buffer]); this.used = 0; } }
  process(inputs) {
    const channel = inputs[0]?.[0]; if (!channel) return true;
    for (const value of channel) {
      if (this.total >= sampleRate * 45) { this.flush(); this.port.postMessage({ complete: true }); return false; }
      this.buffer[this.used++] = value; this.total++;
      if (this.used === this.buffer.length) this.flush();
    }
    // Flush each render quantum so stopping never drops an unflushed tail.
    this.flush(); return true;
  }
}
registerProcessor('presence-capture', PresenceCapture);
