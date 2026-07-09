import { Howl, Howler } from 'howler';

// Robust audio manager using Howler.js built to withstand Telegram WebView container wrappers.
export class VoiceCallerEngine {
  private baseDir: string = '/audio/voices';
  private isInitialized: boolean = false;
  private sounds: Map<string, Howl> = new Map();
  private queue: string[] = [];
  private isPlaying: boolean = false;

  constructor() {
    // We use relative paths now, but if there's any routing issue we could use absolute paths
    const origin = window.location.origin.replace(/\/$/, "");
    this.baseDir = `${origin}/audio/voices`;
  }

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

      const tryLoad = (name: string, fallbackNames: string[] = []) => {
        const targetUrl = this.getAudioUrl(name);
        const sound = new Howl({
          src: [targetUrl],
          format: ['mp3'],
          // false = use WebAudio API (best for lots of short clips, now that files are 44.1kHz!)
          html5: false,
          preload: true,
          onload: () => {
            this.sounds.set(fileName, sound);
            this.sounds.set(name, sound);
            resolve(sound);
          },
          onloaderror: (id, err) => {
            // Clean up failed sound from the map
            this.sounds.delete(name);
            
            if (fallbackNames.length > 0) {
              const nextName = fallbackNames[0];
              const remaining = fallbackNames.slice(1);
              console.log(`ℹ️ Failed to load [${name}], trying fallback [${nextName}]...`);
              tryLoad(nextName, remaining);
            } else {
              console.warn(`⚠️ Failed to load asset [${fileName}] and all fallbacks:`, err);
              reject(err);
            }
          }
        });
        this.sounds.set(name, sound);
      };

      // Define fallbacks for specific known names to support both English and Amharic uploads
      let fallbacks: string[] = [];
      if (fileName === 'the_game_has_started') {
        fallbacks = ['ጨዋታው ተጀምሯል', 'game_start'];
      } else if (fileName === 'ጨዋታው ተጀምሯል') {
        fallbacks = ['the_game_has_started', 'game_start'];
      } else if (fileName === 'bingo') {
        fallbacks = ['ቢንጎ'];
      } else if (fileName === 'ቢንጎ') {
        fallbacks = ['bingo'];
      }

      tryLoad(fileName, fallbacks);
    });
  }

  /**
   * Safe asset preloader
   */
  public async preloadAllVoices(ballNumbers: number[]): Promise<void> {
    this.init();
    
    // Chunk the preloading so we don't spam the network
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
   * Play an event urgently (e.g. game start or bingo declared).
   * It clears the current call queue so that the announcement plays next,
   * but if a voice clip is already speaking, we allow it to finish first to prevent awkward cut-offs (no overleaping).
   */
  public playEventUrgent(fileName: string): void {
    this.init();
    this.queue = []; // Clear pending numbers
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
