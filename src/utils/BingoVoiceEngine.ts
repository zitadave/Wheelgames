// Absolute-path optimized audio manager built to withstand Telegram WebView container wrappers.
export class VoiceCallerEngine {
  private audioCtx: AudioContext | null = null;
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private baseDir: string;
  private isInitialized: boolean = false;
  private fallbackAudio: HTMLAudioElement | null = null;

  constructor() {
    // FORCE absolute domain paths to fully escape Telegram's internal sandbox route resolution
    const origin = window.location.origin.replace(/\/$/, "");
    this.baseDir = `${origin}/audio/voices`;
  }

  public initPipeline(): void {
    this.init();
  }

  /**
   * Initializes or resumes the AudioContext on human interaction safely.
   */
  public init(): void {
    if (this.isInitialized) {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      if (this.fallbackAudio) {
        this.fallbackAudio.play().catch(()=>{}).finally(()=> this.fallbackAudio?.pause());
      }
      return;
    }

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
        
        // Play silent heartbeat to properly unlock iOS / Telegram WebAudio
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(0);
        osc.stop(this.audioCtx.currentTime + 0.1);
      }
      
      this.fallbackAudio = new Audio();
      this.fallbackAudio.play().catch(()=>{}).finally(()=> this.fallbackAudio?.pause());

      this.isInitialized = true;
      console.log("🔊 VoiceCallerEngine context initialized successfully using absolute routing base.");
    } catch (e) {
      console.error("❌ Failed to initialize Web Audio API Context:", e);
    }
  }

  /**
   * Builds a guaranteed clean, fully qualified absolute URL.
   */
  private getAudioUrl(fileName: string): string {
    return `${this.baseDir}/${fileName}.mp3`;
  }

  /**
   * Safe asset preloader
   */
  public async preloadAllVoices(ballNumbers: number[]): Promise<void> {
    this.init();
    if (!this.audioCtx) return;

    const fetchPromises = ballNumbers.map(async (num) => {
      await this.fetchAndDecode(num.toString());
    });

    await Promise.allSettled(fetchPromises);
  }

  private async fetchAndDecode(fileName: string): Promise<boolean> {
    if (this.audioBuffers.has(fileName)) return true;
    if (!this.audioCtx) return false;

    try {
      const url = this.getAudioUrl(fileName);
      const response = await fetch(url);
      if (!response.ok) return false;
      
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) return false;

      const arrayBuffer = await response.arrayBuffer();
      
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume().catch(() => {});
      }

      return new Promise((resolve) => {
        this.audioCtx!.decodeAudioData(
          arrayBuffer,
          (buffer) => {
            this.audioBuffers.set(fileName, buffer);
            resolve(true);
          },
          () => resolve(false)
        );
      });
    } catch (e) {
      return false;
    }
  }

  public async playEvent(fileName: string): Promise<void> {
    this.init();
    
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch (e) {}
    }

    if (this.audioCtx) {
      const isReady = await this.fetchAndDecode(fileName);
      if (isReady && this.audioBuffers.has(fileName)) {
        try {
          const source = this.audioCtx.createBufferSource();
          source.buffer = this.audioBuffers.get(fileName) || null;
          source.connect(this.audioCtx.destination);
          source.start(0);
          return;
        } catch (webAudioError) {
          console.warn(`⚠️ Buffer execution failed for event [${fileName}]`);
        }
      }
    }

    // Direct streaming execution fallback
    await this.playViaAudioElementFallback(fileName);
  }

  /**
   * Main playback router
   */
  public async playBallNumber(num: number): Promise<void> {
    this.init();
    const fileName = num.toString();

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch (e) {}
    }

    if (this.audioCtx) {
      const isReady = await this.fetchAndDecode(fileName);
      if (isReady && this.audioBuffers.has(fileName)) {
        try {
          const source = this.audioCtx.createBufferSource();
          source.buffer = this.audioBuffers.get(fileName) || null;
          source.connect(this.audioCtx.destination);
          source.start(0);
          return;
        } catch (webAudioError) {
          console.warn(`⚠️ Buffer execution failed for asset [${fileName}], shifting to absolute streaming fallback.`);
        }
      }
    }

    // Direct streaming execution fallback
    await this.playViaAudioElementFallback(fileName);
  }

  /**
   * High-resilience HTML5 native playback loop using hard absolute domains.
   */
  private playViaAudioElementFallback(fileName: string): Promise<void> {
    return new Promise((resolve) => {
      const targetUrl = this.getAudioUrl(fileName);
      if (!this.fallbackAudio) {
        this.fallbackAudio = new Audio();
      }
      this.fallbackAudio.src = targetUrl;
      this.fallbackAudio.play()
        .then(() => {
          resolve();
        })
        .catch((e) => {
          console.warn(`⚠️ Fallback source rejected for asset [${fileName}]. Path tried: ${targetUrl}`, e);
          resolve();
        });
    });
  }
}

export const globalVoiceEngine = new VoiceCallerEngine();
(window as any).voiceEngine = globalVoiceEngine;
