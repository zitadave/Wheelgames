import { Howl, Howler } from 'howler';

// Robust audio manager using Howler.js built to withstand Telegram WebView container wrappers.
export class VoiceCallerEngine {
  private baseDir: string = '/audio/voices';
  private isInitialized: boolean = false;
  private sounds: Map<string, Howl> = new Map();
  private queue: string[] = [];
  private isPlaying: boolean = false;

  private currentSound: Howl | null = null;

  constructor() {
    this.baseDir = '/audio/voices';
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
    return encodeURI(`${this.baseDir}/${fileName}.mp3`);
  }

  private loadSound(fileName: string): Promise<Howl> {
    if (this.sounds.has(fileName)) {
      return Promise.resolve(this.sounds.get(fileName)!);
    }

    return new Promise((resolve, reject) => {
      let resolved = false;

      // Deep safety load timeout: if loading takes more than 3 seconds, reject to keep the caller active
      const loadTimeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn(`⏳ Audio load timeout reached for [${fileName}]. Rejecting promise to unblock caller queue.`);
          reject(new Error(`Load timeout for ${fileName}`));
        }
      }, 3000);

      const safeResolve = (sound: Howl) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(loadTimeoutId);
          resolve(sound);
        }
      };

      const safeReject = (err: Error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(loadTimeoutId);
          reject(err);
        }
      };

      // Define all possible filenames for this sound (including fallbacks)
      let namesToTry: string[] = [fileName];
      if (fileName === 'the_game_has_started' || fileName === 'ጨዋታው ተጀምሯል' || fileName === 'ጨዋታው ተጀምሯል ') {
        namesToTry = ['ጨዋታው ተጀምሯል ', 'ጨዋታው ተጀምሯል', 'the_game_has_started', 'game_start'];
      } else if (fileName === 'bingo' || fileName === 'ቢንጎ') {
        namesToTry = ['ቢንጎ', 'bingo'];
      }

      const tryNext = (index: number) => {
        if (index >= namesToTry.length) {
          console.warn(`⚠️ Failed to load asset [${fileName}] and all fallbacks.`);
          return safeReject(new Error(`Failed to load ${fileName}`));
        }

        const name = namesToTry[index];
        const targetUrl = this.getAudioUrl(name);

        // Web Audio API (html5: false) is extremely high-performance and reliable for game sound segments
        // because it downloads the full asset over XHR/fetch, triggering 'onload' reliably even
        // when the browser's autoplay policies have suspended the AudioContext.
        const sound = new Howl({
          src: [targetUrl],
          format: ['mp3'],
          html5: false,
          preload: true,
          onload: () => {
            this.sounds.set(fileName, sound);
            this.sounds.set(name, sound);
            safeResolve(sound);
          },
          onloaderror: (id, err) => {
            console.log(`ℹ️ Failed to load [${name}] via Web Audio, trying HTML5 Audio fallback...`);
            
            // Fallback to HTML5 Audio element
            const fallbackSound = new Howl({
              src: [targetUrl],
              format: ['mp3'],
              html5: true,
              preload: true,
              onload: () => {
                this.sounds.set(fileName, fallbackSound);
                this.sounds.set(name, fallbackSound);
                safeResolve(fallbackSound);
              },
              onloaderror: (id2, err2) => {
                console.log(`ℹ️ Failed to load [${name}] via HTML5 Audio too, trying next file fallback...`);
                tryNext(index + 1);
              }
            });
          }
        });
      };

      tryNext(0);
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
   * Play an event with high priority (prepended to the queue).
   * This ensures it is played as soon as possible without losing/clearing
   * called ball numbers, guaranteeing no overlapping of voice clips.
   */
  public playEventUrgent(fileName: string): void {
    this.init();
    // Insert at the front of the queue so it is played next
    this.queue.unshift(fileName);
    this.processQueue();
  }

  /**
   * Play the bingo winner announcement.
   * Since the game is over, we clear the queue so no more numbers are called.
   * If a number is currently playing, we stop it immediately so that BINGO is announced instantly with no overlap.
   */
  public playBingoEvent(fileName: string): void {
    this.init();
    this.queue = []; // Clear pending numbers

    if (this.currentSound) {
      try {
        this.currentSound.stop();
      } catch (e) {}
      this.currentSound = null;
      this.isPlaying = false;
    }

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

    let playTimeout: NodeJS.Timeout | null = null;

    try {
      const sound = await this.loadSound(fileName);
      this.currentSound = sound;
      
      // If we are suspended, try to resume
      if (Howler.ctx && Howler.ctx.state === 'suspended') {
        await Howler.ctx.resume().catch(() => {});
      }

      // Deeply defensive: Set a safety timeout to ensure the playback queue never gets permanently locked 
      // if the browser or platform silently blocks the audio without firing 'playerror' or 'end'.
      playTimeout = setTimeout(() => {
        console.warn(`⏳ Playback safety timeout reached for [${fileName}]. Releasing lock to keep caller active.`);
        this.currentSound = null;
        this.isPlaying = false;
        this.processQueue();
      }, 4000);

      sound.play();
      
      sound.once('end', () => {
        if (playTimeout) clearTimeout(playTimeout);
        this.currentSound = null;
        this.isPlaying = false;
        this.processQueue();
      });

      sound.once('playerror', (id, err) => {
        if (playTimeout) clearTimeout(playTimeout);
        console.warn(`⚠️ Play error for asset [${fileName}]:`, err);
        
        this.currentSound = null;
        this.isPlaying = false;
        this.processQueue();
      });
    } catch (e) {
      if (playTimeout) clearTimeout(playTimeout);
      this.currentSound = null;
      this.isPlaying = false;
      this.processQueue();
    }
  }
}

export const globalVoiceEngine = new VoiceCallerEngine();
(window as any).voiceEngine = globalVoiceEngine;

// Proactive user-gesture listener to unlock audio contexts as soon as the user touches/clicks anywhere
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    globalVoiceEngine.init();
    if (Howler.ctx && Howler.ctx.state === 'suspended') {
      Howler.ctx.resume().catch(() => {});
    }
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
  };
  window.addEventListener('click', unlockAudio);
  window.addEventListener('touchstart', unlockAudio);
}
