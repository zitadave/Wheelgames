class VoiceCallerEngine {
    audioContext: AudioContext | null;

    constructor() {
        this.audioContext = null;
        this.initAudioContext();
    }

    initAudioContext() {
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContextClass) this.audioContext = new AudioContextClass();
        } catch (e) { console.error(e); }
    }

    initPipeline() {
        // No-op for backward compatibility
    }

    getResolvedPath(relativeAudioPath: string) {
        const url = new URL(window.location.href);
        let pathname = url.pathname;
        if (!pathname.endsWith('/')) {
            const segments = pathname.split('/');
            segments.pop();
            pathname = segments.join('/') + '/';
        }
        const cleanPath = relativeAudioPath.startsWith('/') ? relativeAudioPath.slice(1) : relativeAudioPath;
        return `${url.origin}${pathname}${cleanPath}`;
    }

    async playBallNumber(number: number) {
        const primaryPath = this.getResolvedPath(`audio/voices/${number}.mp3`);
        try {
            const response = await fetch(primaryPath);
            if (!response.ok) throw new Error(`Status: ${response.status}`);
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('text/html')) {
                console.error(`❌ DEPLOYMENT ERROR: The server at "${primaryPath}" returned an HTML webpage layout instead of a binary MP3 file!`);
                return;
            }
            const arrayBuffer = await response.arrayBuffer();
            const sampleBytes = new Uint8Array(arrayBuffer.slice(0, 5));
            const textSignature = String.fromCharCode(...sampleBytes);
            if (textSignature.includes("<!DOC") || textSignature.includes("<html")) {
                console.error(`❌ VALIDATION ERROR: Downloaded file starts with HTML layout syntax.`);
                return;
            }
            if (this.audioContext) {
                if (this.audioContext.state === 'suspended') await this.audioContext.resume().catch(() => {});
                const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
                    this.audioContext!.decodeAudioData(arrayBuffer, (buffer) => resolve(buffer), (err) => reject(err));
                });
                const source = this.audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(this.audioContext.destination);
                source.start(0);
            } else {
                const audio = new Audio(primaryPath);
                await audio.play();
            }
        } catch (error) { console.error(error); }
    }
}
(window as any).voiceEngine = new VoiceCallerEngine();
