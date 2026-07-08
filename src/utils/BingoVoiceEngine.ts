class BingoVideoAudioEngine {
  audioCtx: AudioContext | null;
  audioCache: Record<number, AudioBuffer>;
  videoKey: HTMLVideoElement | null;

  constructor() {
    this.audioCtx = null;
    this.audioCache = {};
    this.videoKey = null;
  }
  initPipeline() {
    if (this.audioCtx) return;
    try {
      this.videoKey = document.createElement('video');
      this.videoKey.setAttribute('playsinline', '');
      this.videoKey.setAttribute('loop', '');
      this.videoKey.style.display = 'none';
      this.videoKey.style.width = '1px';
      this.videoKey.style.height = '1px';
      this.videoKey.src = "data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAADFtb292AAAAbG12aGQAAAAA3gBOgN4AToAAAPAAAAKAAAABAAEA/wD/AP8AAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAMAAAI0dHJhawAAXHRkaGQAAAAA3gBOgN4AToAAAAEAAAAAAAAKAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAMAAAQBtZGlhAAAAJG1kaGQAAAAA3gBOgN4AToAAVcQAAAAAAAEgAAABRxuYmhkAAAAAAAAMWhkbHIAAAAAAAAAAHZpZGVAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABbW1pbmYAAAAReference";
      document.body.appendChild(this.videoKey);
      this.videoKey.muted = false;
      this.videoKey.play().then(() => {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      }).catch(err => console.error(err));
    } catch (e) { console.error(e); }
  }

  async preloadAllVoices(totalBalls = 75) {
    if (!this.audioCtx) {
       this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    for (let i = 1; i <= totalBalls; i++) {
      try {
        const response = await fetch(`/audio/voices/${i}.mp3`);
        if (!response.ok) continue;
        const arrayBuffer = await response.arrayBuffer();
        this.audioCache[i] = await this.audioCtx.decodeAudioData(arrayBuffer);
      } catch (e) { console.warn(e); }
    }
  }

  async playBallNumber(number: number) {
    if (!this.audioCtx) return;
    try {
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
      let audioBuffer = this.audioCache[number];
      if (!audioBuffer) {
        const response = await fetch(`/audio/voices/${number}.mp3`);
        const arrayBuffer = await response.arrayBuffer();
        audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
        this.audioCache[number] = audioBuffer;
      }
      const source = this.audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioCtx.destination);
      source.start(0);
    } catch (error) { console.error(error); }
  }
}
(window as any).voiceEngine = new BingoVideoAudioEngine();
