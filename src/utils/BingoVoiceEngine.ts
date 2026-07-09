// Absolute-path optimized audio manager built to withstand Telegram WebView container wrappers.

export class VoiceCallerEngine {
  private audioCtx: AudioContext | null = null;
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private baseDir: string;
  private isInitialized: boolean = false;

  constructor() {
    // FORCE absolute domain paths to fully escape Telegram's internal sandbox route resolution
    const origin = window.location.origin.replace(/\/$/, "");
    this.baseDir = `${origin}/audio/voices`;
  }

  public initPipeline(): void {
    // No-op for backward compatibility
  }

  /**
   * Initializes or resumes the AudioContext on human interaction safely.
   */
  public init(): void {
    if (this.isInitialized) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
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
      const fileName = num.toString();
      if (this.audioBuffers.has(fileName)) return;

      try {
        const url = this.getAudioUrl(fileName);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        // Prevent decoding if the server handed back an SPA HTML fallback file
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) return;

        const arrayBuffer = await response.arrayBuffer();
        
        if (this.audioCtx?.state === 'suspended') {
          await this.audioCtx.resume();
        }

        this.audioCtx?.decodeAudioData(
          arrayBuffer,
          (buffer) => this.audioBuffers.set(fileName, buffer),
          () => {} // Silent catch for preloader; fallback handles playback crashes
        );
      } catch (error) {
        // Quiet fallback; handled on-demand during live wheel spins
      }
    });

    await Promise.allSettled(fetchPromises);
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

    // Attempt Web Audio Buffer scheduling
    if (this.audioCtx && this.audioBuffers.has(fileName)) {
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

    // Direct streaming execution fallback
    await this.playViaAudioElementFallback(fileName);
  }

  /**
   * High-resilience HTML5 native playback loop using hard absolute domains.
   */
  private playViaAudioElementFallback(fileName: string): Promise<void> {
    return new Promise((resolve) => {
      const targetUrl = this.getAudioUrl(fileName);
      const audioNode = new Audio(targetUrl);

      audioNode.preload = 'auto';

      audioNode.play()
        .then(() => {
          resolve();
        })
        .catch(() => {
          console.warn(`⚠️ Fallback source rejected for asset [${fileName}]. Path tried: ${targetUrl}`);
          resolve();
        });
    });
  }
}

export const globalVoiceEngine = new VoiceCallerEngine();
(window as any).voiceEngine = globalVoiceEngine;
