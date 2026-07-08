import React, { useEffect, useRef, useState } from 'react';

interface OdometerCanvasProps {
  winner: number;
  onComplete: () => void;
  isDarkMode: boolean;
  soundTicks: boolean;
  digits?: number;
  duration?: number;
}

export const OdometerCanvas = React.memo(function OdometerCanvas({
  winner,
  onComplete,
  isDarkMode,
  soundTicks,
  digits = 2,
  duration = 7.0,
}: OdometerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onCompleteRef = useRef(onComplete);
  const soundTicksRef = useRef(soundTicks);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    soundTicksRef.current = soundTicks;
  }, [onComplete, soundTicks]);

  // Play audio tick
  const playHapticAudio = (freq = 450) => {
    if (!soundTicksRef.current) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.03);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.03);
    } catch (e) {}
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas dimensions
    const width = digits === 3 ? 320 : 240;
    const height = 130;
    canvas.width = width;
    canvas.height = height;

    let startTime = Number(sessionStorage.getItem('odometerStartTime'));
    if (!startTime || startTime === 0 || Date.now() - startTime > duration * 1000) {
      startTime = Date.now();
      sessionStorage.setItem('odometerStartTime', startTime.toString());
    }
    
    let animationId: number;
    let completedTriggered = false;

    // Parse winner digits
    let hundredsDigit = 0;
    let tensDigit = 0;
    let onesDigit = 0;

    if (digits === 3) {
      hundredsDigit = Math.floor(winner / 100) % 10;
      tensDigit = Math.floor(winner / 10) % 10;
      onesDigit = winner % 10;
    } else {
      // Original 2-digit logic (100 -> 00)
      tensDigit = winner === 100 ? 0 : Math.floor(winner / 10);
      onesDigit = winner === 100 ? 0 : winner % 10;
    }

    // Target positions
    const Y_huns_final = 10 * 2 + hundredsDigit;
    const Y_tens_final = 10 * 3 + tensDigit; // 3 full spins
    const Y_ones_final = 10 * 5 + onesDigit; // 5 full spins

    let lastHunsTick = 0;
    let lastTensTick = 0;
    let lastOnesTick = 0;

    const draw = () => {
      const elapsed = (Date.now() - startTime) / 1000; // in seconds
      const t = Math.min(elapsed, duration);

      // Helper for dramatic fast-in / super-slow-out
      const calculatePosition = (tVal: number, startTime: number, stopTime: number, finalY: number) => {
        let y = 0;
        if (tVal < startTime) {
          y = 0; // Not started yet
        } else if (tVal >= stopTime) {
          y = finalY;
        } else {
          const windBackTime = 0.2;
          const tInReel = tVal - startTime;
          const reelDuration = stopTime - startTime;
          
          if (tInReel <= windBackTime) {
            y = -1.2 * Math.pow(tInReel / windBackTime, 2);
          } else {
            const progress = (tInReel - windBackTime) / (reelDuration - windBackTime);
            // Fast-in, super-slow-out - Increased acceleration (lower exponent)
            const easeOut = Math.pow(progress, 0.25) * (1 - Math.pow(1 - progress, 12));
            const startVal = -1.2;
            y = startVal + (finalY - startVal) * easeOut;
            
            // Add slight overshoot/bounce at the end
            if (progress > 0.95) {
              const bounceP = (progress - 0.95) / 0.05;
              const bounce = Math.sin(bounceP * Math.PI) * 0.2 * (1 - bounceP);
              y += bounce;
            }
          }
        }
        return y;
      };

      // 1. Calculate positions
      
      // HUNDREDS POSITION
      let yHuns = 0;
      if (digits === 3) {
        yHuns = calculatePosition(t, 0, duration / 3, Y_huns_final);
      }

      // TENS POSITION
      const yTens = calculatePosition(t, (digits === 3 ? duration / 3 : 0), (digits === 3 ? duration * 2 / 3 : duration / 2), Y_tens_final);

      // ONES POSITION
      const yOnes = calculatePosition(t, (digits === 3 ? duration * 2 / 3 : duration / 2), duration, Y_ones_final);

      // Play sound tick on integer crosses
      if (digits === 3) {
        const currentHunsInt = Math.floor(yHuns);
        if (currentHunsInt !== lastHunsTick) {
          playHapticAudio(340 + (currentHunsInt % 10) * 15);
          lastHunsTick = currentHunsInt;
        }
      }
      
      const currentTensInt = Math.floor(yTens);
      if (currentTensInt !== lastTensTick) {
        playHapticAudio(380 + (currentTensInt % 10) * 15);
        lastTensTick = currentTensInt;
      }
      const currentOnesInt = Math.floor(yOnes);
      if (currentOnesInt !== lastOnesTick) {
        playHapticAudio(420 + (currentOnesInt % 10) * 15);
        lastOnesTick = currentOnesInt;
      }

      // Clear
      ctx.clearRect(0, 0, width, height);

      // Background plate
      ctx.fillStyle = isDarkMode ? '#0a0a0c' : '#f1f5f9';
      ctx.fillRect(0, 0, width, height);

      // Draw rollers
      const drawRoller = (xCenter: number, yPos: number) => {
        const trackWidth = 72;
        const trackHeight = 110;
        const trackX = xCenter - trackWidth / 2;
        const trackY = height / 2 - trackHeight / 2;

        ctx.save();
        // Clip to viewport
        ctx.beginPath();
        ctx.roundRect(trackX, trackY, trackWidth, trackHeight, 12);
        ctx.clip();

        // Track background
        ctx.fillStyle = isDarkMode ? '#141517' : '#ffffff';
        ctx.fillRect(trackX, trackY, trackWidth, trackHeight);

        // Track border/groove
        ctx.strokeStyle = isDarkMode ? '#27272a' : '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.strokeRect(trackX, trackY, trackWidth, trackHeight);

        // Render visible digits
        const spacing = 42; // vertical spacing per digit
        const startInt = Math.floor(yPos) - 2;
        const endInt = Math.floor(yPos) + 2;

        for (let d = startInt; d <= endInt; d++) {
          const digitToDraw = ((d % 10) + 10) % 10;
          const pixelY = height / 2 + (d - yPos) * spacing;

          // 3D Cylinder projection scaling and opacity
          const distFromCenter = Math.abs(pixelY - height / 2);
          const maxDist = trackHeight / 2;
          const pct = Math.min(distFromCenter / maxDist, 1.0);

          // Opacity fades toward top and bottom
          const opacity = Math.max(0, 1 - pct * pct * 0.95);
          // Scale down vertically and compress towards edges
          const scaleY = Math.cos(pct * Math.PI * 0.4);

          ctx.save();
          ctx.translate(xCenter, pixelY);
          ctx.scale(1.0, scaleY);

          ctx.fillStyle = isDarkMode ? '#f59e0b' : '#1d4ed8'; // Gold vs Blue

          ctx.font = '900 40px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.globalAlpha = opacity;

          ctx.fillText(digitToDraw.toString(), 0, 0);

          ctx.restore();
        }

        // Inner Shading Gradient (Cylindrical barrel shadows)
        const innerShadow = ctx.createLinearGradient(0, trackY, 0, trackY + trackHeight);
        innerShadow.addColorStop(0, 'rgba(0, 0, 0, 0.9)');
        innerShadow.addColorStop(0.18, 'rgba(0, 0, 0, 0.15)');
        innerShadow.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
        innerShadow.addColorStop(0.82, 'rgba(0, 0, 0, 0.15)');
        innerShadow.addColorStop(1, 'rgba(0, 0, 0, 0.9)');
        ctx.fillStyle = innerShadow;
        ctx.fillRect(trackX, trackY, trackWidth, trackHeight);

        ctx.restore();
      };

      // Draw tracks
      if (digits === 3) {
        drawRoller(width / 2 - 84, yHuns);
        drawRoller(width / 2, yTens);
        drawRoller(width / 2 + 84, yOnes);
      } else {
        drawRoller(width / 2 - 42, yTens);
        drawRoller(width / 2 + 42, yOnes);
      }

      // Outer bezel glass highlight diagonal gleam
      ctx.save();
      const gleam = ctx.createLinearGradient(0, 0, width, height);
      gleam.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
      gleam.addColorStop(0.35, 'rgba(255, 255, 255, 0.05)');
      gleam.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
      gleam.addColorStop(0.8, 'rgba(255, 255, 255, 0.03)');
      gleam.addColorStop(1, 'rgba(255, 255, 255, 0.1)');
      ctx.fillStyle = gleam;
      ctx.fillRect(10, 10, width - 20, height - 20);

      // Highlight frame line
      ctx.strokeStyle = isDarkMode ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(10, 10, width - 20, height - 20);
      ctx.restore();

      // Trigger completion callback once at duration
      if (t >= duration && !completedTriggered) {
        completedTriggered = true;
        setTimeout(() => {
          onCompleteRef.current();
        }, 500);
      }

      if (t < duration) {
        animationId = requestAnimationFrame(draw);
      }
    };

    animationId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [winner, isDarkMode]);

  return (
    <div className="flex flex-col items-center justify-center p-4 bg-gray-950 dark:bg-black rounded-3xl border border-yellow-500/30 shadow-[0_15px_35px_rgba(0,0,0,0.6)] relative overflow-hidden">
      {/* Absolute glow backing */}
      <div className="absolute inset-0 bg-yellow-500/5 mix-blend-screen pointer-events-none" />
      <canvas
        ref={canvasRef}
        className="rounded-2xl border border-zinc-800 shadow-[inset_0_4px_12px_rgba(0,0,0,0.9)] max-w-full"
        style={{ width: digits === 3 ? '320px' : '240px', height: '130px' }}
      />
    </div>
  );
});
