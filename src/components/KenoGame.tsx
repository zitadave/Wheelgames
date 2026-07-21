
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, History, TrendingUp, Plus, Minus, HelpCircle, Gamepad2, ArrowDownWideNarrow, X } from 'lucide-react';

interface KenoGameProps {
  balance: number;
  userId: string;
  username?: string;
  onPlaceBet: (numbers: number[], amount: number) => void;
  socket: any;
  countdown: number;
  gameState: 'betting' | 'draw' | 'result';
  setGameState: (state: 'betting' | 'draw' | 'result') => void;
  drawNumbers: number[];
  setBalance: React.Dispatch<React.SetStateAction<number | null>>;
}

const PAYOUTS: Record<number, number[]> = {
  // Matches: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  1: [0, 2.5],
  2: [0, 0, 6],
  3: [0, 0, 1, 20],
  4: [0, 0, 1, 5, 40],
  5: [0, 0, 0, 2, 12, 80],
  6: [0, 0, 0, 1.5, 6, 30, 250],
  7: [1, 0, 0, 2, 4, 20, 80, 500],
  8: [1, 0, 0, 0, 3, 10, 40, 150, 1000],
  9: [2, 0, 0, 0, 2, 6, 20, 80, 500, 2500],
  10: [2, 0, 0, 0, 0, 3, 15, 50, 200, 1000, 5000]
};

const AMHARIC_PAYOUT_MATRIX = [
  { match: 0, pays: [null, null, null, null, null, null, 1, 1, 2, 2] },
  { match: 1, pays: [2.5, null, null, null, null, null, null, null, null, null] },
  { match: 2, pays: [null, 6, 1, 1, null, null, null, null, null, null] },
  { match: 3, pays: [null, null, 20, 5, 2, 1.5, 2, null, null, null] },
  { match: 4, pays: [null, null, null, 40, 12, 6, 4, 3, 2, null] },
  { match: 5, pays: [null, null, null, null, 80, 30, 20, 10, 6, 3] },
  { match: 6, pays: [null, null, null, null, null, 250, 80, 40, 15, 15] },
  { match: 7, pays: [null, null, null, null, null, null, 500, 150, 80, 50] },
  { match: 8, pays: [null, null, null, null, null, null, null, 1000, 500, 200] },
  { match: 9, pays: [null, null, null, null, null, null, null, null, 2500, 1000] },
  { match: 10, pays: [null, null, null, null, null, null, null, null, null, 5000] }
];

const getMinRequiredMatches = (length: number): number => {
  const list = PAYOUTS[length];
  if (!list) return 0;
  for (let i = 1; i < list.length; i++) {
    if (list[i] > 0) return i;
  }
  return 999;
};

const Ball3D = ({ number, isMatch, size = "md", className = "" }: { number: number, isMatch?: boolean, size?: "sm" | "md" | "lg", className?: string, key?: any }) => {
  const sizeClasses = {
    sm: "w-8 h-8 text-[11px]",
    md: "w-[44px] h-[44px] text-[13px]",
    lg: "w-20 h-20 text-[28px]"
  };

  return (
    <div 
      className={`${sizeClasses[size]} rounded-full relative flex items-center justify-center font-black shadow-lg ${className}`}
      style={{
        background: isMatch 
          ? 'radial-gradient(circle at 30% 30%, #4ae38d 0%, #2ecc71 40%, #1e8449 100%)'
          : 'radial-gradient(circle at 30% 30%, #4a5a5a 0%, #2a3a3a 40%, #000000 100%)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: isMatch ? '#1a2525' : '#ffffff'
      }}
    >
      {/* Highlight Reflection */}
      <div className="absolute top-[10%] left-[20%] w-[35%] h-[25%] bg-white/30 rounded-[100%] blur-[1px] rotate-[-20deg]" />
      {/* Shadow Overlay */}
      <div className="absolute inset-0 rounded-full shadow-[inset_0_-4px_8px_rgba(0,0,0,0.4)]" />
      {number}
    </div>
  );
};

export function KenoGame({ balance, userId, username, onPlaceBet, socket, countdown, gameState, setGameState, drawNumbers: serverDrawNumbers, setBalance }: KenoGameProps) {
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [betAmount, setBetAmount] = useState<number>(5);
  const [activeTab, setActiveTab] = useState<'GAME' | 'HISTORY' | 'RESULTS' | 'STATISTICS'>('GAME');
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [drawNumbers, setDrawNumbers] = useState<number[]>([]);
  const [currentDrawIndex, setCurrentDrawIndex] = useState(-1);
  const [isBallInHeader, setIsBallInHeader] = useState(false);
  const [gameId, setGameId] = useState('870909999');
  const [activeTickets, setActiveTickets] = useState<any[]>([]);
  const [otherPlayersBets, setOtherPlayersBets] = useState<any[]>([]);
  const [gameSubTab, setGameSubTab] = useState<'all' | 'mine'>('all');
  const [serverHistory, setServerHistory] = useState<any[]>([]);
  const [myBetHistory, setMyBetHistory] = useState<any[]>([]);

  // Subscribe to real-time Keno state and synchronize bets/draws/history
  useEffect(() => {
    if (!socket || !userId) return;

    const handleKenoState = (state: any) => {
      if (state.roundId) {
        setGameId(state.roundId);
      }
      if (state.history) {
        setServerHistory(state.history);
      }

      if (state.bets) {
        // Partition into current user's active tickets and other players' bets
        const mine = state.bets
          .filter((b: any) => b.userId === userId)
          .map((b: any, index: number) => ({
            id: b.id,
            numbers: b.numbers,
            bet: b.bet,
            timestamp: b.timestamp,
            isMine: true,
            displayId: index + 1
          }));

        const others = state.bets
          .filter((b: any) => b.userId !== userId)
          .map((b: any) => {
            const maskedName = b.username.length > 2
              ? b.username.slice(0, 1) + '***' + b.username.slice(-1)
              : b.username + '***';
            return {
              id: maskedName,
              numbers: b.numbers,
              bet: b.bet,
              timestamp: b.timestamp,
              isMine: false
            };
          });

        // Sort descending by timestamp
        mine.sort((a: any, b: any) => b.timestamp - a.timestamp);
        others.sort((a: any, b: any) => b.timestamp - a.timestamp);

        setActiveTickets(mine);
        setOtherPlayersBets(others);
      }
    };

    socket.on('keno_state', handleKenoState);
    return () => {
      socket.off('keno_state', handleKenoState);
    };
  }, [socket, userId]);

  // Load user game logs from database dynamically for the HISTORY tab
  useEffect(() => {
    if (!socket || !userId) return;

    const handleUserGameLogs = (logs: any[]) => {
      const kenoLogs = logs
        .filter(log => log.user_id === userId && log.game_type?.startsWith('Keno'))
        .map(log => {
          let roundId = '';
          let numbers: number[] = [];
          let winNum: number[] = [];
          let betAmountVal = 5; // Fallback

          const parts = log.game_type.split(' | ');
          for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed.startsWith('R#')) {
              roundId = trimmed.substring(2);
            } else if (trimmed.startsWith('Choice:')) {
              numbers = trimmed.substring(7).split(',').map(Number);
            } else if (trimmed.startsWith('Bet:')) {
              betAmountVal = Number(trimmed.substring(4));
            } else if (trimmed.startsWith('WinNum:')) {
              winNum = trimmed.substring(7).split(',').map(Number);
            }
          }

          // Calculate hits
          const hits = numbers.filter(n => winNum.includes(n));

          return {
            id: roundId,
            time: new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            bet: betAmountVal,
            numbers,
            hits,
            winAmount: log.win_amount,
            result: log.result
          };
        });
      setMyBetHistory(kenoLogs);
    };

    socket.on('userGameLogs', handleUserGameLogs);
    // Request them initially
    socket.emit('getUserGameLogs', userId);

    return () => {
      socket.off('userGameLogs', handleUserGameLogs);
    };
  }, [socket, userId]);
  
  const [statsSortMode, setStatsSortMode] = useState<'number' | 'frequency'>('number');
  const [numberStats, setNumberStats] = useState<{ number: number; frequency: number }[]>(() => {
    return Array.from({ length: 80 }, (_, i) => ({
      number: i + 1,
      frequency: 0
    }));
  });

  // Dynamically compute frequency stats whenever serverHistory changes (source of truth from real-time database history)
  useEffect(() => {
    if (serverHistory && serverHistory.length > 0) {
      const counts = Array(81).fill(0);
      for (const round of serverHistory) {
        if (round.balls) {
          for (const num of round.balls) {
            if (num >= 1 && num <= 80) {
              counts[num]++;
            }
          }
        }
      }
      setNumberStats(
        Array.from({ length: 80 }, (_, i) => ({
          number: i + 1,
          frequency: counts[i + 1]
        }))
      );
    }
  }, [serverHistory]);
  
  // Dynamically compute Hot/Cold numbers based on real draw statistics, falling back to empty if no history
  const hotNumbers = [...numberStats]
    .filter(item => item.frequency > 0)
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 5)
    .map(item => item.number);

  const coldNumbers = [...numberStats]
    .sort((a, b) => a.frequency - b.frequency)
    .slice(0, 5)
    .map(item => item.number);

  const drawStartedRef = useRef(false);
  const payoutAddedRef = useRef(false);
  const drawIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const getTicketStats = (ticketNumbers: number[]) => {
    const matchedNumbers = ticketNumbers.filter(n => drawNumbers.slice(0, currentDrawIndex + 1).includes(n));
    const payoutMult = PAYOUTS[ticketNumbers.length]?.[matchedNumbers.length] || 0;
    return {
      matchedNumbers,
      payout: payoutMult * betAmount,
      isWinner: payoutMult > 0,
      payoutMult
    };
  };

  useEffect(() => {
    // Force start the draw whenever gameState becomes 'draw' and we have numbers
    if (gameState === 'draw' && serverDrawNumbers.length === 20 && !drawStartedRef.current) {
      drawStartedRef.current = true;
      payoutAddedRef.current = false;
      startDraw(serverDrawNumbers);
    } else if (gameState === 'betting') {
      drawStartedRef.current = false;
      payoutAddedRef.current = false;
      setDrawNumbers([]);
      setCurrentDrawIndex(-1);
      setIsBallInHeader(false);
    }
  }, [gameState, serverDrawNumbers]);

  useEffect(() => {
    if (gameState === 'result' && !payoutAddedRef.current) {
      if (drawIntervalRef.current) clearInterval(drawIntervalRef.current);
      setCurrentDrawIndex(19);
      payoutAddedRef.current = true;

      // Dynamic frequency updates on completed draws
      if (serverDrawNumbers && serverDrawNumbers.length > 0) {
        setNumberStats(prev => prev.map(item => {
          if (serverDrawNumbers.includes(item.number)) {
            return { ...item, frequency: item.frequency + 1 };
          }
          return item;
        }));
      }
    }
  }, [gameState, activeTickets, serverDrawNumbers]);

  const startDraw = (nums: number[]) => {
    setGameState('draw');
    setDrawNumbers(nums);
    setCurrentDrawIndex(-1);
    setIsBallInHeader(false);
    
    let index = 0;
    if (drawIntervalRef.current) clearInterval(drawIntervalRef.current);
    drawIntervalRef.current = setInterval(() => {
      setCurrentDrawIndex(index);
      setIsBallInHeader(true);
      
      // Pause for 0.4s in the header, then move to grid
      setTimeout(() => {
        setIsBallInHeader(false);
      }, 400);

      index++;
      if (index >= 20) {
        if (drawIntervalRef.current) clearInterval(drawIntervalRef.current);
      }
    }, 1600); 
  };

  const toggleNumber = (num: number) => {
    if (gameState !== 'betting') return;
    if (selectedNumbers.includes(num)) {
      setSelectedNumbers(prev => prev.filter(n => n !== num));
    } else if (selectedNumbers.length < 10) {
      setSelectedNumbers(prev => [...prev, num]);
    }
  };

  const handleBet = () => {
    if (selectedNumbers.length === 0) return;
    
    // Ensure betAmount is at least 5 and does not exceed balance
    let validatedBetAmount = Math.max(5, betAmount);
    if (balance !== null && validatedBetAmount > balance) {
      validatedBetAmount = Math.max(5, balance);
    }
    setBetAmount(validatedBetAmount);

    onPlaceBet(selectedNumbers, validatedBetAmount);
    setSelectedNumbers([]); // Clear selected numbers so they can continue selecting for other bets
  };

  const matches = selectedNumbers.filter(n => drawNumbers.slice(0, currentDrawIndex + 1).includes(n)).length;

  return (
    <div className="flex flex-col h-full bg-[#202c2c] text-white font-sans overflow-hidden w-full">
      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto no-scrollbar w-full">
        <AnimatePresence mode="wait">
          {gameState === 'draw' || gameState === 'result' ? (
            <div className="flex flex-col">
              {/* Draw Header / Win Display */}
              <div className="flex flex-col items-center justify-center py-2 px-4 bg-radial-[at_50%_50%] from-[#354646] to-[#202c2c] relative overflow-hidden min-h-[140px] border-b border-gray-800/20">
                {gameState === 'result' ? (
                  <motion.div 
                    key="win-message"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex flex-col items-center z-20"
                  >
                    {activeTickets.some(t => getTicketStats(t.numbers).payoutMult > 0) ? (
                      <>
                        <div className="text-[#2ecc71] text-3xl font-black uppercase tracking-[0.2em] drop-shadow-[0_0_12px_rgba(46,204,113,0.6)] mb-1">
                          YOU WIN
                        </div>
                        <div className="text-[#2ecc71] text-4xl font-black drop-shadow-[0_0_10px_rgba(46,204,113,0.5)]">
                          {activeTickets.reduce((sum, t) => {
                            const stats = getTicketStats(t.numbers);
                            return sum + (stats.payoutMult * t.bet);
                          }, 0).toLocaleString()}
                        </div>
                      </>
                    ) : (
                      <div className="text-[#2ecc71] text-3xl font-black uppercase tracking-[0.2em] drop-shadow-[0_0_12px_rgba(46,204,113,0.6)]">
                        TRY AGAIN
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <div className="relative">
                    <div className="absolute inset-0 bg-[#2ecc71]/5 blur-3xl rounded-full scale-150 animate-pulse" />
                    <AnimatePresence mode="popLayout">
                      {currentDrawIndex >= 0 && isBallInHeader && (
                        <motion.div 
                          key={`header-${drawNumbers[currentDrawIndex]}`}
                          layoutId={`ball-${drawNumbers[currentDrawIndex]}`}
                          initial={{ scale: 0, opacity: 0, y: -20 }}
                          animate={{ scale: 1, opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ 
                            type: "spring", 
                            stiffness: 260, 
                            damping: 20
                          }}
                          className="relative z-10 flex items-center justify-center"
                        >
                          <Ball3D 
                            number={drawNumbers[currentDrawIndex]} 
                            size="lg" 
                            isMatch={selectedNumbers.includes(drawNumbers[currentDrawIndex]) || activeTickets.some(t => t.numbers.includes(drawNumbers[currentDrawIndex]))} 
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}



                <div className="absolute top-4 right-6 font-mono font-black text-white/30 text-[11px] italic tracking-tighter">
                   <span className="text-white/60">{currentDrawIndex >= 0 ? currentDrawIndex + 1 : 0}</span> / 20
                </div>
              </div>

              {/* History Grid (2 rows of 10) */}
              <div className="px-2 py-4 sm:p-4 bg-[#202c2c]">
                <div className="grid grid-cols-10 gap-1 sm:gap-1.5 max-w-3xl mx-auto">
                  {Array.from({ length: 20 }).map((_, i) => {
                    const isCurrent = i === currentDrawIndex;
                    const num = (i < currentDrawIndex || (isCurrent && !isBallInHeader)) 
                                 ? drawNumbers[i] : null;
                    const isMatch = num !== null && (selectedNumbers.includes(num) || activeTickets.some(t => t.numbers.includes(num)));
                    
                    return (
                      <div 
                        key={i} 
                        className="aspect-square relative flex items-center justify-center"
                      >
                        {num !== null ? (
                          <motion.div
                            layoutId={`ball-${num}`}
                            className="w-full h-full"
                            initial={false}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{
                              type: "spring",
                              stiffness: 260,
                              damping: 25
                            }}
                          >
                            <Ball3D number={num} isMatch={isMatch} size="md" className="w-full h-full" />
                          </motion.div>
                        ) : (
                          <div className="w-full h-full rounded-full border border-gray-800/10 bg-gray-900/5" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <motion.div 
              key="betting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pb-0"
            >
              {/* Dynamic Header */}
              <div className="px-4 pt-4 pb-2">
                {selectedNumbers.length === 0 ? (
                  <div className="bg-[#1a2525]/40 rounded-xl p-4 border border-gray-800/30 flex items-center justify-between gap-4 relative overflow-hidden">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-[#2ecc71]/20 flex items-center justify-center relative shrink-0">
                        <div className="absolute inset-0 bg-[#2ecc71]/10 rounded-full animate-ping" />
                        <div className="w-6 h-6 border-t-8 border-t-transparent border-b-8 border-b-transparent border-l-10 border-l-[#2ecc71] ml-1" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xl font-black text-white leading-tight">Choose 10 numbers</span>
                        <span className="text-[#2ecc71] font-bold text-sm">From 1 to 80</span>
                      </div>
                    </div>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowInfoModal(true);
                      }}
                      className="w-8 h-8 rounded-full border border-white/10 bg-white/5 flex items-center justify-center text-gray-400 hover:text-[#2ecc71] hover:border-[#2ecc71]/40 hover:bg-white/10 transition-all cursor-pointer focus:outline-none shrink-0"
                    >
                      <HelpCircle className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="bg-[#2a3a3a]/80 rounded-xl p-3 py-2 border border-white/10 flex flex-col gap-1 relative overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]">
                    {/* Header: Bet Amount + Possible Win */}
                    <div className="flex justify-between items-center px-1">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-black text-white drop-shadow-sm">{betAmount}</span>
                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">POSSIBLE WIN</span>
                        <span className="text-lg font-black text-[#2ecc71] drop-shadow-[0_0_10px_rgba(46,204,113,0.3)]">
                          {(betAmount * Math.max(...(PAYOUTS[selectedNumbers.length] || [0]))).toLocaleString()}
                        </span>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowInfoModal(true);
                        }}
                        className="w-7 h-7 rounded-full border border-white/10 bg-white/5 flex items-center justify-center text-gray-400 hover:text-[#2ecc71] hover:border-[#2ecc71]/40 hover:bg-white/10 transition-all cursor-pointer focus:outline-none"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Horizontal Payout Table with Lines */}
                    <div className="flex flex-col gap-0 bg-black/20 rounded p-1 mb-1 border border-white/5">
                      {/* Match Row */}
                      <div className="flex items-center">
                        <span className="w-14 text-[10px] font-black text-gray-600 uppercase tracking-widest shrink-0">Match</span>
                        <div className="flex-1 flex justify-between items-center h-6 px-1">
                          {(PAYOUTS[selectedNumbers.length] || [])
                            .map((p, i) => ({ p, i }))
                            .filter(item => item.p > 0)
                            .map((item, idx, arr) => (
                              <span 
                                key={item.i} 
                                className={`text-[11px] font-black min-w-[22px] text-center ${idx === arr.length - 1 ? 'text-[#2ecc71]' : 'text-gray-500'}`}
                              >
                                {item.i}
                              </span>
                            ))}
                        </div>
                      </div>

                      {/* Separator Line Top */}
                      <div className="ml-14 h-[1px] bg-white/5 rounded-full" />

                      {/* Pays Row */}
                      <div className="flex items-center">
                        <span className="w-14 text-[10px] font-black text-gray-600 uppercase tracking-widest shrink-0">Pays</span>
                        <div className="flex-1 flex justify-between items-center h-6 px-1">
                          {(PAYOUTS[selectedNumbers.length] || [])
                            .map((p, i) => ({ p, i }))
                            .filter(item => item.p > 0)
                            .map((item, idx, arr) => (
                              <span 
                                key={item.i} 
                                className={`text-[11px] font-black min-w-[22px] text-center ${idx === arr.length - 1 ? 'text-[#2ecc71]' : 'text-white/30'}`}
                              >
                                x{item.p}
                              </span>
                            ))}
                        </div>
                      </div>
                    </div>

                    {/* Selected Numbers Preview Row */}
                    <div className="grid grid-cols-10 gap-1 w-full mt-0.5">
                      {Array.from({ length: 10 }).map((_, i) => {
                        const num = selectedNumbers[i];
                        return (
                          <div 
                            key={i} 
                            className={`aspect-square rounded flex items-center justify-center text-[11px] font-black transition-all ${
                              num 
                                ? 'bg-[#2f3f3f] text-white border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_2px_4px_rgba(0,0,0,0.2)]' 
                                : 'bg-gray-800/10 border border-white/5'
                            }`}
                          >
                            {num || ''}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Number Grid */}
              <div className="grid grid-cols-10 gap-[5px] p-2 bg-[#202c2c] border-y border-gray-800/20 mt-2">
                {Array.from({ length: 80 }, (_, i) => i + 1).map(num => {
                  const isSelected = selectedNumbers.includes(num);
                  const isInActiveTicket = activeTickets.some(t => t.numbers.includes(num));
                  const isDrawn = drawNumbers.slice(0, currentDrawIndex + 1).includes(num);
                  const isHit = isDrawn && (isSelected || isInActiveTicket);
                  const isHot = hotNumbers.includes(num);
                  const isCold = coldNumbers.includes(num);
                  
                    return (
                      <button 
                        key={num}
                        onClick={() => toggleNumber(num)}
                        className={`
                          aspect-square relative flex items-center justify-center text-[12px] sm:text-[13px] font-black transition-all rounded-lg
                          ${(isSelected || isHit) 
                            ? 'bg-[#2ecc71] text-[#202c2c] z-10 shadow-[0_6px_15px_rgba(46,204,113,0.4),inset_0_2px_4px_rgba(255,255,255,0.4),inset_0_-2px_4px_rgba(0,0,0,0.2)] scale-[1.05]' 
                            : isDrawn
                              ? 'bg-white text-[#202c2c] z-10 shadow-[0_0_15px_rgba(255,255,255,0.5)] scale-[1.02]'
                              : 'bg-[#354646] text-gray-400 hover:bg-[#405656] border border-white/5 shadow-[0_2px_4px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.05)]'
                          }
                        `}
                      >
                      {num}
                      {/* Hot/Cold Indicators as dots in the corners */}
                      {isHot && (
                        <div className="absolute top-1 right-1 w-1 h-1 rounded-full bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]" />
                      )}
                      {isCold && (
                        <div className="absolute bottom-1 right-1 w-1 h-1 rounded-full bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.8)]" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Betting Controls */}
              <div className="p-2 space-y-2">
                <div className="flex items-center gap-1.5">
                  <div className="flex-[3] bg-[#2a3a3a] rounded border border-white/10 h-14 flex items-center shadow-[0_4px_10px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.05)] overflow-hidden">
                    <button 
                      onClick={() => setBetAmount(Math.max(5, betAmount - 5))}
                      className="px-4 text-gray-500 hover:text-white transition-all active:bg-white/5 h-full flex items-center"
                    >
                      <Minus className="w-5 h-5" />
                    </button>
                    <div className="flex-1 flex justify-center items-center h-full">
                      <input 
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={betAmount === 0 ? '' : betAmount}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9]/g, '');
                          if (val === '') {
                            setBetAmount(0);
                          } else {
                            const parsed = parseInt(val, 10);
                            setBetAmount(parsed);
                          }
                        }}
                        onBlur={() => {
                          let finalAmount = Math.max(5, betAmount);
                          if (balance !== null && finalAmount > balance) {
                            finalAmount = Math.max(5, balance);
                          }
                          setBetAmount(finalAmount);
                        }}
                        onFocus={(e) => e.target.select()}
                        className="w-full bg-transparent text-center text-2xl font-black text-white tabular-nums border-0 outline-none p-0 focus:ring-0 select-all"
                        placeholder="5"
                      />
                    </div>
                    <button 
                      onClick={() => setBetAmount(betAmount + 5)}
                      className="px-4 text-gray-500 hover:text-white transition-all active:bg-white/5 h-full flex items-center"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                  <button 
                    onClick={() => setBetAmount(Math.min(balance, betAmount * 2))}
                    className="flex-1 h-14 bg-[#2a3a3a] rounded border border-white/10 font-black text-gray-500 text-xs hover:text-[#2ecc71] hover:border-[#2ecc71]/30 transition-all shadow-[0_4px_10px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.05)] active:scale-[0.95]"
                  >
                    X2
                  </button>
                  <button 
                    onClick={() => setBetAmount(balance)}
                    className="flex-1 h-14 bg-[#2a3a3a] rounded border border-white/10 font-black text-gray-500 text-xs hover:text-[#2ecc71] hover:border-[#2ecc71]/30 transition-all shadow-[0_4px_10px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.05)] active:scale-[0.95]"
                  >
                    MAX
                  </button>
                </div>

                <button
                  onClick={handleBet}
                  className={`
                    w-full h-16 rounded font-black text-2xl uppercase tracking-[0.1em] transition-all active:scale-[0.98]
                    ${selectedNumbers.length > 0 && gameState === 'betting'
                      ? 'bg-[#2ecc71] hover:bg-[#27ae60] text-[#202c2c] shadow-[0_8px_25px_rgba(46,204,113,0.4),inset_0_2px_4px_rgba(255,255,255,0.4),inset_0_-4px_8px_rgba(0,0,0,0.2)] active:shadow-[0_4px_10px_rgba(46,204,113,0.2),inset_0_2px_4px_rgba(0,0,0,0.3)] active:scale-[0.95]'
                      : 'bg-gray-800/40 text-gray-500 cursor-not-allowed opacity-50 border border-white/5'
                    }
                  `}
                >
                  {gameState === 'betting' ? 'BET' : 'WAITING'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tab System & Content Area */}
        <div className="border-t border-gray-800/50 bg-[#202c2c] flex flex-col min-h-[300px]">
          {/* Tab Navigation */}
          <div className="flex bg-[#202c2c] border-b border-gray-800/30 sticky top-0 z-20">
            {(['GAME', 'HISTORY', 'RESULTS', 'STATISTICS'] as const).map(tab => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 flex items-center justify-center gap-1.5 pt-1 pb-0.5 transition-all relative ${isActive ? 'text-[#2ecc71]' : 'text-gray-500'}`}
                >
                  {tab === 'GAME' && <div className={`w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-l-[8px] ${isActive ? 'border-l-[#2ecc71]' : 'border-l-gray-500'}`} />}
                  {tab === 'HISTORY' && <History className="w-4 h-4" />}
                  {tab === 'RESULTS' && <CheckCircle2 className="w-4 h-4" />}
                  {tab === 'STATISTICS' && <TrendingUp className="w-4 h-4" />}
                  <span className="text-[12.5px] font-black uppercase tracking-wide">{tab}</span>
                  {isActive && (
                    <motion.div 
                      layoutId="tab-underline-keno" 
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2ecc71]" 
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          <div className="px-3.5 pt-2.5 pb-4">
            {activeTab === 'GAME' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center text-[10px] font-black text-gray-500 uppercase tracking-widest px-1 border-b border-white/5 pb-2">
                  <button 
                    onClick={() => setGameSubTab('all')}
                    className={`w-1/3 text-left transition-all hover:text-white cursor-pointer ${gameSubTab === 'all' ? 'text-[#2ecc71] scale-105' : 'text-gray-500'}`}
                  >
                    All <span className={gameSubTab === 'all' ? 'text-[#2ecc71] font-bold' : 'text-gray-600'}>{activeTickets.length + otherPlayersBets.length}</span>
                  </button>
                  <button 
                    onClick={() => setGameSubTab('mine')}
                    className={`w-1/3 text-center transition-all hover:text-white cursor-pointer ${gameSubTab === 'mine' ? 'text-[#2ecc71] scale-105' : 'text-gray-500'}`}
                  >
                    My Tickets <span className={gameSubTab === 'mine' ? 'text-[#2ecc71] font-bold' : 'text-gray-600'}>{activeTickets.length}</span>
                  </button>
                  <span className="w-1/3 text-right">My Bets <span className="text-[#2ecc71] font-bold">{activeTickets.reduce((sum, t) => sum + t.bet, 0)}</span></span>
                </div>

                <div className="space-y-2">
                  {(gameSubTab === 'all' 
                    ? [
                        ...activeTickets.map((t, i) => ({ ...t, isMine: true, displayId: activeTickets.length - i })),
                        ...otherPlayersBets.map(t => ({ ...t, isMine: false }))
                      ].sort((a, b) => {
                        if (a.isMine && !b.isMine) return -1;
                        if (!a.isMine && b.isMine) return 1;
                        return b.timestamp - a.timestamp;
                      })
                    : activeTickets.map((t, i) => ({ ...t, isMine: true, displayId: activeTickets.length - i }))
                  ).map((ticket, idx) => {
                    const stats = getTicketStats(ticket.numbers);
                    
                    // Highlight as green if and only if ticket hits the required match target to win (which is difficult, especially needing >3 matches)
                    const minRequired = getMinRequiredMatches(ticket.numbers.length);
                    const isWinning = stats.matchedNumbers.length >= minRequired && stats.payoutMult > 0;

                    return (
                      <div 
                        key={idx} 
                        className={`rounded-lg p-2 border transition-all shadow-[0_4px_10px_rgba(0,0,0,0.2)] ${
                          isWinning && currentDrawIndex >= 0
                            ? 'bg-[#2ecc71]/10 border-[#2ecc71]/50 shadow-[0_8px_20px_rgba(46,204,113,0.15),inset_0_1px_0_rgba(255,255,255,0.05)]' 
                            : ticket.isMine
                              ? 'bg-[#2a3a3a]/75 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                              : 'bg-[#1b2727]/60 border-white/5 opacity-85 shadow-[inset_0_1px_0_rgba(255,255,255,0.01)]'
                        }`}
                      >
                        <div className="flex justify-between items-center mb-1.5 px-1">
                          <div className={`text-[11px] font-black uppercase flex items-center gap-1.5 ${
                            isWinning && currentDrawIndex >= 0 ? 'text-[#2ecc71]' : 'text-gray-400'
                          }`}>
                            {ticket.isMine ? (
                              <>
                                <span className="bg-[#2ecc71]/20 text-[#2ecc71] px-1 rounded text-[9px] font-bold">ME</span>
                                <span>{ticket.displayId} My Ticket</span>
                              </>
                            ) : (
                              <span>Player {ticket.id} Ticket</span>
                            )}
                          </div>
                          {!ticket.isMine && (
                            <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider bg-black/10 px-1 rounded">Auto</span>
                          )}
                        </div>

                        <div className="grid grid-cols-10 gap-1 mb-2">
                          {Array.from({ length: 10 }).map((_, i) => {
                            const n = ticket.numbers[i];
                            if (n) {
                              const isMatch = stats.matchedNumbers.includes(n);
                              return (
                                <div 
                                  key={n} 
                                  className={`aspect-square rounded flex items-center justify-center text-[11px] font-black transition-all border ${
                                    isMatch 
                                      ? 'bg-[#2ecc71] text-[#202c2c] border-[#2ecc71] shadow-[0_4px_8px_rgba(46,204,113,0.4),inset_0_1px_0_rgba(255,255,255,0.3)]' 
                                      : 'bg-[#354646] text-white border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                                  }`}
                                >
                                  {n}
                                </div>
                              );
                            }
                            return (
                              <div key={`placeholder-${i}`} className="aspect-square bg-gray-800/10 rounded border border-gray-800/10 opacity-30" />
                            );
                          })}
                        </div>
                        <div className="flex justify-between items-center text-[11px] font-black uppercase px-1">
                          <span className="text-gray-500">Bet {ticket.bet}</span>
                          {gameState === 'betting' || gameState === 'draw' ? (
                            <span className="text-yellow-500 italic">
                              {gameState === 'draw' && stats.matchedNumbers.length > 0 
                                ? `${stats.matchedNumbers.length} Hits` 
                                : 'Waiting'}
                            </span>
                          ) : (
                            <span className={isWinning ? 'text-[#2ecc71] font-bold' : 'text-yellow-500 italic'}>
                              {isWinning 
                                ? (stats.payoutMult * ticket.bet).toLocaleString()
                                : 'No Win'
                              }
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'HISTORY' && (
              <div className="flex flex-col bg-[#1a2525] space-y-[1px]">
                <div className="flex items-center text-[11px] font-medium text-gray-500 px-2.5 py-1.5 gap-2 sm:gap-4">
                  <span className="w-[85px] sm:w-[100px] shrink-0 text-left">Draw ID</span>
                  <div className="w-[1px] self-stretch bg-transparent shrink-0" />
                  <span className="flex-1 text-center font-bold">Combination</span>
                </div>
                {myBetHistory.length > 0 ? (
                  myBetHistory.map((item, idx) => (
                    <div key={idx} className="bg-[#243131] flex items-center p-2.5 gap-2 sm:gap-4">
                      <div className="w-[85px] sm:w-[100px] shrink-0 flex flex-col justify-center">
                        <span className="text-[13px] sm:text-[14px] font-bold tracking-tight text-[#2ecc71]">{item.id}</span>
                        <div className="text-[10px] sm:text-[11px] text-gray-400 font-medium opacity-90">{item.time}</div>
                      </div>

                      <div className="w-[1px] self-stretch bg-white/10 shrink-0 my-1" />

                      <div className="flex-1 min-w-0 flex flex-col items-center justify-center">
                        <div className="text-[11px] sm:text-[12px] text-white/80 font-bold mb-1">
                          Bet {item.bet}
                        </div>
                        <div className="grid grid-cols-10 gap-[1.5px] p-[1.5px] bg-gray-800/80 rounded">
                          {item.numbers.map((n, i) => {
                            const isHit = item.hits.includes(n);
                            return (
                              <div key={i} className={`aspect-square w-[23px] min-[360px]:w-[24px] min-[375px]:w-[26px] min-[410px]:w-[28px] sm:w-[32px] flex items-center justify-center text-[10px] min-[360px]:text-[11px] min-[375px]:text-[12px] sm:text-[14px] font-extrabold rounded-[1px] transition-colors ${isHit ? 'bg-[#2ecc71] text-white' : 'bg-[#354646] text-gray-400'}`}>
                                {n}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 text-gray-500 font-medium bg-[#243131] border border-white/[0.02]">
                    ምንም የጨዋታ ታሪክ የለም (No game history yet)
                  </div>
                )}
                
                <div className="flex flex-col items-center gap-3 pt-8 pb-4 bg-[#202c2c]">
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-[#2ecc71]" />
                  </div>
                  <span className="text-[18px] font-black text-white tracking-wide">FAIRNESS</span>
                </div>
              </div>
            )}

            {activeTab === 'RESULTS' && (
              <div className="space-y-0.5 bg-[#1a2525]">
                <div className="flex items-center text-[11px] font-medium text-gray-500 px-2.5 py-1.5 gap-2 sm:gap-4">
                  <span className="w-[85px] sm:w-[100px] shrink-0 text-left">Draw ID</span>
                  <div className="w-[1px] self-stretch bg-transparent shrink-0" />
                  <span className="flex-1 text-center font-bold">Combination</span>
                </div>
                <div className="space-y-[1px]">
                  {serverHistory.length > 0 ? (
                    serverHistory.map((res, idx) => (
                      <div key={idx} className="bg-[#243131] flex items-center p-2.5 gap-2 sm:gap-4">
                        <div className="w-[85px] sm:w-[100px] shrink-0 flex flex-col justify-center">
                          <span className="text-[13px] sm:text-[14px] font-bold tracking-tight text-[#2ecc71]">{res.id}</span>
                          <div className="text-[10px] sm:text-[11px] text-gray-400 font-medium opacity-90">{res.time}</div>
                        </div>

                        <div className="w-[1px] self-stretch bg-white/10 shrink-0 my-1" />
                        
                        <div className="flex-1 min-w-0 flex justify-end">
                          <div className="grid grid-cols-10 gap-[1.5px] p-[1.5px] bg-gray-800/90 rounded">
                            {res.balls.map((n: any, i: any) => (
                              <div key={i} className="aspect-square w-[22px] min-[360px]:w-[23px] min-[375px]:w-[25px] min-[410px]:w-[27px] sm:w-[32px] flex items-center justify-center text-[10px] min-[360px]:text-[11px] min-[375px]:text-[12px] sm:text-[14px] font-extrabold bg-[#354646] text-gray-300 rounded-[1px]">
                                {n}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12 text-gray-500 font-medium bg-[#243131] border border-white/[0.02]">
                      ምንም የውጤት ዝርዝር የለም (No draw results yet)
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'STATISTICS' && (() => {
              const sortedStats = [...numberStats].sort((a, b) => {
                if (statsSortMode === 'number') {
                  return a.number - b.number;
                } else {
                  if (b.frequency !== a.frequency) {
                    return b.frequency - a.frequency;
                  }
                  return a.number - b.number;
                }
              });
              const maxFreq = Math.max(...numberStats.map(item => item.frequency), 1);
              return (
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1 py-0.5">
                    <span className="text-[#8e9a9a] text-[11px] font-medium tracking-wide">Last 100 rounds</span>
                    <button 
                      onClick={() => setStatsSortMode(prev => prev === 'number' ? 'frequency' : 'number')}
                      className="flex items-center gap-1 text-[11px] font-bold text-[#2ecc71] hover:text-[#27ae60] transition-colors cursor-pointer select-none"
                    >
                      <span>Sort</span>
                      <ArrowDownWideNarrow className={`w-3 h-3 transition-transform ${statsSortMode === 'frequency' ? 'text-yellow-400 rotate-180' : 'text-[#2ecc71]'}`} />
                    </button>
                  </div>
                  
                  <div className="flex flex-col gap-1 pb-4">
                    {sortedStats.map((item) => (
                      <div key={item.number} className="bg-[#243131]/95 px-2.5 py-1 flex items-center gap-4 border border-white/[0.01] rounded-[3px] shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
                        {/* Number Badge */}
                        <div className="w-[28px] h-[22px] rounded bg-[#334155]/50 border border-white/5 flex items-center justify-center text-[11px] font-extrabold text-white/90 shrink-0 select-none">
                          {item.number}
                        </div>

                        {/* Thin dynamic green indicator bar */}
                        <div className="flex-1 h-[2px] bg-gray-900/40 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${(item.frequency / maxFreq) * 100}%` }}
                            transition={{ duration: 0.3 }}
                            className="h-full bg-[#2ecc71] rounded-full" 
                          />
                        </div>

                        {/* Absolute frequency count on the right */}
                        <div className="text-[12px] font-extrabold text-white/90 w-8 text-right pr-0.5 select-none">
                          {item.frequency}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Amharic Rules & Payments Modal Overlay */}
      <AnimatePresence>
        {showInfoModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm select-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-[#1f2d2d] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl relative overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-white/5 bg-[#172222]">
                <div className="flex items-center gap-2">
                  <Gamepad2 className="w-5 h-5 text-[#2ecc71]" />
                  <h3 className="text-base font-black text-white tracking-wide uppercase">
                    ኬኖ - ጨዋታ መመሪያና የክፍያ ሰንጠረዥ
                  </h3>
                </div>
                <button
                  onClick={() => setShowInfoModal(false)}
                  className="w-8 h-8 rounded-full bg-white/5 border border-white/5 flex items-center justify-center text-gray-400 hover:text-white transition-all cursor-pointer focus:outline-none"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-5 space-y-6 text-sm leading-relaxed text-gray-300 no-scrollbar">
                {/* How to Play Section */}
                <div className="space-y-3">
                  <h4 className="text-[#2ecc71] font-black text-base uppercase tracking-wide border-b border-white/5 pb-1">
                    እንዴት እንደሚጫወቱ (How to Play)
                  </h4>
                  <p className="text-gray-300">
                    ኬኖ ተጫዋቹ ከ1 እስከ 10 የሚደርሱ ኳሶችን በመምረጥ ከ1-80 በተቆጠሩ ኳሶች ላይ የሚጫወትበት ጨዋታ ነው። 
                    በእያንዳንዱ ዙር በዘፈቀደ ቁጥር አመንጪ (random number generator) በመጠቀም ከ1-80 ከተቆጠሩት ውስጥ 20 ኳሶች በቅደም ተከተል ይወጣሉ።
                  </p>
                  <div className="bg-black/20 border border-white/5 rounded-xl p-3 space-y-2.5">
                    <p className="font-bold text-white text-xs uppercase tracking-wider">
                      ለመሳተፍ በ1 ደቂቃ የውርርድ ዙር ውስጥ የሚከተሉትን ያከናውኑ፦
                    </p>
                    <ul className="space-y-1.5 list-disc list-inside text-gray-300 pl-1">
                      <li>
                        <span className="font-bold text-white">የቁጥሮች ጥምር መምረጥ፦</span> ከ1 እስከ 80 ባለው ሰሌዳ ላይ የሚፈልጉትን ከ1 እስከ 10 ቁጥሮች ይምረጡ።
                      </li>
                      <li>
                        <span className="font-bold text-white">የውርርድ መጠን መወሰን፦</span> ለመወራረድ የሚፈልጉትን መጠን ያስገቡ (ቢያንስ 5)።
                      </li>
                      <li>
                        <span className="font-bold text-white">"Bet" መጫን፦</span> ምርጫዎን ካጠናቀቁ በኋላ ውርርድዎን ለማስገባት <span className="text-[#2ecc71] font-black">"BET"</span> የሚለውን ቁልፍ ይጫኑ።
                      </li>
                    </ul>
                    <p className="text-[11px] text-[#8e9a9a] italic pl-1">
                      * ቀድሞ የመረጡትን ቁጥር እንደገና በመጫን ምርጫውን መሰረዝ ይችላሉ።
                    </p>
                  </div>
                  <p className="text-gray-400 text-xs">
                    በቁጥር ሰሌዳው ላይ ሙቅ (<span className="text-red-500 font-bold">HOT</span>) እና ቀዝቃዛ (<span className="text-blue-400 font-bold">COLD</span>) ቁጥሮች በቅደም ተከተል በቀይ እና ሰማያዊ ቀለሞች ይታያሉ። ሙቅ ቁጥሮች በተደጋጋሚ የወጡ ሲሆኑ ቀዝቃዛዎቹ ደግሞ በብዛት ያልወጡት ናቸው።
                  </p>
                </div>

                {/* Payments Section */}
                <div className="space-y-3">
                  <h4 className="text-[#2ecc71] font-black text-base uppercase tracking-wide border-b border-white/5 pb-1">
                    ክፍያዎች (Payments)
                  </h4>
                  <p className="text-gray-300">
                    ሁሉም አሸናፊ የኳስ ጥምረቶች ተጫዋቹ ባስቀመጠው ውርርድ መጠን የሚባዙ የራሳቸው ዕድሎች (odds) አሏቸው። 
                    አሸናፊው ጥምር የሚሰላው በተወራረደባቸው የኳሶች ብዛት እና በትክክል በተገመቱት ኳሶች ጥምርታ ነው።
                  </p>

                  {/* Table */}
                  <div className="border border-white/10 rounded-xl overflow-hidden bg-black/30">
                    <div className="overflow-x-auto no-scrollbar">
                      <table className="w-full text-center text-xs border-collapse">
                        <thead>
                          <tr className="bg-[#172222] border-b border-white/10">
                            <th className="px-2 py-2.5 text-[10px] font-black text-gray-400 uppercase tracking-wider border-r border-white/10">
                              በትክክል<br/>የተገመቱ (Match)
                            </th>
                            {Array.from({ length: 10 }).map((_, i) => (
                              <th key={i} className="px-1 py-2.5 font-black text-[#2ecc71] border-r border-white/10 min-w-[40px]">
                                {i + 1}<br/><span className="text-[9px] text-gray-500 font-normal">ቁጥር</span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {AMHARIC_PAYOUT_MATRIX.map((row) => (
                            <tr key={row.match} className="border-b border-white/5 hover:bg-white/[0.01] transition-colors">
                              <td className="px-2 py-1.5 font-black text-white bg-[#172222]/50 border-r border-white/10">
                                {row.match}
                              </td>
                              {row.pays.map((val, colIdx) => (
                                <td 
                                  key={colIdx} 
                                  className={`px-1 py-1.5 border-r border-white/5 font-mono font-bold ${
                                    val !== null 
                                      ? val >= 100 
                                        ? 'text-yellow-400 text-xs font-black' 
                                        : 'text-[#2ecc71]' 
                                      : 'text-gray-700/60 font-normal text-[10px]'
                                  }`}
                                >
                                  {val !== null ? `x${val}` : '-'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Disconnection Policy */}
                <div className="bg-[#172222]/60 border border-white/5 rounded-xl p-3 space-y-1.5">
                  <h5 className="text-white font-black text-xs uppercase tracking-wider">
                    የግንኙነት መቋረጥ መመሪያ (Disconnection Policy)
                  </h5>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    ንቁ የጨዋታ ዙር ከተጀመረ በኋላ እና ውርርድዎ በአገልጋዩ (server) ተቀባይነት ካገኘ በኋላ የግንኙነት መቋረጥ ቢከሰትም፣ 
                    ጨዋታው እንደተለመደው ይቀጥላል እንዲሁም ማንኛውም አሸናፊነት ከግንኙነቱ መቋረጥ ውጭ በጨዋታው ውጤት መሠረት ይስተናገዳል።
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-white/5 bg-[#172222] flex justify-end">
                <button
                  onClick={() => setShowInfoModal(false)}
                  className="px-5 py-2 rounded bg-[#2ecc71] hover:bg-[#27ae60] text-[#202c2c] font-black text-xs uppercase tracking-widest transition-all cursor-pointer shadow-lg active:scale-95"
                >
                  ተረዳሁ (Close)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
