class BingoVoiceEngine {
  constructor() {
    this.audioCtx = null;
    this.audioCache = {};
    this.isPreloaded = false;
  }
  async preloadAllVoices(totalBalls = 75) {
    if (this.isPreloaded) return;
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 1; i <= totalBalls; i++) {
      try {
        const response = await fetch(`/audio/voices/${i}.mp3`);
        if (!response.ok) continue;
        const arrayBuffer = await response.arrayBuffer();
        this.audioCache[i] = await this.audioCtx.decodeAudioData(arrayBuffer);
      } catch (e) { console.warn(e); }
    }
    this.isPreloaded = true;
  }
  initPipeline() {
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
  }
  playBallNumber(number) {
    if (!this.audioCtx || !this.audioCache[number]) return;
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
    const source = this.audioCtx.createBufferSource();
    source.buffer = this.audioCache[number];
    source.connect(this.audioCtx.destination);
    source.start(0);
  }
}
window.voiceEngine = new BingoVoiceEngine();
