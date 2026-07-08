class BingoVideoAudioEngine {
  audioCtx: AudioContext | null;
  audioCache: Record<number, AudioBuffer | HTMLAudioElement>;
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
  async playBallNumber(number: number) {
    const audioUrl = `/audio/voices/${number}.mp3`;
    try {
      if (this.audioCtx && this.audioCtx.state === 'suspended') await this.audioCtx.resume();
      if (this.audioCache[number] instanceof AudioBuffer) {
        const source = this.audioCtx.createBufferSource();
        source.buffer = this.audioCache[number];
        source.connect(this.audioCtx.destination);
        source.start(0);
        return;
      }
      if (this.audioCache[number] instanceof Audio) {
        this.audioCache[number].currentTime = 0;
        this.audioCache[number].play().catch(e => console.error(e));
        return;
      }
      const response = await fetch(audioUrl);
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        console.error(`❌ CRITICAL: Fetching "${audioUrl}" returned an HTML webpage instead of an MP3 audio file! Paths or public routing are incorrect.`);
        this.playViaAudioElementFallback(number, audioUrl);
        return;
      }
      const arrayBuffer = await response.arrayBuffer();
      try {
        const decodedBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
        this.audioCache[number] = decodedBuffer;
        const source = this.audioCtx.createBufferSource();
        source.buffer = decodedBuffer;
        source.connect(this.audioCtx.destination);
        source.start(0);
      } catch (decodeError) {
        console.warn(`⚠️ decodeAudioData failed for ${number}. Falling back to native HTML5 Audio element.`, decodeError);
        this.playViaAudioElementFallback(number, audioUrl);
      }
    } catch (error) {
      console.error(error);
      this.playViaAudioElementFallback(number, audioUrl);
    }
  }
  playViaAudioElementFallback(number: number, url: string) {
    try {
      const audio = new Audio(url);
      this.audioCache[number] = audio;
      audio.play().catch(err => {
        console.warn(`Primary audio playback failed for ${url}, trying alternative extension.`, err);
        const altUrl = url.endsWith('.mp3') ? url.replace('.mp3', '.m4a') : url.replace('.m4a', '.mp3');
        const audioAlt = new Audio(altUrl);
        this.audioCache[number] = audioAlt;
        audioAlt.play().catch(errAlt => console.error(`Fallback playback also failed for ${altUrl}`, errAlt));
      });
    } catch (e) { console.error(e); }
  }
}
(window as any).voiceEngine = new BingoVideoAudioEngine();
