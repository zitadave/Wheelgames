import { Howl, Howler } from 'howler';

// Robust audio manager using Howler.js built to withstand Telegram WebView container wrappers.
export class VoiceCallerEngine {
  private baseDir: string = '/audio/voices';
  private isInitialized: boolean = false;
  private sounds: Map<string, Howl> = new Map();
  private queue: string[] = [];
  private isPlaying: boolean = false;

  constructor() {}

  public initPipeline(): void {
    this.init();
  }

  /**
   * Initializes or resumes Howler on human interaction safely.
   */
  public init(): void {
    if (this.isInitialized) {
      if (Howler.ctx && Howler.ctx.state === 'suspended') {
        Howler.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      if (Howler.ctx && Howler.ctx.state === 'suspended') {
        Howler.ctx.resume().catch(() => {});
      }

      // Create a dummy silent Howl and play it to unlock audio in iOS
      const dummy = new Howl({
        src: ['data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAgDhoIAAAAAB//OEAAAAAAAAB////wAAAAD/84QAAAAAAAAAAAAAAD//OEAAAAA=='],
        format: ['mp3'],
        volume: 0
      });
      dummy.play();

      this.isInitialized = true;
      console.log("🔊 VoiceCallerEngine context initialized successfully with Howler.");
    } catch (e) {
      console.error("❌ Failed to initialize Howler Context:", e);
    }
  }

  /**
   * Builds a guaranteed clean, fully qualified absolute URL.
   */
  private getAudioUrl(fileName: string): string {
    return `${this.baseDir}/${fileName}.mp3`;
  }

  private loadSound(fileName: string): Promise<Howl> {
    return new Promise((resolve, reject) => {
      if (this.sounds.has(fileName)) {
        return resolve(this.sounds.get(fileName)!);
      }

      const targetUrl = this.getAudioUrl(fileName);
      const sound = new Howl({
        src: [targetUrl],
        format: ['mp3'],
        html5: false, // Use WebAudio for bingo calls (much better for lots of small sounds)
        preload: true,
        onload: () => {
          this.sounds.set(fileName, sound);
          resolve(sound);
        },
        onloaderror: (id, err) => {
          console.warn(`⚠️ Failed to load asset [${fileName}]:`, err);
          reject(err);
        }
      });
      // We also store it immediately so we don't fetch twice
      this.sounds.set(fileName, sound);
    });
  }

  /**
   * Safe asset preloader
   */
  public async preloadAllVoices(ballNumbers: number[]): Promise<void> {
    this.init();
    
    // Chunk the preloading so we don't spam the network or WebAudio decoder
    const chunkSize = 5;
    for (let i = 0; i < ballNumbers.length; i += chunkSize) {
      const chunk = ballNumbers.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(num => {
          const fileName = num.toString();
          if (!this.sounds.has(fileName)) {
            return this.loadSound(fileName).catch(() => {});
          }
          return Promise.resolve();
        })
      );
    }
  }

  public playEvent(fileName: string): void {
    this.init();
    this.queue.push(fileName);
    this.processQueue();
  }

  /**
   * Main playback router
   */
  public playBallNumber(num: number): void {
    this.init();
    const fileName = num.toString();
    this.queue.push(fileName);
    this.processQueue();
  }

  private async processQueue() {
    if (this.isPlaying || this.queue.length === 0) return;
    this.isPlaying = true;

    const fileName = this.queue.shift();
    if (!fileName) {
      this.isPlaying = false;
      return;
    }

    try {
      const sound = await this.loadSound(fileName);
      
      // If we are suspended, try to resume
      if (Howler.ctx && Howler.ctx.state === 'suspended') {
        await Howler.ctx.resume().catch(() => {});
      }

      sound.play();
      sound.once('end', () => {
        this.isPlaying = false;
        this.processQueue();
      });
      sound.once('playerror', (id, err) => {
        console.warn(`⚠️ Play error for asset [${fileName}]:`, err);
        // Sometimes audio needs a manual unlock
        sound.once('unlock', function() {
          sound.play();
        });
        
        this.isPlaying = false;
        this.processQueue();
      });
    } catch (e) {
      this.isPlaying = false;
      this.processQueue();
    }
  }
}

export const globalVoiceEngine = new VoiceCallerEngine();
(window as any).voiceEngine = globalVoiceEngine;
