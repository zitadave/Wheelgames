// Robust audio management layer built specifically for Telegram WebApps / mobile WebViews.

export class VoiceCallerEngine {
  private audioCtx: AudioContext | null = null;
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private baseDir: string;
  private isInitialized: boolean = false;

  constructor() {
    // Use an environment-aware or relative base path to prevent asset breaks inside WebViews
    const baseUrl = window.location.origin + window.location.pathname;
    this.baseDir = baseUrl.endsWith('/') ? 'audio/voices' : '/audio/voices';
  }

  public initPipeline(): void {
    // No-op for backward compatibility
  }

  /**
   * Safe initialization method to unlock the AudioContext on first user interaction.
   * This guarantees that decodeAudioData will never read properties of null.
   */
  public init(): void {
    if (this.isInitialized) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
      this.isInitialized = true;
      console.log("🔊 VoiceCallerEngine context initialized successfully.");
    } catch (e) {
      console.error("❌ Failed to initialize Web Audio API Context:", e);
    }
  }

  /**
   * Helper to resolve the completely safe path across all deployment environments.
   */
  private getAudioUrl(fileName: string, ext: 'mp3' | 'm4a'): string {
    // Strip leading slashes to prevent deployment routing breakdowns
    const sanitizedBase = this.baseDir.replace(/\/$/, "");
    return `${sanitizedBase}/${fileName}.${ext}`;
  }

  /**
   * Gracefully preload voice assets without halting runtime execution on error.
   */
  public async preloadAllVoices(ballNumbers: number[]): Promise<void> {
    this.init(); // Auto-fallback initialization guarantee
    if (!this.audioCtx) return;

    const fetchPromises = ballNumbers.map(async (num) => {
      const fileName = num.toString();
      if (this.audioBuffers.has(fileName)) return;

      try {
        const url = this.getAudioUrl(fileName, 'mp3');
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Error Status: ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        
        // Context state recovery checks
        if (this.audioCtx?.state === 'suspended') {
          await this.audioCtx.resume();
        }

        this.audioCtx?.decodeAudioData(
          arrayBuffer,
          (buffer) => this.audioBuffers.set(fileName, buffer),
          (err) => console.warn(`⚠️ Native Web Audio decode failed for asset [${fileName}]:`, err)
        );
      } catch (error) {
        console.warn(`⚠️ Preloader skipped buffering for asset [${fileName}]. Fallback layer will handle dynamic playback.`);
      }
    });

    await Promise.allSettled(fetchPromises);
  }

  /**
   * Executes voice clip playback utilizing a dual-layer approach.
   * Layer 1: High-performance Web Audio API buffer scheduling.
   * Layer 2: Graceful HTML5 Native Element stream fallback.
   */
  public async playBallNumber(num: number): Promise<void> {
    this.init(); // Double-ensure instantiation stability
    const fileName = num.toString();

    // Auto-resume if client context lifecycle became suspended
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch (e) {
        console.warn("Could not resume audio context, defaulting forward.", e);
      }
    }

    // Try Layer 1: Buffered Audio Execution
    if (this.audioCtx && this.audioBuffers.has(fileName)) {
      try {
        const source = this.audioCtx.createBufferSource();
        source.buffer = this.audioBuffers.get(fileName) || null;
        source.connect(this.audioCtx.destination);
        source.start(0);
        return;
      } catch (webAudioError) {
        console.error("❌ Layer 1 buffer runtime failure. Redirecting execution to Layer 2 fallback.", webAudioError);
      }
    }

    // Try Layer 2: Native HTML5 Fallback Engine 
    await this.playViaAudioElementFallback(fileName);
  }

  /**
   * Native HTML5 Audio streams with multi-format extension traversal loops.
   */
  private playViaAudioElementFallback(fileName: string): Promise<void> {
    return new Promise((resolve) => {
      const extensions: ('mp3' | 'm4a')[] = ['mp3', 'm4a'];
      let currentExtensionIndex = 0;

      const attemptPlayback = () => {
        if (currentExtensionIndex >= extensions.length) {
          console.error(`❌ Critical Audio failure: All resource source pathways exhausted for asset [${fileName}].`);
          resolve();
          return;
        }

        const currentExt = extensions[currentExtensionIndex];
        const targetUrl = this.getAudioUrl(fileName, currentExt);
        const audioNode = new Audio(targetUrl);

        audioNode.play()
          .then(() => {
            resolve();
          })
          .catch((playbackError) => {
            console.warn(`⚠️ Fallback source format [.${currentExt}] rejected for asset [${fileName}]. Trying next extension option.`);
            currentExtensionIndex++;
            attemptPlayback(); // Recursive extension lookup loop
          });
      };

      attemptPlayback();
    });
  }
}

// Global engine instanced context export for backward compatibility
export const globalVoiceEngine = new VoiceCallerEngine();
(window as any).voiceEngine = globalVoiceEngine;
