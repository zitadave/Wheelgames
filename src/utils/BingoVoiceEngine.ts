class VoiceCallerEngine {
    audioContext: AudioContext | null;

    constructor() {
        this.audioContext = null;
        this.initAudioContext();
    }

    initAudioContext() {
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContextClass) {
                this.audioContext = new AudioContextClass();
            }
        } catch (e) {
            console.error("⚠️ AudioContext initialization failed entirely:", e);
        }
    }

    initPipeline() {
        // No-op to maintain backward compatibility with previous engine interface
    }

    /**
     * Resolves asset paths relative to the current subdirectory path.
     * Prevents root domain 404 pages inside nested Telegram WebView environments.
     */
    getResolvedPath(relativeAudioPath: string) {
        const href = window.location.href;
        const url = new URL(href);
        let pathname = url.pathname;
        
        if (!pathname.endsWith('/')) {
            const segments = pathname.split('/');
            segments.pop(); // Removes filename endpoints (e.g., 'index.html')
            pathname = segments.join('/') + '/';
        }
        
        // Strip any leading slashes to prevent root-domain absolute leaping
        const cleanPath = relativeAudioPath.startsWith('/') ? relativeAudioPath.slice(1) : relativeAudioPath;
        return `${url.origin}${pathname}${cleanPath}`;
    }

    async playBallNumber(number: number) {
        // Resolve context-aware structural URLs dynamically
        const primaryPath = this.getResolvedPath(`audio/voices/${number}.mp3`);
        const fallbackPath = this.getResolvedPath(`audio/voices/${number}.m4a`);

        // 1. Guarded Web Audio API Pipeline Execution
        if (this.audioContext) {
            try {
                if (this.audioContext.state === 'suspended') {
                    await this.audioContext.resume().catch(() => {});
                }
                await this.playViaWebAudio(primaryPath);
                return; // Success
            } catch (err) {
                console.warn(`⚠️ Web Audio failed for ${number}. Trying fallback extension inside Web Audio...`, err);
                try {
                    await this.playViaWebAudio(fallbackPath);
                    return; // Success
                } catch (fallbackErr) {
                    console.warn(`⚠️ Web Audio fallback failed for ${number}. Dropping down to native HTML5 elements...`, fallbackErr);
                }
            }
        } else {
            console.warn(`⚠️ playBallNumber safe-intercept: AudioContext is null. Bypassing decodeAudioData to prevent crash.`);
        }

        // 2. Resilient Native HTML5 Audio Element Fallback Pipeline
        await this.playViaAudioElementFallback(primaryPath, fallbackPath);
    }

    async playViaWebAudio(url: string) {
        if (!this.audioContext) throw new Error("AudioContext structural reference is null.");
        
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error rendering asset: status ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        
        // Wrapped promise ensures backwards and forwards web-engine cross-compatibility
        const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
            this.audioContext!.decodeAudioData(
                arrayBuffer, 
                (buffer) => resolve(buffer), 
                (err) => reject(err || new Error("decodeAudioData failed parsing binary format"))
            );
        });

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);
        source.start(0);

        return new Promise((resolve) => {
            source.onended = resolve;
        });
    }

    playViaAudioElementFallback(primaryUrl: string, fallbackUrl: string) {
        return new Promise<void>((resolve, reject) => {
            let audio = new Audio(primaryUrl);
            
            const tryFallback = () => {
                console.warn(`Primary audio playback failed for ${primaryUrl}, trying alternative extension.`);
                audio.removeEventListener('error', handleError);
                audio.removeEventListener('ended', handleEnded);
                
                audio = new Audio(fallbackUrl);
                audio.addEventListener('ended', handleEnded);
                audio.addEventListener('error', handleFallbackError);
                audio.play().catch(handleFallbackError);
            };

            const handleEnded = () => {
                cleanup();
                resolve();
            };

            const handleError = () => {
                tryFallback();
            };

            const handleFallbackError = () => {
                cleanup();
                console.error(`Fallback playback also failed for ${fallbackUrl}`, audio.error);
                reject(audio.error || new Error("All configured audio formats failed to process."));
            };

            const cleanup = () => {
                audio.removeEventListener('ended', handleEnded);
                audio.removeEventListener('error', handleError);
                audio.removeEventListener('error', handleFallbackError);
            };

            audio.addEventListener('ended', handleEnded);
            audio.addEventListener('error', handleError);

            audio.play().catch((err) => {
                // If instant play invocation encounters gesture locks, redirect instantly into fallback handler
                tryFallback();
            });
        });
    }
}

(window as any).voiceEngine = new VoiceCallerEngine();
