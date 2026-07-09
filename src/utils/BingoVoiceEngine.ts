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
   * Builds a guaranteed clean URL.
   */
  private getAudioUrl(fileName: string, absolute: boolean = false): string {
    const base = absolute 
      ? `${window.location.origin.replace(/\/$/, "")}/audio/voices`
      : '/audio/voices';
    return `${base}/${encodeURIComponent(fileName)}.mp3`;
  }

  private loadSound(fileName: string): Promise<Howl> {
    if (this.sounds.has(fileName)) {
      return Promise.resolve(this.sounds.get(fileName)!);
    }

    return new Promise((resolve, reject) => {
      // Define all possible filenames for this sound (including fallbacks)
      let namesToTry: string[] = [fileName];
      if (fileName === 'the_game_has_started') {
        namesToTry = ['ጨዋታው ተጀምሯል ', 'ጨዋታው ተጀምሯል', 'the_game_has_started', 'game_start'];
      } else if (fileName === 'ጨዋታው ተጀምሯል' || fileName === 'ጨዋታው ተጀምሯል ') {
        namesToTry = ['ጨዋታው ተጀምሯል ', 'ጨዋታው ተጀምሯል', 'the_game_has_started', 'game_start'];
      } else if (fileName === 'bingo') {
        namesToTry = ['ቢንጎ', 'bingo'];
      } else if (fileName === 'ቢንጎ') {
        namesToTry = ['ቢንጎ', 'bingo'];
      }

      const tryNextName = (nameIndex: number) => {
        if (nameIndex >= namesToTry.length) {
          console.warn(`⚠️ Failed to load asset [${fileName}] and all name fallbacks.`);
          return reject(new Error(`Failed to load ${fileName}`));
        }

        const name = namesToTry[nameIndex];

        // 3 different robust strategies to try for this specific filename
        const strategies = [
          { absolute: false, html5: false, desc: "Relative WebAudio" },
          { absolute: false, html5: true, desc: "Relative HTML5 Audio" },
          { absolute: true, html5: true, desc: "Absolute HTML5 Audio" }
        ];

        const tryStrategy = (stratIndex: number) => {
          if (stratIndex >= strategies.length) {
            console.log(`ℹ️ All loading strategies failed for name [${name}]. Trying next name fallback...`);
            tryNextName(nameIndex + 1);
            return;
          }

          const strat = strategies[stratIndex];
          const targetUrl = this.getAudioUrl(name, strat.absolute);

          console.log(`🎵 Trying to load voice [${name}] via ${strat.desc}: ${targetUrl}`);

          const sound = new Howl({
            src: [targetUrl],
            format: ['mp3'],
            html5: strat.html5,
            preload: true,
            onload: () => {
              console.log(`✅ Successfully loaded [${name}] using ${strat.desc}`);
              // Cache the loaded sound under original requested fileName and working name
              this.sounds.set(fileName, sound);
              this.sounds.set(name, sound);
              resolve(sound);
            },
            onloaderror: (id, err) => {
              console.warn(`❌ Load failed with strategy ${strat.desc} for [${name}]:`, err);
              tryStrategy(stratIndex + 1);
            }
          });
        };

        tryStrategy(0);
      };

      tryNextName(0);
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

    try {
      const sound = await this.loadSound(fileName);
      this.currentSound = sound;
      
      // If we are suspended, try to resume
      if (Howler.ctx && Howler.ctx.state === 'suspended') {
        await Howler.ctx.resume().catch(() => {});
      }

      sound.play();
      sound.once('end', () => {
        this.currentSound = null;
        this.isPlaying = false;
        this.processQueue();
      });
      sound.once('playerror', (id, err) => {
        console.warn(`⚠️ Play error for asset [${fileName}]:`, err);
        // Sometimes audio needs a manual unlock
        sound.once('unlock', () => {
          sound.play();
        });
        
        this.currentSound = null;
        this.isPlaying = false;
        this.processQueue();
      });
    } catch (e) {
      this.currentSound = null;
      this.isPlaying = false;
      this.processQueue();
    }
  }
}

export const globalVoiceEngine = new VoiceCallerEngine();
(window as any).voiceEngine = globalVoiceEngine;
