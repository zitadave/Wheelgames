import React, { useEffect, useRef } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import { playTick, playSpinStart } from '../utils/sound';
import { triggerHaptic } from '../utils/haptic';

interface WheelProps {
  status: "betting" | "balancing" | "spinning" | "result";
  winner?: number;
  soundTicks: boolean;
  timeLeft?: number;
}

export const Wheel = React.memo(function Wheel({ status, winner, soundTicks, timeLeft }: WheelProps) {
  const [initialRotate] = React.useState(() => Number(sessionStorage.getItem('wheelRotation') || 0));
  const rotate = useMotionValue(initialRotate);
  const prevStatus = useRef<string | null>(null);
  const lastTickSegment = useRef(0);
  const lastTickTime = useRef(0);
  const soundTicksRef = useRef(soundTicks);

  useEffect(() => {
    soundTicksRef.current = soundTicks;
  }, [soundTicks]);

  useEffect(() => {
    let animationControls: any;

    if (status === 'spinning' && winner && prevStatus.current !== 'spinning') {
      const orderAtTop = [1, 6, 5, 4, 3, 2];
      const targetIndex = orderAtTop.indexOf(winner);
      // Introduce a realistic random landing offset within the slice (-20 to +20 deg) to keep suspense alive!
      const randomOffset = (Math.random() - 0.5) * 40;
      
      const duration = timeLeft !== undefined && timeLeft > 0 ? timeLeft : 60;
      const spins = Math.max(Math.floor(duration * 3), 15); // Increased spins for a much faster start
      const targetRotation = 360 * spins + (targetIndex * 60) + randomOffset; 

      // Launch haptic and sound
      triggerHaptic('impact', 'heavy');
      if (soundTicksRef.current) playSpinStart();

      const currentRot = rotate.get() % 360;
      rotate.set(currentRot);
      
      // Extremely rapid launch and very very super slow deceleration
      animationControls = animate(rotate, targetRotation, {
        duration: duration,
        ease: (progress) => 1 - Math.pow(1 - progress, 7),
        onUpdate: (latest) => {
          const currentSegment = Math.floor((latest + 30) / 60);
          if (currentSegment !== lastTickSegment.current) {
            const now = Date.now();
            // Rate-limit the click sounds and haptic pulses at high speeds for professional audio feel
            if (now - lastTickTime.current > 35) {
              if (soundTicksRef.current) playTick();
              triggerHaptic('impact', 'light');
              lastTickTime.current = now;
            }
            lastTickSegment.current = currentSegment;
          }
        },
        onComplete: () => {
          sessionStorage.setItem('wheelRotation', rotate.get().toString());
        }
      });
    } else if (status === 'betting' || status === 'balancing') {
      // Stationary states: Stop completely during player selection, closing time, and balancing.
      if (animationControls) {
        animationControls.stop();
      }
      // Gently keep current resting rotation normalized
      const currentRot = rotate.get() % 360;
      rotate.set(currentRot);
    } else if (status === 'result') {
      // Resting on result
      if (winner) {
        const orderAtTop = [1, 6, 5, 4, 3, 2];
        const targetIndex = orderAtTop.indexOf(winner);
        const baseTarget = targetIndex * 60;
        
        const currentRot = rotate.get();
        const normalized = ((currentRot % 360) + 360) % 360;
        const currentSegment = Math.floor(((normalized + 30) % 360) / 60);
        
        if (currentSegment !== targetIndex) {
          let targetRotation = currentRot - normalized + baseTarget;
          if (targetRotation < currentRot) {
            targetRotation += 360;
          }
          animationControls = animate(rotate, targetRotation, {
            duration: 0.8,
            ease: "easeOut",
            onComplete: () => {
              sessionStorage.setItem('wheelRotation', rotate.get().toString());
            }
          });
        }
      }
    }
    prevStatus.current = status;

    return () => {
      if (animationControls) {
        animationControls.stop();
      }
      // Save current resting rotation for seamless continuity
      try {
        sessionStorage.setItem('wheelRotation', rotate.get().toString());
      } catch (e) {}
    };
  }, [status, winner, rotate]);

  // Pointer Color
  const pointerColor = useTransform(rotate, (r) => {
    const normalized = ((r % 360) + 360) % 360;
    const segmentIndex = Math.floor(((normalized + 30) % 360) / 60);
    const orderAtTop = [1, 6, 5, 4, 3, 2];
    const num = orderAtTop[segmentIndex % 6];
    return num % 2 === 0 ? '#dc2626' : '#111111'; // red for even, black for odd
  });

  const segments = [1, 2, 3, 4, 5, 6];

  return (
    <div className="relative w-[280px] h-[280px] mx-auto my-6">
      {/* Elevated 3D Pointer */}
      <motion.div 
        className="absolute top-[-36px] left-1/2 -translate-x-1/2 w-10 h-12 z-20 drop-shadow-[0_8px_12px_rgba(0,0,0,0.6)] pointer-events-none"
        style={{ 
          color: pointerColor,
        }}
      >
        <svg viewBox="0 0 48 56" className="w-full h-full filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]">
          {/* Left-side Highlight Face */}
          <path 
            d="M 24 52 L 4 4 L 24 4 Z" 
            fill="currentColor"
          />
          <path 
            d="M 24 52 L 4 4 L 24 4 Z" 
            fill="white"
            fillOpacity="0.25"
          />
          {/* Right-side Shadow Face */}
          <path 
            d="M 24 52 L 24 4 L 44 4 Z" 
            fill="currentColor"
          />
          <path 
            d="M 24 52 L 24 4 L 44 4 Z" 
            fill="black"
            fillOpacity="0.3"
          />
          {/* Center crease ridge */}
          <line 
            x1="24" y1="4" x2="24" y2="52" 
            stroke="rgba(255, 255, 255, 0.4)" 
            strokeWidth="1.5"
          />
        </svg>
      </motion.div>
      
      {/* Wheel Canvas */}
      <motion.div 
        className="w-full h-full rounded-full border border-gray-200 dark:border-gray-800 shadow-[0_20px_50px_rgba(0,0,0,0.35)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.7)] overflow-hidden relative will-change-transform"
        style={{ 
          rotate,
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          transform: 'translate3d(0, 0, 0)'
        }}
      >
        <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
          <g transform="rotate(-30 50 50)">
            {segments.map((num, i) => {
              const isEven = num % 2 === 0;
              const C = 2 * Math.PI * 25;
              const segmentLength = C / 6;
              return (
                <circle
                  key={num}
                  cx="50"
                  cy="50"
                  r="25"
                  fill="transparent"
                  stroke={isEven ? '#dc2626' : '#111111'}
                  strokeWidth="50"
                  strokeDasharray={`${segmentLength} ${C}`}
                  strokeDashoffset={-segmentLength * i}
                />
              );
            })}
          </g>
          {segments.map((num, i) => {
            const isEven = num % 2 === 0;
            const angle = (i * 60) * (Math.PI / 180);
            const x = 50 + 35 * Math.cos(angle);
            const y = 50 + 35 * Math.sin(angle);
            return (
              <g key={`group-${num}`} transform={`rotate(${i * 60 + 90}, ${x}, ${y})`}>
                <text
                  x={x}
                  y={y - 3}
                  fill="white"
                  fontSize="12"
                  fontWeight="bold"
                  textAnchor="middle"
                  alignmentBaseline="middle"
                >
                  {num}
                </text>
                <text
                  x={x}
                  y={y + 5}
                  fill="rgba(255, 255, 255, 0.9)"
                  fontSize="4.5"
                  fontWeight="bold"
                  textAnchor="middle"
                  alignmentBaseline="middle"
                >
                  {isEven ? 'ሞላ' : 'ጎደለ'}
                </text>
              </g>
            );
          })}
        </svg>
        {/* Center dot */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-full border-2 border-gray-400 dark:border-gray-600 z-10 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] transition-colors duration-300"></div>
      </motion.div>
    </div>
  );
});
