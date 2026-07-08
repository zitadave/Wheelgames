const AudioContextClass = typeof window !== 'undefined' ? ((window as any).AudioContext || (window as any).webkitAudioContext) : null;
export const audioCtx = AudioContextClass ? new AudioContextClass() : null;

// Reusable, pre-unlocked global HTML5 Audio element for playing URL-based caller voices
let globalUnlockedAudio: HTMLAudioElement | null = null;

export function initUnlockedAudio() {
  if (typeof window === 'undefined') return;
  if (!globalUnlockedAudio) {
    try {
      globalUnlockedAudio = new Audio();
      // Use a tiny, silent 1-second WAV to trigger activation of the audio engine
      globalUnlockedAudio.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAAA";
      globalUnlockedAudio.play().then(() => {
        console.log("Global pre-unlocked audio element successfully initialized");
      }).catch(err => {
        console.warn("Global pre-unlocked audio element initial silent play rejected:", err);
      });
    } catch (e) {
      console.warn("Failed to initialize global pre-unlocked audio element:", e);
    }
  }
}

// Unify unlocking of Web Audio API and HTML5 Audio
if (typeof document !== 'undefined') {
  const unlockAllAudio = () => {
    // 1. Resume Web Audio API
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    // 2. Initialize and trigger the pre-unlocked HTML5 Audio element
    initUnlockedAudio();
  };
  document.addEventListener('click', unlockAllAudio, { passive: true });
  document.addEventListener('touchstart', unlockAllAudio, { passive: true });
}

export function suspendAudio() {
  if (audioCtx && audioCtx.state !== 'suspended') {
    audioCtx.suspend().catch(() => {});
  }
}

export function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  initUnlockedAudio();
}

export function playTick() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.01);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.01);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.01);
  } catch (e) {
    console.warn("playTick failed", e);
  }
}

export function playSpinStart() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(250, audioCtx.currentTime + 0.5);
    osc.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 2.0);
    
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 2.0);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 2.0);
  } catch (e) {
    console.warn("playSpinStart failed", e);
  }
}

export function playWin() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
    osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1);
    osc.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.2);
    osc.frequency.setValueAtTime(1046.50, audioCtx.currentTime + 0.3);
    
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.3);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1.0);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 1.0);
  } catch (e) {
    console.warn("playWin failed", e);
  }
}

export function playLoss() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
  } catch (e) {
    console.warn("playLoss failed", e);
  }
}

const decodedCache = new Map<string, AudioBuffer>();
let activeSourceNode: AudioBufferSourceNode | null = null;

export function stopCurrentAudio() {
  if (activeSourceNode) {
    try {
      activeSourceNode.stop();
    } catch (e) {
      // Ignored: source already stopped or not started
    }
    activeSourceNode = null;
  }
}

async function safeDecodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  if (!audioCtx) {
    throw new Error("No AudioContext available");
  }
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const promise = audioCtx.decodeAudioData(
        arrayBuffer,
        (buffer) => resolve(buffer),
        (error) => reject(error)
      );
      if (promise && typeof promise.catch === 'function') {
        promise.catch((err) => reject(err));
      }
    } catch (e) {
      reject(e);
    }
  });
}

export async function playAudioUrlRaw(url: string): Promise<void> {
  if (!audioCtx) {
    throw new Error("No AudioContext available");
  }

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  stopCurrentAudio();

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const absoluteUrl = url.startsWith('http') || url.startsWith('data:') ? url : `${baseUrl}${url}`;

  let buffer = decodedCache.get(absoluteUrl);
  if (!buffer) {
    const response = await fetch(absoluteUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    buffer = await safeDecodeAudioData(arrayBuffer);
    decodedCache.set(absoluteUrl, buffer);
  }

  return new Promise<void>((resolve, reject) => {
    if (!audioCtx) {
      reject(new Error("No AudioContext"));
      return;
    }
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    
    activeSourceNode = source;
    
    source.onended = () => {
      if (activeSourceNode === source) {
        activeSourceNode = null;
      }
      resolve();
    };

    source.onerror = (err) => {
      reject(err);
    };

    try {
      source.start(0);
    } catch (e) {
      reject(e);
    }
  });
}

export async function playAudioUrl(url: string, onEnded?: () => void): Promise<void> {
  try {
    await playAudioUrlRaw(url);
    if (onEnded) onEnded();
  } catch (e) {
    console.warn("playAudioUrl failed for", url, e);
    if (onEnded) onEnded();
  }
}

export function stopAudioViaElement() {
  if (globalUnlockedAudio) {
    try {
      globalUnlockedAudio.pause();
    } catch (e) {}
  }
}

export function playAudioViaElement(url: string, onEnded?: () => void, onError?: (err: any) => void) {
  if (typeof window === 'undefined') {
    if (onEnded) onEnded();
    return;
  }

  if (!globalUnlockedAudio) {
    initUnlockedAudio();
  }

  if (globalUnlockedAudio) {
    globalUnlockedAudio.onended = null;
    globalUnlockedAudio.onerror = null;

    try {
      globalUnlockedAudio.pause();
    } catch (e) {}

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const absoluteUrl = url.startsWith('http') || url.startsWith('data:') ? url : `${baseUrl}${url}`;

    globalUnlockedAudio.src = absoluteUrl;

    globalUnlockedAudio.onended = () => {
      if (onEnded) onEnded();
    };

    globalUnlockedAudio.onerror = (e) => {
      console.warn("Audio element error on playing:", absoluteUrl, e);
      if (onError) onError(e);
      else if (onEnded) onEnded();
    };

    const playPromise = globalUnlockedAudio.play();
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.warn("Audio element play failed for:", absoluteUrl, err);
        if (onError) onError(err);
        else if (onEnded) onEnded();
      });
    }
  } else {
    if (onError) onError(new Error("No audio element available"));
    else if (onEnded) onEnded();
  }
}

export function playCallerVoice(
  url: string, 
  ball: number | null, 
  onEnded: () => void, 
  fallbackToTTSCallback: (ball: number, cb: () => void) => void
) {
  let completed = false;
  
  // Set a safety timeout of 4 seconds to prevent the queue from ever locking up!
  const timeoutId = setTimeout(() => {
    if (!completed) {
      console.warn("playCallerVoice timed out after 4s for:", url);
      done();
    }
  }, 4000);

  const done = () => {
    if (!completed) {
      completed = true;
      clearTimeout(timeoutId);
      onEnded();
    }
  };

  // 1. Try HTML5 Audio (reusable global unlocked element)
  playAudioViaElement(
    url,
    () => {
      done();
    },
    async (elementErr) => {
      console.warn("HTML5 Audio failed, falling back to Web Audio API:", elementErr);
      
      // 2. Try Web Audio API (decoded buffer)
      try {
        await playAudioUrlRaw(url);
        done();
      } catch (webAudioErr) {
        console.warn("Web Audio API also failed, falling back to TTS:", webAudioErr);
        
        // 3. Try Speech Synthesis / TTS
        if (ball !== null) {
          fallbackToTTSCallback(ball, done);
        } else {
          done();
        }
      }
    }
  );
}
