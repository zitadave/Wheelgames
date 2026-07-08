import React, { useState, useEffect, useRef } from 'react';
import { Trophy, Coins, Lock, Sparkles, RefreshCw, AlertTriangle, Zap, Flame, Crown, Eye, ArrowLeft, Info, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { OdometerCanvas } from './OdometerCanvas';

interface JackpotArenaProps {
  balance: number;
  setBalance: React.Dispatch<React.SetStateAction<number>>;
  showNotification: (message: string, type: 'success' | 'error' | 'info') => void;
  setTransactions: React.Dispatch<React.SetStateAction<any[]>>;
  setGameHistory: React.Dispatch<React.SetStateAction<any[]>>;
  isDarkMode: boolean;
  soundTicks: boolean;
  isActive?: boolean;
  onTheaterModeChange?: (active: boolean) => void;
  socket?: any;
  userId?: string; username?: string; photoUrl?: string | null;
  initialTier?: JackpotTier;
}

type JackpotTier = 'mini' | 'grand';

interface JackpotHistoryItem {
  roundId: number;
  winners: { 1?: number; 2?: number; 3?: number };
}

interface Participant {
  username: string;
  isSelf: boolean; photoUrl?: string | null;
}

export const JackpotArena = React.memo(function JackpotArena({
  balance,
  setBalance,
  showNotification,
  setTransactions,
  setGameHistory,
  isDarkMode,
  soundTicks,
  isActive = true,
  onTheaterModeChange,
  socket,
  userId,
  username = "Player",
  photoUrl,
  initialTier
}: JackpotArenaProps) {
  const [tier, setTier] = useState<JackpotTier>('mini');
  const [isInfoOpen, setIsInfoOpen] = useState<boolean>(false);
  const [showInviteModal, setShowInviteModal] = useState<boolean>(false);
  const [shareToken, setShareToken] = useState<string>('');

  useEffect(() => {
    if (initialTier) {
      setTier(initialTier);
    }
  }, [initialTier]);
  
  // Matrix configurations
  const config = {
    mini: { slots: 50, entry: 2000, gross: 100000, fee: 10000, p1: 72000, p2: 12600, p3: 5400 },
    grand: { slots: 100, entry: 2000, gross: 200000, fee: 20000, p1: 144000, p2: 25200, p3: 10800 }
  };

  const currentConfig = config[tier];

  // Grid spots state
  const [miniGrid, setMiniGrid] = useState<Record<number, Participant>>({});
  const [grandGrid, setGrandGrid] = useState<Record<number, Participant>>({});

  // Game phases:
  // 'lobby' -> 'freeze' -> 'drawing' -> 'winner' -> 'vaporizing' -> 'complete'
  const [gamePhase, setGamePhase] = useState<'lobby' | 'freeze' | 'drawing' | 'winner' | 'vaporizing' | 'complete'>('lobby');
  
  // Track currently drawn winners for the 3 slots (1st, 2nd, 3rd)
  const [drawNumber, setDrawNumber] = useState<1 | 2 | 3>(1);

  const [freezeCountdown, setFreezeCountdown] = useState<number>(10);

  const serverWinnersRef = useRef<any>(null);

  // Realtime syncing
  useEffect(() => {
    if (!socket || !isActive) return;
    
    socket.emit('grid_join', tier);
    
    const onGridState = (state: any) => {
       if (!state) return;
       
       if (state.history) {
          setHistory(prev => ({
             ...prev,
             [tier]: state.history
          }));
       }
       
       if (state.roundId) {
         setRoundIds(prev => ({
           ...prev,
           [tier]: state.roundId
         }));
       }
       
       const newClaimed: any = {};
       Object.keys(state.claimedSlots).forEach((k) => {
         const slot = state.claimedSlots[k as any];
         newClaimed[Number(k)] = { ...slot, isSelf: slot.userId === userId };
       });
       if (tier === 'mini') {
         setMiniGrid(newClaimed);
       } else {
         setGrandGrid(newClaimed);
       }
       
       if (state.winners) {
         serverWinnersRef.current = state.winners;
       } else {
         serverWinnersRef.current = null;
       }
       
       if (Object.keys(newClaimed).length === config[tier].slots && gamePhase === 'lobby') {
          setGamePhase('freeze');
          setFreezeCountdown(10);
       }
    };
    
    socket.on('grid_state', onGridState);
    return () => {
       socket.emit('grid_leave', tier);
       socket.off('grid_state', onGridState);
    };
  }, [socket, tier, isActive, gamePhase]);
  const [winners, setWinners] = useState<{ first?: number; second?: number; third?: number }>({});
  const [vaporizedSlots, setVaporizedSlots] = useState<number[]>([]);

  const [roundIds, setRoundIds] = useState<{ mini: number; grand: number }>(() => ({
    mini: Math.floor(Math.random() * 9000) + 1000,
    grand: Math.floor(Math.random() * 9000) + 1000
  }));
  const [history, setHistory] = useState<{ mini: JackpotHistoryItem[]; grand: JackpotHistoryItem[] }>({
    mini: [],
    grand: []
  });

  const currentRoundId = roundIds[tier];
  const currentHistory = history[tier];

  // Animation States
  
  
  // Neon Blitz dynamic active index
  const [blitzActiveTile, setBlitzActiveTile] = useState<number | null>(null);
  const isMounted = useRef<boolean>(true);
  // Timer management to prevent memory leaks/stuck state on unmount
  const activeTimers = useRef<NodeJS.Timeout[]>([]);
  const clearAllTimers = () => {
    activeTimers.current.forEach(timer => clearTimeout(timer));
    activeTimers.current = [];
  };

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      clearAllTimers();
    };
  }, []);

  // Wrap setTimeout to track it
  const trackTimeout = (fn: Function, delay: number) => {
    const id = setTimeout(() => {
      if (!isMounted.current) return;
      fn();
      activeTimers.current = activeTimers.current.filter(t => t !== id);
    }, delay);
    activeTimers.current.push(id);
    return id;
  };

  // Wrap setInterval to track it
  const trackInterval = (fn: Function, delay: number) => {
    const id = setInterval(() => {
      if (!isMounted.current) {
        clearInterval(id);
        return;
      }
      fn();
    }, delay);
    activeTimers.current.push(id as unknown as NodeJS.Timeout);
    return id;
  };

  // Current winner selected to spin
  const [currentWinner, setCurrentWinner] = useState<number | null>(null);

  // VIP Grand Reels digits
  const [reelHundred, setReelHundred] = useState<string>('0');
  const [reelTen, setReelTen] = useState<string>('0');
  const [reelOne, setReelOne] = useState<string>('0');
  const [hundredsSpinning, setHundredsSpinning] = useState(false);
  const [tensSpinning, setTensSpinning] = useState(false);
  const [onesSpinning, setOnesSpinning] = useState(false);

  // Active grid alias
  const activeGrid = tier === 'mini' ? miniGrid : grandGrid;
  const setTargetGrid = tier === 'mini' ? setMiniGrid : setGrandGrid;

  // Sync theater mode status up to parent
  const lastTheaterModeRef = useRef<boolean>(false);
  useEffect(() => {
    const isTheater =
      gamePhase === 'drawing' ||
      gamePhase === 'winner' ||
      gamePhase === 'vaporizing' ||
      gamePhase === 'complete';

    if (onTheaterModeChange && lastTheaterModeRef.current !== isTheater) {
      lastTheaterModeRef.current = isTheater;
      onTheaterModeChange(isTheater);
    }
  }, [gamePhase, onTheaterModeChange]);

  useEffect(() => {
    return () => {
      if (onTheaterModeChange && lastTheaterModeRef.current) {
        onTheaterModeChange(false);
      }
    };
  }, [onTheaterModeChange]);

  // Sound generator
  const playHapticAudio = (freq = 600) => {
    if (!soundTicks || !isMounted.current || !isActive) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.04);
    } catch (e) {}
  };

  const playWinnerAudio = () => {
    if (!soundTicks || !isActive) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(350, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(850, audioCtx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.5);
    } catch (e) {}
  };

  // Populate grids initially with 65% filled and recover interrupted phase
  useEffect(() => {
    const savedState = sessionStorage.getItem('jackpotArenaState');
    if (savedState) {
      try {
        const state = JSON.parse(savedState);
        setGamePhase(state.gamePhase);
        setDrawNumber(state.drawNumber);
        setWinners(state.winners);
        setVaporizedSlots(state.vaporizedSlots);
        if (state.tier === 'mini') {
          setMiniGrid(state.grid);
        } else {
          setGrandGrid(state.grid);
        }
        setTier(state.tier);
        if (state.serverWinners) {
          serverWinnersRef.current = state.serverWinners;
        }

        // Safely recover active draw phase on mount
        if (state.gamePhase !== 'lobby') {
          if (state.gamePhase === 'drawing') {
            executeSequentialDraw(state.drawNumber);
          } else if (state.gamePhase === 'winner' || state.gamePhase === 'vaporizing') {
            if (state.drawNumber < 3) {
              executeSequentialDraw((state.drawNumber + 1) as 2 | 3);
            } else {
              setGamePhase('complete');
              trackTimeout(() => resetLobby(), 6000);
            }
          } else if (state.gamePhase === 'complete') {
            trackTimeout(() => resetLobby(), 6000);
          }
        }
      } catch (e) {
        resetLobby();
      }
    } else {
      resetLobby();
    }
  }, []);

  // Persist state
  useEffect(() => {
    sessionStorage.setItem('jackpotArenaState', JSON.stringify({
      gamePhase,
      drawNumber,
      winners,
      vaporizedSlots,
      grid: activeGrid,
      tier,
      serverWinners: serverWinnersRef.current
    }));
  }, [gamePhase, drawNumber, winners, vaporizedSlots, activeGrid, tier]);

  const resetLobby = () => {
    sessionStorage.removeItem('odometerStartTime');
    sessionStorage.removeItem('jackpotArenaState');
    
    socket?.emit('grid_nextRound', tier);
    
    setGamePhase('lobby');
    setDrawNumber(1);
    setWinners({});
    setVaporizedSlots([]);
    setBlitzActiveTile(null);
    setReelHundred('0');
    setReelTen('0');
    setReelOne('0');
    setRoundIds(prev => ({ ...prev, [tier]: prev[tier] + 1 }));
  };

  const triggerGlobalFreeze = () => {
    setGamePhase('freeze');
    setFreezeCountdown(10);
  };

  // Countdown timer for freeze phase
  useEffect(() => {
    if (gamePhase !== 'freeze') return;
    if (freezeCountdown <= 0) {
      executeSequentialDraw(1);
      return;
    }

    const timer = trackTimeout(() => {
      setFreezeCountdown(prev => prev - 1);
      playHapticAudio(300);
    }, 1000);

    return () => clearTimeout(timer);
  }, [gamePhase, freezeCountdown]);

  // General Drawing Controller
  const executeSequentialDraw = (drawIndex: 1 | 2 | 3, excludedOverride?: number[]) => {
    setDrawNumber(drawIndex);
    setGamePhase('drawing');

    // Filter valid remaining slots
    const availableSpots: number[] = [];
    const currentExcluded = excludedOverride || [...vaporizedSlots, ...Object.values(winners)];
    
    for (let i = 1; i <= currentConfig.slots; i++) {
      if (activeGrid[i] && !currentExcluded.includes(i)) {
        availableSpots.push(i);
      }
    }

    // fallback
    if (availableSpots.length === 0) {
      availableSpots.push(Math.floor(Math.random() * currentConfig.slots) + 1);
    }

    const mappedKey = drawIndex === 1 ? 'first' : drawIndex === 2 ? 'second' : 'third';
    let matchedWinner: number;
    if (serverWinnersRef.current && serverWinnersRef.current[mappedKey]) {
      matchedWinner = serverWinnersRef.current[mappedKey];
    } else {
      matchedWinner = availableSpots[Math.floor(Math.random() * availableSpots.length)];
    }
    setCurrentWinner(matchedWinner);

    // Neon Lightning Blitz for mini, for grand we just start odometer immediately
    if (tier !== 'grand') {
      runNeonLightningBlitz(matchedWinner, drawIndex);
    } else {
      // Grand skips neon blitz
    }
  };

  // Neon Lightning Blitz loop
  const runNeonLightningBlitz = (finalWinner: number, drawIndex: 1 | 2 | 3) => {
    let currentDelay = 40; // Starts a bit slower
    const totalDuration = 20000; // 20s for all tiers
    const startTime = Date.now();

    // Create a list of available candidate coordinates for visual jumps
    const candidates = Array.from({ length: currentConfig.slots }, (_, i) => i + 1)
      .filter(num => activeGrid[num] && !vaporizedSlots.includes(num));

    const step = () => {
      if (!isMounted.current) return;
      const elapsed = Date.now() - startTime;
      
      // Suspenseful logic: initial build, mid-speed up, dramatic end slow down
      if (elapsed > totalDuration - 2500) {
        // Dramatic slow down at the end (last 2.5s)
        currentDelay = Math.min(currentDelay * 1.5, 1000);
      } else if (elapsed > totalDuration * 0.7) {
        // Slight acceleration in the middle for tension
        currentDelay = Math.max(currentDelay - 5, 20);
      } else {
        // Initial build-up
        currentDelay = Math.min(currentDelay + 2, 150);
      }

      // Select random candidate
      const nextTile = candidates[Math.floor(Math.random() * candidates.length)] || 1;
      setBlitzActiveTile(nextTile);
      playHapticAudio(500 + nextTile * 4); // sliding frequencies

      if (elapsed >= totalDuration) {
        // Lock and crown finalWinner visually
        setBlitzActiveTile(finalWinner);
        playHapticAudio(900);
        if (tier === 'mini') {
          trackTimeout(() => {
            finalizeDrawWinner(finalWinner, drawIndex);
          }, 1000);
        }
      } else {
        trackTimeout(step, currentDelay);
      }
    };

    trackTimeout(step, currentDelay);
  };

  // 3-Digit Mechanical Reels loop
  const runMechanicalReels = (finalWinner: number, drawIndex: 1 | 2 | 3) => {
    setHundredsSpinning(true);
    setTensSpinning(true);
    setOnesSpinning(true);

    // Calculate columns
    // Supports any 3-digit winner number up to 999
    const hDigit = finalWinner >= 100 ? Math.floor(finalWinner / 100).toString() : '0';
    const tDigit = Math.floor((finalWinner % 100) / 10).toString();
    const oDigit = (finalWinner % 10).toString();

    let spinsCount = 0;
    
    // Rapid reel shuffle interval (fast phase)
    const shuffleInterval = trackInterval(() => {
      if (hundredsSpinning) setReelHundred(Math.round(Math.random()).toString());
      if (tensSpinning) setReelTen(Math.floor(Math.random() * 10).toString());
      if (onesSpinning) setReelOne(Math.floor(Math.random() * 10).toString());
      playHapticAudio(400);
      spinsCount++;

      // Sequential slow down and locking
      if (spinsCount === 25) {
        // Lock Hundreds
        setHundredsSpinning(false);
        setReelHundred(hDigit);
        playHapticAudio(700);
      } else if (spinsCount === 42) {
        // Lock Tens
        setTensSpinning(false);
        setReelTen(tDigit);
        playHapticAudio(700);
      } else if (spinsCount === 60) {
        // Lock Ones
        clearInterval(shuffleInterval);
        setOnesSpinning(false);
        setReelOne(oDigit);
        playHapticAudio(900);

        // Announce winner
        trackTimeout(() => {
          finalizeDrawWinner(finalWinner, drawIndex);
        }, 500);
      }
    }, 90);
  };

  const finalizeDrawWinner = (winnerNum: number, drawIndex: 1 | 2 | 3) => {
    setWinners(prev => {
      const updated = { ...prev };
      if (drawIndex === 1) updated.first = winnerNum;
      else if (drawIndex === 2) updated.second = winnerNum;
      else updated.third = winnerNum;

      if (drawIndex === 3) {
        socket?.emit('grid_gameResult', { room: tier, roundId: currentRoundId, winners: { 1: updated.first, 2: updated.second, 3: updated.third } });
      }

      return updated;
    });

    setGamePhase('winner');
    playWinnerAudio();

    // Handle user payouts
    const isSelfWin = activeGrid[winnerNum]?.isSelf;
    const choiceStr = Object.entries(activeGrid)
      .filter(([_, value]: [any, any]) => value.isSelf)
      .map(([key, _]) => `#${key}`)
      .join(', ');
    const winNumStr = `#${winnerNum}`;
    const gameTypeWithDetails = `Jackpot ${tier} | R#${currentRoundId} | Choice:${choiceStr || '-'} | WinNum:${winNumStr}`;

    if (isSelfWin) {
      let prize = 0;
      if (drawIndex === 1) prize = currentConfig.p1;
      else if (drawIndex === 2) prize = currentConfig.p2;
      else prize = currentConfig.p3;

      setBalance(prev => {
        const newBalance = prev + prize;
        socket?.emit('logGamePlay', { userId, gameType: gameTypeWithDetails, result: `${drawIndex === 1 ? '1st' : drawIndex === 2 ? '2nd' : '3rd'} Place Win`, winAmount: prize, newBalance });
        socket?.emit('logTransaction', { userId, amount: prize, type: 'win', description: `🏆 Jackpot ${drawIndex}st Place Win!`, newBalance });
        return newBalance;
      });
      setTransactions(prev => [
        { id: Date.now(), type: 'win', desc: `🏆 Jackpot ${drawIndex}st Place Win!`, amount: prize, date: 'Just now', positive: true },
        ...prev
      ]);
      setGameHistory(prev => [
        {
          id: `R#${currentRoundId}`,
          type: `Jackpot ${tier}`,
          bet: currentConfig.entry,
          numbers: choiceStr || '-',
          winningNums: winNumStr,
          date: new Date().toLocaleString(),
          result: `${drawIndex === 1 ? '1st' : drawIndex === 2 ? '2nd' : '3rd'} Place Win`,
          change: prize,
          status: 'Completed'
        },
        ...prev
      ]);
      showNotification(`🎉 Congratulations! You won the Jackpot ${drawIndex === 1 ? '1st' : drawIndex === 2 ? '2nd' : '3rd'} Place Prize of ${prize.toLocaleString()} ETB!`, 'success');
    } else {
      const selfClaimed = Object.values(activeGrid).some((c: any) => c.isSelf);
      if (selfClaimed && drawIndex === 3) { // Only log miss on the 3rd draw for jackpot
           socket?.emit('logGamePlay', { userId, gameType: gameTypeWithDetails, result: 'Miss', winAmount: 0, newBalance: balance });
           setGameHistory(prev => [
             {
               id: `R#${currentRoundId}`,
               type: `Jackpot ${tier}`,
               bet: currentConfig.entry,
               numbers: choiceStr || '-',
               winningNums: winNumStr,
               date: new Date().toLocaleString(),
               result: 'Miss',
               change: 0,
               status: 'Completed'
             },
             ...prev
           ]);
      }
      showNotification(`Coordinate #${winnerNum} ([🔒 ${activeGrid[winnerNum]?.username || 'Player'}]) claims ${drawIndex === 1 ? '1st' : drawIndex === 2 ? '2nd' : '3rd'} Place!`, 'info');
    }

    // Wait 5 seconds, then vaporize this slot to proceed to the next slot draw
    trackTimeout(() => {
      setBlitzActiveTile(null);
      
      if (drawIndex < 3) {
        setGamePhase('vaporizing');
        const nextExcluded = [...vaporizedSlots, ...Object.values(winners), winnerNum];
        setVaporizedSlots(prev => [...prev, winnerNum]);
        
        // Wait 2.5 seconds in vaporization phase, then proceed
        trackTimeout(() => {
          executeSequentialDraw((drawIndex + 1) as 2 | 3, nextExcluded);
        }, 2200);
      } else {
        // Fully complete
        setGamePhase('complete');
        
        // Wait 6 seconds and restart the lobby
        trackTimeout(() => {
          resetLobby();
        }, 6000);
      }
    }, 5000);
  };

  const handleClaimSlot = (num: number) => {
    if (gamePhase !== 'lobby') {
      showNotification('Grid coordinates are currently locked for drawing!', 'error');
      return;
    }
    
    if (activeGrid[num]) {
      if (activeGrid[num].isSelf) {
        // Unclaim
        socket?.emit('grid_releaseSlot', { room: tier, num, userId }, (res: any) => {
           if (res?.success) {
              // The server handles balance updates and transaction logging
              socket?.emit('syncUser', userId, username, photoUrl);
              socket?.emit('getUserTransactions', userId);
              showNotification(`Unsecured Grid Position #${num}!`, 'success');
           }
        });
      } else {
        showNotification('This position is already allocated!', 'error');
      }
      return;
    }

    if (balance < currentConfig.entry) {
      showNotification('Insufficient balance to claim this slot!', 'error');
      return;
    }

    socket?.emit('grid_claimSlot', { room: tier, num, userId, username, photoUrl }, (res: any) => {
       if (res?.success) {
          // The server handles balance updates and transaction logging
          socket?.emit('syncUser', userId, username, photoUrl);
          socket?.emit('getUserTransactions', userId);
          setTransactions(prev => [
            { id: Date.now(), type: 'bet', desc: `Secured Spot #${num} in Jackpot`, amount: -currentConfig.entry, date: 'Just now', positive: false },
            ...prev
          ]);
          showNotification(`Secured Grid Position #${num}! Good Luck!`, 'success');
          if (userId) {
            fetch('/api/share/generate', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ referrer_id: userId, room_id: tier })
            })
            .then(r => r.json())
            .then(data => {
               if (data.success && data.token) {
                  setShareToken(data.token);
                  if (!sessionStorage.getItem('hasShownInviteModal')) {
                    setShowInviteModal(true);
                    sessionStorage.setItem('hasShownInviteModal', 'true');
                  }
               }
            })
            .catch(err => {
               console.warn("Failed to generate secure share token gracefully:", err);
            });
          }
       } else {
          showNotification(`Failed to secure: ${res?.message || 'Slot taken'}`, 'error');
       }
    });
  };

  const [userHiddenTheater, setUserHiddenTheater] = useState(false);

  useEffect(() => {
    if (gamePhase === 'lobby') {
      setUserHiddenTheater(false);
    }
  }, [gamePhase]);

  const isTheaterActive = gamePhase === 'drawing' || gamePhase === 'winner' || gamePhase === 'vaporizing' || gamePhase === 'complete';
  const showTheater = isTheaterActive && !userHiddenTheater;

  return (
    <div className="flex-1 flex flex-col justify-start">
      {showTheater && (
        <button
          onClick={() => setUserHiddenTheater(true)}
          className="absolute top-4 left-4 z-50 p-2 bg-zinc-800/80 backdrop-blur-sm rounded-full text-white transition-all hover:bg-zinc-700 shadow-lg"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      )}
      
      {/* Watch Live Button when drawing is hidden */}
      {isTheaterActive && userHiddenTheater && (
        <div className="mx-4 mt-2 mb-4">
          <button
            onClick={() => setUserHiddenTheater(false)}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-black rounded-xl text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg animate-pulse"
          >
            <Zap className="w-4 h-4 fill-zinc-950" /> Watch Live Draw
          </button>
        </div>
      )}

      {/* Room Category Tabs */}
      {!showTheater && (
        <>
          <div className="grid grid-cols-2 gap-2 bg-gray-200/60 dark:bg-gray-900/60 p-1 rounded-xl mb-4 shrink-0 border border-gray-300/40 dark:border-gray-800/40">
          <button
            onClick={() => gamePhase === 'lobby' && setTier('mini')}
            disabled={gamePhase !== 'lobby'}
            className={`py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              tier === 'mini'
                ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm font-black'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:dark:text-gray-200'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" /> VIP - 50 ሰው
          </button>
          <button
            onClick={() => gamePhase === 'lobby' && setTier('grand')}
            disabled={gamePhase !== 'lobby'}
            className={`py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              tier === 'grand'
                ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm font-black'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:dark:text-gray-200'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Crown className="w-3.5 h-3.5 text-yellow-500" /> VIP - 100 ሰው
          </button>
        </div>
        </>
      )}

      {/* 2-Digit Mechanical Odometer Reels (High-fidelity physical canvas reels) */}
      <AnimatePresence>
        {showTheater && currentWinner !== null && (
          tier === 'grand' ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-5 shrink-0 z-20"
            >
              <OdometerCanvas
                winner={currentWinner}
                onComplete={() => finalizeDrawWinner(currentWinner, drawNumber)}
                isDarkMode={isDarkMode}
                soundTicks={soundTicks && isActive}
                digits={tier === 'grand' ? 3 : 2}
                duration={tier === 'grand' ? 60.0 : 7.0}
              />
              <div className="mt-3 text-xs font-black uppercase text-amber-500 tracking-widest animate-pulse flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-500 animate-bounce" />
                <span>ROLLING FOR {drawNumber === 1 ? '1ST' : drawNumber === 2 ? '2ND' : '3RD'} PLACE SELECTION</span>
              </div>
              
              {tier === 'grand' && showTheater && (
                <div className="flex flex-col items-center justify-center gap-2 bg-zinc-950/90 p-4 rounded-2xl border border-zinc-800 w-full mt-0">
                  <h2 className="text-sm font-black text-amber-500 uppercase tracking-widest">Winners List</h2>
                  <div className="flex flex-col gap-1">
                    {winners.first && <div className="text-xs text-emerald-400 font-bold">1st Place: #{winners.first}</div>}
                    {winners.second && <div className="text-xs text-emerald-400 font-bold">2nd Place: #{winners.second}</div>}
                    {winners.third && <div className="text-xs text-emerald-400 font-bold">3rd Place: #{winners.third}</div>}
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-6 shrink-0 z-20 text-center"
            >
              <div className="flex flex-col items-center justify-center mb-3">
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-500 rounded-full text-xs font-black uppercase tracking-wider animate-pulse">
                  <Zap className="w-3.5 h-3.5 fill-amber-500/20 text-amber-500 animate-bounce" />
                  <span>VIP - 50 ሰው</span>
                </div>
              </div>
              <div className="mt-2 text-xs font-bold text-amber-400/80 bg-amber-500/5 border border-amber-500/10 px-4 py-1.5 rounded-full uppercase tracking-wider animate-pulse">
                Rolling for {drawNumber === 1 ? '1ST' : drawNumber === 2 ? '2ND' : '3RD'} Place
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>

      {/* 3D Trophy Podium Section (No label, placed under the selectors) */}
      {!showTheater && (
        <>
        <div className="bg-slate-950/50 p-2.5 rounded-2xl border border-zinc-800/60 mb-3 shadow-inner">
          <div className="flex items-end justify-center gap-2 pt-2 pb-1">
            
            {/* 2nd Place (Silver Trophy) */}
            <div className="flex flex-col items-center flex-1 max-w-[90px] text-center">
              <div className="relative">
                {/* Silver Crown */}
                <Crown className="w-4 h-4 text-zinc-400 fill-zinc-400/20 absolute -top-3.5 -right-0.5 rotate-12 drop-shadow-[0_0_3px_rgba(161,161,170,0.5)]" />
                {/* Silver Border Circle */}
                <div className="w-12 h-12 rounded-full border-2 border-zinc-400 bg-zinc-950/80 flex items-center justify-center shadow-[0_3px_8px_rgba(161,161,170,0.15)]">
                  <Trophy className="w-6 h-6 text-zinc-300 drop-shadow-[0_1px_4px_rgba(161,161,170,0.3)]" />
                </div>
                {/* Place Badge */}
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-zinc-500 text-[7px] font-black rounded-md text-white shadow-sm border border-zinc-400/30">
                  #2
                </span>
              </div>
              <div className="mt-2.5 w-full py-1 px-1 bg-zinc-800/80 border border-zinc-700/60 rounded-xl text-center shadow-md">
                <span className="font-mono text-[9px] font-black text-zinc-300">
                  {currentConfig.p2.toLocaleString()}
                </span>
                <span className="text-[7px] text-zinc-400 font-black ml-0.5">ETB</span>
              </div>
            </div>

            {/* 1st Place (Gold Trophy - Elevated) */}
            <div className="flex flex-col items-center flex-1 max-w-[100px] text-center -translate-y-1">
              <div className="relative scale-110">
                {/* Gold Crown */}
                <Crown className="w-5 h-5 text-amber-400 fill-amber-400/30 absolute -top-4.5 left-1/2 -translate-x-1/2 -rotate-12 drop-shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
                {/* Gold Border Circle */}
                <div className="w-14 h-14 rounded-full border-2 border-amber-400 bg-zinc-950/90 flex items-center justify-center shadow-[0_4px_12px_rgba(245,158,11,0.25)]">
                  <Trophy className="w-7 h-7 text-amber-400 drop-shadow-[0_1px_5px_rgba(245,158,11,0.5)]" />
                </div>
                {/* Place Badge */}
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-amber-500 text-[7px] font-black rounded-md text-zinc-950 shadow-md border border-amber-300">
                  #1
                </span>
              </div>
              <div className="mt-3.5 w-full py-1.5 px-1.5 bg-gradient-to-r from-amber-500 to-yellow-400 border border-amber-300 rounded-xl text-center shadow-[0_3px_8px_rgba(245,158,11,0.3)]">
                <span className="font-mono text-[10px] font-black text-zinc-950">
                  {currentConfig.p1.toLocaleString()}
                </span>
                <span className="text-[7px] text-zinc-900 font-black ml-0.5">ETB</span>
              </div>
            </div>

            {/* 3rd Place (Copper/Bronze Trophy) */}
            <div className="flex flex-col items-center flex-1 max-w-[90px] text-center">
              <div className="relative">
                {/* Bronze/Copper Crown */}
                <Crown className="w-4 h-4 text-orange-500 fill-orange-500/10 absolute -top-3.5 -left-0.5 -rotate-12 drop-shadow-[0_0_3px_rgba(249,115,22,0.5)]" />
                {/* Bronze Border Circle */}
                <div className="w-12 h-12 rounded-full border-2 border-orange-500/70 bg-zinc-950/80 flex items-center justify-center shadow-[0_3px_8px_rgba(249,115,22,0.15)]">
                  <Trophy className="w-6 h-6 text-orange-600/95 drop-shadow-[0_1px_4px_rgba(249,115,22,0.3)]" />
                </div>
                {/* Place Badge */}
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-orange-600 text-[7px] font-black rounded-md text-white shadow-sm border border-orange-500/30">
                  #3
                </span>
              </div>
              <div className="mt-2.5 w-full py-1 px-1 bg-orange-950/50 border border-orange-900/60 rounded-xl text-center shadow-md">
                <span className="font-mono text-[9px] font-black text-orange-400">
                  {currentConfig.p3.toLocaleString()}
                </span>
                <span className="text-[7px] text-orange-500 font-black ml-0.5">ETB</span>
              </div>
            </div>

          </div>
        </div>
        </>
      )}

      {/* Grid coordinates list with scroll support */}
      <div className={`flex-1 overflow-y-auto px-1 pr-2 pb-6 max-h-[420px] ${tier === 'grand' && gamePhase === 'drawing' ? 'opacity-0' : 'opacity-100'}`}>
        
        {/* Progress indicator bar (hidden during active drawing) */}
        {!showTheater && (
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2 px-1 gap-1.5">
              <span className="text-sm font-black uppercase text-blue-600 dark:text-blue-400 tracking-wider flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse inline-block shadow-sm" />
                {Object.keys(activeGrid).length}/{currentConfig.slots} Claimed
              </span>
              <div className="flex items-center gap-1.5">
                <div className="text-[10px] font-black uppercase text-blue-500 bg-blue-500/10 border border-blue-500/20 px-2.5 py-0.5 rounded-full tracking-widest font-mono">
                  Round #{currentRoundId}
                </div>
                <button
                  onClick={() => setIsInfoOpen(true)}
                  className="w-5 h-5 rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-all active:scale-95 cursor-pointer flex items-center justify-center shadow-md shadow-blue-500/20"
                  title="የጨዋታ መረጃ"
                >
                  <span className="font-serif font-black italic text-xs leading-none select-none">i</span>
                </button>
              </div>
            </div>
            {/* Visual real-time indicator bar */}
            <div className="w-full h-1.5 bg-gray-150 dark:bg-zinc-800 rounded-full overflow-hidden shadow-inner">
              <motion.div 
                className="h-full bg-blue-600 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${(Object.keys(activeGrid).length / currentConfig.slots) * 100}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
        )}

        {/* Dynamic coordinate tiles (Compact 8x13 and 7x8 structures) */}
        <div 
          className={`grid gap-1 ${showTheater ? 'opacity-20 pointer-events-none' : 'opacity-100'}`}
          style={{
            gridTemplateColumns: 'repeat(8, minmax(0, 1fr))'
          }}
        >
          {Array.from({ length: currentConfig.slots }, (_, i) => {
            const num = i + 1;
            const item = activeGrid[num];
            const isVaporized = vaporizedSlots.includes(num);
            const isWinner = Object.values(winners).includes(num);
            
            // Check if blitz is active on this coordinates slot (Dynamic visual trace)
            const isBlitzActive = blitzActiveTile === num;

            if (isVaporized) {
              return (
                <div 
                  key={num} 
                  className="aspect-square bg-gray-950/60 rounded-lg border border-dashed border-gray-800/30 flex flex-col items-center justify-center text-gray-700/20 text-[10px] font-black select-none"
                >
                  💨
                </div>
              );
            }

            if (item) {
              return (
                <motion.div
                  key={num}
                  onClick={() => handleClaimSlot(num)}
                  whileTap={{ scale: 0.95 }}
                  className={`aspect-square rounded-lg border flex flex-col items-center justify-center p-0.5 cursor-pointer transition-all relative overflow-hidden ${
                    isWinner 
                      ? 'bg-gradient-to-b from-green-500 to-green-600 border-green-400 text-white shadow-lg scale-105 z-10'
                      : isBlitzActive
                      ? 'bg-amber-500 border-amber-300 text-white scale-110 z-20 shadow-[0_0_15px_#f59e0b] ring-2 ring-amber-400 animate-pulse !opacity-100'
                      : item.isSelf
                      ? 'bg-gradient-to-b from-blue-600 to-indigo-700 border-blue-400 text-white shadow-xs'
                      : 'bg-gray-800 border-gray-700 text-gray-300'
                  }`}
                  style={isBlitzActive ? { opacity: 1 } : undefined}
                >
                  {item.photoUrl && !isBlitzActive && !isWinner ? (
                     <div className="absolute inset-0 opacity-20 pointer-events-none">
                       <img src={item.photoUrl} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                     </div>
                  ) : null}
                  
                  <span className="text-[10px] font-black font-mono leading-none z-10">{num}</span>
                  <div className="flex items-center gap-0.5 text-[6px] font-semibold tracking-tighter mt-0.5 truncate max-w-full leading-none z-10">
                    {item.photoUrl ? (
                      <img src={item.photoUrl} alt="Avatar" className="w-2 h-2 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
                    ) : (
                      <Lock className="w-1.5 h-1.5 shrink-0" />
                    )}
                    <span className="truncate max-w-[24px]">{item.isSelf ? 'You' : item.username}</span>
                  </div>
                </motion.div>
              );
            }

            return (
              <motion.button
                key={num}
                onClick={() => handleClaimSlot(num)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                className={`aspect-square rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 flex flex-col items-center justify-center p-0.5 shadow-xs hover:border-blue-400 transition-all ${
                  isBlitzActive
                    ? 'bg-amber-500 border-amber-300 text-white scale-110 z-20 shadow-[0_0_15px_#f59e0b] ring-2 ring-amber-400 animate-pulse !opacity-100'
                    : ''
                }`}
                style={isBlitzActive ? { opacity: 1 } : undefined}
              >
                <span className="text-[10px] font-black font-mono text-gray-900 dark:text-gray-100 leading-none">{num}</span>
                <span className="text-[7px] font-black text-blue-600 dark:text-blue-400 tracking-tighter mt-0.5">2K</span>
              </motion.button>
            );
          })}
        </div>

        {/* Jackpot Recent History at the bottom of the scroll view */}
        {currentHistory.length > 0 && gamePhase === 'lobby' && (
          <div className="bg-gray-100 dark:bg-zinc-950/60 border border-gray-200 dark:border-zinc-800/80 rounded-2xl p-4 shadow-xl mt-4">
            <h3 className="text-[10px] font-black uppercase text-gray-500 dark:text-zinc-500 tracking-wider flex items-center gap-1.5 mb-3">
              <RefreshCw className="w-3 h-3" /> Recent Winners
            </h3>
            <div className="space-y-2">
              {currentHistory.map((h, index) => (
                <div key={`${h.roundId}-${index}`} className="flex justify-between items-center text-xs bg-gray-50 dark:bg-zinc-950/50 p-2.5 rounded-xl border border-gray-100 dark:border-zinc-800/40">
                  <span className="font-black text-gray-400 dark:text-zinc-400">#{h.roundId}</span>
                  <div className="flex gap-1.5 font-mono font-bold">
                    {h.winners[1] && <span className="text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-lg text-[10px]">1st-#{h.winners[1]}</span>}
                    {h.winners[2] && <span className="text-zinc-400 bg-zinc-400/10 border border-zinc-400/20 px-2 py-0.5 rounded-lg text-[10px]">2nd-#{h.winners[2]}</span>}
                    {h.winners[3] && <span className="text-amber-600 bg-amber-600/10 border border-amber-600/20 px-2 py-0.5 rounded-lg text-[10px]">3rd-#{h.winners[3]}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Global Locked Phase 1 Translucent Modal overlay */}
      {gamePhase === 'freeze' && (
        <div className="absolute inset-0 bg-black/20 z-50 rounded-2xl flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 rounded-3xl max-w-xs mx-auto shadow-2xl"
          >
            <div className="w-14 h-14 bg-red-100 dark:bg-red-950/40 rounded-full flex items-center justify-center mx-auto mb-3">
              <Lock className="w-7 h-7 text-red-500 animate-pulse" />
            </div>
            <h2 className="text-base font-black text-gray-900 dark:text-white uppercase tracking-wider mb-4">Good Luck!</h2>
            <div className="text-4xl font-mono font-black text-red-500 animate-pulse">{freezeCountdown}</div>
          </motion.div>
        </div>
      )}

      {/* Winners Overlay Popup */}
      <AnimatePresence>
        {gamePhase === 'winner' && (
          <div className="absolute inset-0 bg-black/20 z-50 rounded-2xl flex flex-col items-center justify-center p-6 text-center">
            {(() => {
              // Extract matching winner number based on active drawIndex
              const winnerNum = drawNumber === 1 ? winners.first : drawNumber === 2 ? winners.second : winners.third;
              if (!winnerNum) return null;

              return (
                <motion.div
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.85, opacity: 0 }}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 rounded-3xl max-w-xs mx-auto shadow-2xl"
                >
                  <div className="text-4xl mb-2">🎉</div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {drawNumber === 1 ? '1st Place Winner Is:' : drawNumber === 2 ? '2nd Place Winner Is:' : '3rd Place Winner Is:'}
                  </h2>
                  <div className="text-5xl font-black text-gray-900 dark:text-white my-3 animate-bounce tracking-tight font-mono">
                    {winnerNum}
                  </div>
                  <div className="text-[10px] font-black uppercase text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1 rounded-full inline-block border border-indigo-100 dark:border-indigo-900/30">
                    [🔒 {activeGrid[winnerNum]?.username || 'Player'}]
                  </div>
                  <div className="text-xs text-gray-500 mt-3 font-semibold">
                    Prize payout: <span className="font-mono text-green-600 dark:text-green-400 font-bold">
                      {(drawNumber === 1 ? currentConfig.p1 : drawNumber === 2 ? currentConfig.p2 : currentConfig.p3).toLocaleString()} ETB
                    </span>
                  </div>
                </motion.div>
              );
            })()}
          </div>
        )}
      </AnimatePresence>

      {/* Jackpot Arena Info Modal */}
      <AnimatePresence>
        {isInfoOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100] flex items-center justify-center p-4 max-w-md mx-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 shadow-2xl relative w-full max-h-[85vh] overflow-y-auto"
            >
              <button
                onClick={() => setIsInfoOpen(false)}
                className="absolute top-4 right-4 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2.5 mb-4 text-blue-600 dark:text-blue-400">
                <Info className="w-6 h-6 fill-blue-500/10" />
                <h2 className="text-lg font-black tracking-tight">ዕድል (Jackpot Arena)</h2>
              </div>

              <div className="text-sm space-y-4 text-gray-700 dark:text-gray-300 leading-relaxed font-medium">
                <p>ተጫዋቾች በጋራ የቁጥር ሰሌዳ (Grid) ላይ ያሉ ቦታዎችን በመግዛት ከፍተኛ የገንዘብ ሽልማት (Jackpot Pool) ለማሸነፍ የሚወዳደሩበት ትልቅ ጨዋታ ነው።</p>
                <p><strong>እንዴት እንደሚጫወት፦</strong> ተጫዋቾች ከቀረቡት የቁጥር ሳጥኖች (Slots) ውስጥ የፈለጉትን የቁጥር ቦታዎች በመግዛት ዕጣቸውን ይጠብቃሉ። ሁሉም ቦታዎች ሲያልቁ ወይም ሰዓቱ ሲጠናቀቅ ዕጣው ይወጣል።</p>

                <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
                  <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-1.5">ዋና ዋና ባህሪያት፦</h3>
                  
                  <div className="space-y-2 text-xs">
                    <div>
                      <h4 className="font-bold text-blue-600 dark:text-blue-400">ሁለት የጃክፖት ደረጃዎች፦</h4>
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li><strong>Mini Jackpot፦</strong> 50 የቁጥር ቦታዎች (Slots) አሉት። የመግቢያ ዋጋ 2,000 ETB ነው።</li>
                        <li><strong>Grand Jackpot፦</strong> 100 የቁጥር ቦታዎች (Slots) አሉት። የመግቢያ ዋጋ 2,000 ETB ነው።</li>
                      </ul>
                    </div>

                    <div className="mt-2">
                      <strong>የአሸናፊዎች አወጣጥ፦</strong> ሰሌዳው ሙሉ በሙሉ ሲሞላ፣ ከፍተኛ ጥራት ባለውና በሚሽከረከር የኦዶሜትር (Odometer) የዕጣ ማውጫ አማካኝነት ለ 1ኛ፣ 2ኛ እና 3ኛ ደረጃ አሸናፊዎች ዕጣ ይወጣል።
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
                  <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-1.5">የሽልማት ክፍፍል፦</h3>
                  <ul className="list-disc pl-5 space-y-1 text-xs">
                    <li><strong>Mini Jackpot፦</strong> 1ኛ ደረጃ 72,000 ETB፣ 2ኛ ደረጃ 12,600 ETB፣ 3ኛ ደረጃ 5,400 ETB ያገኛሉ።</li>
                    <li><strong>Grand Jackpot፦</strong> 1ኛ ደረጃ 144,000 ETB፣ 2ኛ ደረጃ 25,200 ETB፣ 3ኛ ደረጃ 10,800 ETB ያገኛሉ።</li>
                  </ul>
                </div>
              </div>

              <button
                onClick={() => setIsInfoOpen(false)}
                className="w-full mt-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all active:scale-95 cursor-pointer shadow-md shadow-blue-500/25"
              >
                እሺ ተረዳሁ
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Invite Modal for fill the room speed share */}
      <AnimatePresence>
        {showInviteModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative text-center"
            >
              <button
                onClick={() => setShowInviteModal(false)}
                className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-900 text-gray-400 hover:text-gray-600 transition cursor-pointer"
              >
                <X size={18} />
              </button>

              <div className="w-12 h-12 bg-blue-500/10 dark:bg-blue-500/25 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center mx-auto mb-4">
                <Zap size={24} className="animate-pulse" />
              </div>

              <h3 className="text-lg font-black text-gray-900 dark:text-white mb-2">
                ⚡ Fill the Room Faster!
              </h3>
              
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
                You've secured your position! Invite friends to claim the remaining slots. The grand drawing launches the microsecond the room is full!
              </p>

              <div className="space-y-3">
                <button
                  onClick={() => {
                    const link = `https://t.me/ETBGameHubBot/app?startapp=${shareToken}`;
                    const text = `🎮 Join my room in ETB Game Hub! Let's fill the slots and play together! 🚀`;
                    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
                    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
                      window.Telegram.WebApp.openTelegramLink(shareUrl);
                    } else {
                      window.open(shareUrl, "_blank");
                    }
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition shadow-md cursor-pointer active:scale-95"
                >
                  <Zap size={16} /> Share on Telegram
                </button>

                <button
                  onClick={() => {
                    const link = `https://t.me/ETBGameHubBot/app?startapp=${shareToken}`;
                    navigator.clipboard.writeText(link);
                    showNotification("Invite link copied to clipboard!", "success");
                  }}
                  className="w-full bg-gray-100 dark:bg-gray-900 hover:bg-gray-200 dark:hover:bg-gray-850 text-gray-700 dark:text-gray-300 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer active:scale-95"
                >
                  Copy Invite Link
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
});
