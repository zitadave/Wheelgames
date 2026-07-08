import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Socket } from 'socket.io-client';
import { BingoRoomState } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Users, Clock, History, AlertCircle, Coins, ChevronLeft, Volume2, VolumeX, RefreshCw, RotateCw, HelpCircle, X } from 'lucide-react';
import { getDeterministicCard } from '../utils/bingo';

type QueueItem = 
  | { type: 'event', src: string, audio: HTMLAudioElement }
  | { type: 'ball', ball: number, audio: HTMLAudioElement };

const audioQueue: QueueItem[] = [];
let isPlayingAudio = false;
let currentAudioElement: HTMLAudioElement | null = null;

const clearAudioQueue = () => {
  audioQueue.length = 0;
  if (currentAudioElement) {
    currentAudioElement.pause();
    currentAudioElement = null;
  }
  window.speechSynthesis.cancel();
  isPlayingAudio = false;
};

const playNextAudio = () => {
  if (audioQueue.length === 0) {
    isPlayingAudio = false;
    return;
  }
  
  isPlayingAudio = true;
  const item = audioQueue.shift();
  if (!item) {
    playNextAudio();
    return;
  }

  currentAudioElement = item.audio;
  currentAudioElement.onended = () => {
    currentAudioElement = null;
    playNextAudio();
  };
  currentAudioElement.onerror = () => {
    currentAudioElement = null;
    if (item.type === 'ball') {
      fallbackToTTS(item.ball, () => {
        playNextAudio();
      });
    } else {
      playNextAudio();
    }
  };
  currentAudioElement.play().catch(err => {
    console.warn("Audio play failed", err);
    currentAudioElement = null;
    if (item.type === 'ball') {
      fallbackToTTS(item.ball, () => {
        playNextAudio();
      });
    } else {
      playNextAudio();
    }
  });
};

const queueAudioItem = (item: { type: 'event', src: string } | { type: 'ball', ball: number }, enabled: boolean) => {
  if (!enabled) {
    clearAudioQueue();
    return;
  }

  let audio: HTMLAudioElement | undefined;
  try {
    if (item.type === 'event') {
      audio = new Audio(item.src);
    } else {
      const extension = (item.ball === 3 || item.ball === 4) ? 'm4a' : 'mp3';
      audio = new Audio(`/bingo_audio/${item.ball}.${extension}`);
    }
    audio.preload = 'auto';
  } catch(e) {
    console.warn("Could not preload audio", e);
  }

  if (!audio) return;
  
  audioQueue.push({ ...item, audio } as QueueItem);
  
  if (!isPlayingAudio) {
    playNextAudio();
  }
};

const fallbackToTTS = (ball: number, onEnd: () => void) => {
  const letter = ball <= 15 ? 'B' : ball <= 30 ? 'I' : ball <= 45 ? 'N' : ball <= 60 ? 'G' : 'O';
  const letterAmh = letter === 'B' ? 'ቢ' : letter === 'I' ? 'አይ' : letter === 'N' ? 'ኤን' : letter === 'G' ? 'ጂ' : 'ኦ';
  
  const amharicNumbers: Record<number, string> = {
    1: "አንድ", 2: "ሁለት", 3: "ሶስት", 4: "አራት", 5: "አምስት",
    6: "ስድስት", 7: "ሰባት", 8: "ስምንት", 9: "ዘጠኝ", 10: "አስር",
    11: "አስራ አንድ", 12: "አስራ ሁለት", 13: "አስራ ሶስት", 14: "አስራ አራት", 15: "አስራ አምስት",
    16: "አስራ ስድስት", 17: "አስራ ሰባት", 18: "አስራ ስምንት", 19: "አስራ ዘጠኝ", 20: "ሃያ",
    21: "ሃያ አንድ", 22: "ሃያ ሁለት", 23: "ሃያ ሶስት", 24: "ሃያ አራት", 25: "ሃያ አምስት",
    26: "ሃያ ስድስት", 27: "ሃያ ሰባት", 28: "ሃያ ስምንት", 29: "ሃያ ዘጠኝ", 30: "ሰላሳ",
    31: "ሰላሳ አንድ", 32: "ሰላሳ ሁለት", 33: "ሰላሳ ሶስት", 34: "ሰላሳ አራት", 35: "ሰላሳ አምስት",
    36: "ሰላሳ ስድስት", 37: "ሰላሳ ሰባት", 38: "ሰላሳ ስምንት", 39: "ሰላሳ ዘጠኝ", 40: "አርባ",
    41: "አርባ አንድ", 42: "አርባ ሁለት", 43: "አርባ ሶስት", 44: "አርባ አራት", 45: "አርባ አምስት",
    46: "አርባ ስድስት", 47: "አርባ ሰባት", 48: "አርባ ስምንት", 49: "አርባ ዘጠኝ", 50: "ሃምሳ",
    51: "ሃምሳ አንድ", 52: "ሃምሳ ሁለት", 53: "ሃምሳ ሶስት", 54: "ሃምሳ አራት", 55: "ሃምሳ አምስት",
    56: "ሃምሳ ስድስት", 57: "ሃምሳ ሰባት", 58: "ሃምሳ ስምንት", 59: "ሃምሳ ዘጠኝ", 60: "ስልሳ",
    61: "ስልሳ አንድ", 62: "ስልሳ ሁለት", 63: "ስልሳ ሶስት", 64: "ስልሳ አራት", 65: "ስልሳ አምስት",
    66: "ስልሳ ስድስት", 67: "ስልሳ ሰባት", 68: "ስልሳ ስምንት", 69: "ስልሳ ዘጠኝ", 70: "ሰባ",
    71: "ሰባ አንድ", 72: "ሰባ ሁለት", 73: "ሰባ ሶስት", 74: "ሰባ አራት", 75: "ሰባ አምስት"
  };

  const numAmh = amharicNumbers[ball] || ball.toString();
  const textToSpeak = `${letterAmh} ${numAmh}`;
  
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(textToSpeak);
  const voices = window.speechSynthesis.getVoices();
  
  const amharicVoices = voices.filter(v => v.lang.startsWith('am'));
  let chosenVoice = amharicVoices.find(v => v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('david') || v.name.toLowerCase().includes('google'));
  if (!chosenVoice && amharicVoices.length > 0) {
    chosenVoice = amharicVoices[0];
  }
  
  if (chosenVoice) {
    utterance.voice = chosenVoice;
    utterance.lang = chosenVoice.lang;
  } else {
    utterance.lang = 'am-ET';
  }

  utterance.pitch = 0.75;
  utterance.rate = 0.78;
  utterance.volume = 1.0;
  
  utterance.onend = () => {
    onEnd();
  };
  utterance.onerror = () => {
    onEnd();
  };
  
  window.speechSynthesis.speak(utterance);
};

interface BingoGameProps {
  bingoRoomsMeta?: any;
  selectedRoomId: string | null;
  onRoomSelect: (roomId: string | null) => void;
  socket: Socket | null;
  userId: string;
  username: string;
  photoUrl?: string | null;
  balance: number;
  showNotification: (msg: string, type: 'success' | 'error' | 'info') => void;
  roomState: BingoRoomState | null;
  displayTime: number;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  isActive?: boolean;
}

export const BingoGame: React.FC<BingoGameProps> = ({ socket, userId, username, photoUrl, balance, showNotification, roomState, displayTime, soundEnabled, setSoundEnabled, isActive, selectedRoomId, onRoomSelect, bingoRoomsMeta }) => {
  
  const [selectedCards, setSelectedCards] = useState<number[]>([]);
  const [isJoined, setIsJoined] = useState(false);
  const [lastCalledBall, setLastCalledBall] = useState<number | null>(null);
  const [highlightMode, setHighlightMode] = useState<'auto' | 'manual'>('auto');
  const [manuallyMarked, setManuallyMarked] = useState<Set<string>>(new Set());
  const [activeWinnerIdx, setActiveWinnerIdx] = useState<number>(0);
  const [showHelp, setShowHelp] = useState(false);

  const allSelectedCards = useMemo(() => {
    const cards = new Set<number>();
    if (roomState?.players) {
      Object.values(roomState.players).forEach((p: any) => {
        if (p.userId !== userId) {
          p.cards?.forEach((c: number) => cards.add(c));
        }
      });
    }
    return cards;
  }, [roomState?.players, userId]);


  useEffect(() => {
    if (!selectedRoomId) {
      setSelectedCards([]);
    }
  }, [selectedRoomId]);

  useEffect(() => {
    if (!soundEnabled) {
      clearAudioQueue();
    }
  }, [soundEnabled]);

  const prevStatusRef = useRef<string | undefined>(roomState?.status);

  useEffect(() => {
    if (prevStatusRef.current === 'lobby' && roomState?.status === 'playing') {
      queueAudioItem({ type: 'event', src: '/bingo_audio/the_game_has_started.mp3' }, soundEnabled);
    } else if (prevStatusRef.current === 'playing' && roomState?.status === 'result') {
      clearAudioQueue();
      queueAudioItem({ type: 'event', src: '/bingo_audio/bingo.mp3' }, soundEnabled);
    }
    prevStatusRef.current = roomState?.status;
  }, [roomState?.status, soundEnabled]);

  const prevCalledBallsLengthRef = useRef<number>(0);

  useEffect(() => {
    if (roomState?.status === 'playing') {
      const currentLength = roomState.calledBalls.length;
      if (currentLength > prevCalledBallsLengthRef.current) {
        const latestBall = roomState.calledBalls[currentLength - 1];
        queueAudioItem({ type: 'ball', ball: latestBall }, soundEnabled);
      }
      prevCalledBallsLengthRef.current = currentLength;
    } else {
      prevCalledBallsLengthRef.current = 0;
    }
  }, [roomState?.calledBalls.length, roomState?.status, soundEnabled]);

  useEffect(() => {
    // Reset manual highlights and selected cards when game is in lobby
    if (roomState?.status === 'lobby') {
      setManuallyMarked(new Set());
      setSelectedCards([]);
      setIsJoined(false);
    }
  }, [roomState?.status]);

  const toggleManualMark = (cardId: number, num: number) => {
    if (highlightMode !== 'manual') return;
    
    // When a number is clicked, mark/unmark it across ALL selected cards simultaneously
    setManuallyMarked(prev => {
      const next = new Set(prev);
      const key = `${cardId}-${num}`;
      const isCurrentlyMarked = next.has(key);
      
      selectedCards.forEach(cId => {
        // Only mark if the number actually exists on the card
        const cardData = getDeterministicCard(cId);
        const hasNum = cardData.some(col => col.includes(num));
        
        if (hasNum) {
          const syncKey = `${cId}-${num}`;
          if (isCurrentlyMarked) {
            next.delete(syncKey);
          } else {
            next.add(syncKey);
          }
        }
      });
      
      return next;
    });
  };

  useEffect(() => {
    if (!socket || !selectedRoomId || isActive === false) return;
    socket.emit('bingo_get_state', selectedRoomId);
  }, [socket, selectedRoomId, isActive]);

  useEffect(() => {
    if (roomState?.players && roomState.players[userId]) {
      setIsJoined(true);
      // Ensure we reflect the exact cards they bought
      setSelectedCards(roomState.players[userId].cards);
    } else {
      setIsJoined(false);
      // If the game started and they never joined, clear their selection so they see "Watching Only"
      if (roomState?.status === 'playing' || roomState?.status === 'result') {
        setSelectedCards([]);
      }
    }
  }, [roomState?.players, userId, roomState?.status]);

  const toggleCard = (cardId: number) => {
    if (roomState?.status !== 'lobby') {
      showNotification("Game already in progress. Wait for next round.", "info");
      return;
    }

    let newSelected: number[];
    if (selectedCards.includes(cardId)) {
      newSelected = selectedCards.filter(id => id !== cardId);
    } else {
      if (selectedCards.length < 2) {
        newSelected = [...selectedCards, cardId];
      } else {
        showNotification("Max 2 cards allowed", "info");
        return;
      }
    }
    
    setSelectedCards(newSelected);
    
    // Auto-join if cards are selected
    if (newSelected.length > 0) {
      handleJoin(newSelected);
    } else {
      handleLeave();
    }
  };

  const handleJoin = (cards: number[]) => {
    if (!selectedRoomId || cards.length === 0) return;
    
    socket?.emit('bingo_join', {
      roomId: selectedRoomId,
      userId,
      username,
      cards: cards,
      photoUrl: photoUrl || undefined
    }, (res: any) => {
      if (res.success) {
        setIsJoined(true);
      } else {
        showNotification(res.message, "error");
      }
    });
  };

  const handleLeave = () => {
    if (!selectedRoomId) return;
    socket?.emit('bingo_leave', { roomId: selectedRoomId, userId });
    setIsJoined(false);
  };

  const handleClaimBingo = () => {
    if (!selectedRoomId) return;
    socket?.emit('bingo_claim', { roomId: selectedRoomId, userId }, (res: any) => {
      if (res.success) {
        showNotification(`BINGO! You won ${res.winAmount} ETB`, "success");
      } else {
        showNotification(res.message, "error");
      }
    });
  };

  if (!selectedRoomId) {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#121421] justify-center items-center p-6 text-white overflow-y-auto w-full relative">
        {/* Help Modal Overlay */}
        <AnimatePresence>
          {showHelp && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="bg-[#1a1c2e] border border-purple-500/30 rounded-[2rem] w-full max-w-sm overflow-hidden flex flex-col shadow-[0_0_50px_rgba(168,85,247,0.2)]"
              >
                {/* Modal Header */}
                <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-5 py-3 flex items-center justify-center">
                  <div className="flex items-center gap-2">
                    <div className="p-1 bg-white/20 rounded-lg">
                      <AlertCircle className="w-4 h-4 text-white" />
                    </div>
                    <h3 className="font-black text-base text-white uppercase tracking-wider">የቢንጎ ህግ እና ደንቦች</h3>
                  </div>
                </div>

                {/* Modal Content */}
                <div className="px-5 py-4 overflow-y-auto max-h-[60vh] custom-scrollbar space-y-4">
                  <div className="space-y-3">
                    <div className="flex gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 font-black text-[10px] shrink-0">1</div>
                      <div className="space-y-0.5 text-left">
                        <h4 className="text-[11px] font-black text-purple-300 uppercase leading-none">መጠበቂያ (Lobby Phase)</h4>
                        <p className="text-[11px] font-bold text-gray-300 leading-snug">
                          ካርቴላ መርጠው ጨዋታው እስኪጀምር 50s ይቆጥራል ሰከንዱ ዜሮ ሲሆን በራሱ ወደ ጨዋታው ያስገባዋታ።
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 font-black text-[10px] shrink-0">2</div>
                      <div className="space-y-0.5 text-left">
                        <h4 className="text-[11px] font-black text-purple-300 uppercase leading-none">አሸናፊ ለመሆን</h4>
                        <p className="text-[11px] font-bold text-gray-300 leading-snug">
                          በካርቴላዎ ላይ ያሉ ቁጥሮች በተወሰነ ቅርጽ (ለምሳሌ፦ አግድም፣ ቁልቁል፣ ወይም በሰያፍ መስመር ወይም አራቱ ኮርነር) ሙሉ በሙሉ መሞላት አለባቸው።
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 font-black text-[10px] shrink-0">3</div>
                      <div className="space-y-0.5 text-left">
                        <h4 className="text-[11px] font-black text-purple-300 uppercase leading-none">ቁጥሮችን መምረጥ (Highlighting)</h4>
                        <div className="space-y-1 mt-1">
                          <div className="bg-white/5 p-1.5 rounded-lg border border-white/5">
                            <span className="text-[9px] font-black text-blue-400 uppercase block">Auto (በራሱ)</span>
                            <p className="text-[10px] font-bold text-gray-400 leading-tight">ቁጥሮች ሲጠሩ በራሱ ካርቴላዎ ላይ ምልክት ያደርጋል።</p>
                          </div>
                          <div className="bg-white/5 p-1.5 rounded-lg border border-white/5">
                            <span className="text-[9px] font-black text-orange-400 uppercase block">Manual (በእጅ)</span>
                            <p className="text-[10px] font-bold text-gray-400 leading-tight">ቁጥሮችን እርስዎ ራስዎ መጫን አለብዎት። በአንድ ካርቴላ ላይ አንድ ቁጥር ሲጫኑ በሌላውም ላይ ካለ በራሱ ምልክት ይደረጋል።</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 font-black text-[10px] shrink-0">4</div>
                      <div className="space-y-0.5 text-left">
                        <h4 className="text-[11px] font-black text-purple-300 uppercase leading-none">BINGO!</h4>
                        <p className="text-[11px] font-bold text-gray-300 leading-snug">
                          ካርቴላዎ ሲሞላ "BINGO!" የሚለውን ቁልፍ በመጫን አሸናፊነትዎን ማረጋገጥ አለብዎት።
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-white/5 text-center">
                    <p className="text-[8px] font-black text-gray-500 uppercase tracking-widest italic">መልካም እድል!</p>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="p-2.5 bg-white/5">
                  <button 
                    onClick={() => setShowHelp(false)}
                    className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white font-black py-2 rounded-xl shadow-lg active:scale-95 transition-transform uppercase text-[10px]"
                  >
                    ተረዳሁ (I UNDERSTAND)
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm flex flex-col gap-6 text-center relative"
        >
          <button 
            onClick={() => setShowHelp(true)}
            className="absolute -top-12 right-0 p-2 text-purple-400 hover:text-purple-300 transition-colors cursor-pointer"
          >
            <HelpCircle className="w-6 h-6" />
          </button>
          <div>
            <span className="text-purple-400 font-black text-[10.5px] tracking-[0.25em] uppercase block mb-1">BINGO ROOM SELECT</span>
            <h2 className="text-2xl font-black text-white tracking-tight">የቢንጎ መደብ ይምረጡ</h2>
          </div>

          <div className="flex flex-col gap-3">
            {/* 10 ETB Card */}
            <button
              onClick={() => onRoomSelect('bingo-10')}
              className="flex items-center justify-between p-4 bg-[#1a1c2e] hover:bg-[#23263f] border border-purple-500/10 hover:border-purple-500/30 rounded-2xl transition-all duration-300 group cursor-pointer active:scale-98 shadow-lg w-full"
            >
              <div className="flex items-start gap-3.5 text-left">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 font-black text-sm border border-purple-500/20 group-hover:scale-105 transition-transform shrink-0">
                  10
                </div>
                <div className="flex flex-col">
                  <span className="text-[18px] font-black text-white">ባለ 10 መደብ</span>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Standard 10 ETB Bet</span>
                </div>
              </div>
              <div className="flex flex-col items-end text-right shrink-0 gap-1">
                <span className="text-xs font-black text-purple-400 uppercase tracking-widest">Select</span>
                {bingoRoomsMeta?.['bingo-10']?.status === 'lobby' && (
                  <span className="text-[12px] font-mono text-purple-300 font-black bg-purple-500/20 px-2 py-0.5 rounded">{bingoRoomsMeta['bingo-10'].timeLeft}s</span>
                )}
                {bingoRoomsMeta?.['bingo-10']?.status === 'playing' && (
                  <span className="text-[10px] text-green-400 font-bold uppercase animate-pulse">Playing</span>
                )}
                
              </div>
            </button>

            {/* 20 ETB Card */}
            <button
              onClick={() => onRoomSelect('bingo-20')}
              className="flex items-center justify-between p-4 bg-[#1a1c2e] hover:bg-[#23263f] border border-purple-500/10 hover:border-purple-500/30 rounded-2xl transition-all duration-300 group cursor-pointer active:scale-98 shadow-lg w-full"
            >
              <div className="flex items-start gap-3.5 text-left">
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400 font-black text-sm border border-orange-500/20 group-hover:scale-105 transition-transform shrink-0">
                  20
                </div>
                <div className="flex flex-col">
                  <span className="text-[18px] font-black text-white">ባለ 20 መደብ</span>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Premium 20 ETB Bet</span>
                </div>
              </div>
              <div className="flex flex-col items-end text-right shrink-0 gap-1">
                <span className="text-xs font-black text-orange-400 uppercase tracking-widest">Select</span>
                {bingoRoomsMeta?.['bingo-20']?.status === 'lobby' && (
                  <span className="text-[12px] font-mono text-orange-300 font-black bg-orange-500/20 px-2 py-0.5 rounded">{bingoRoomsMeta['bingo-20'].timeLeft}s</span>
                )}
                {bingoRoomsMeta?.['bingo-20']?.status === 'playing' && (
                  <span className="text-[10px] text-green-400 font-bold uppercase animate-pulse">Playing</span>
                )}
                
              </div>
            </button>
          </div>

          <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest leading-relaxed">
            Choose your bet tier to start selecting cards.<br/>
            የመደብ ምርጫዎን በመምረጥ ወደ ካርድ ምርጫ ይለፉ።
          </p>
        </motion.div>
      </div>
    );
  }

  if (selectedRoomId && roomState?.status === 'lobby') {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#121421] w-full relative">
        {/* Selection Area */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative w-full">
          {/* Dense Grid - smaller buttons, full width, 8 columns */}
          <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
            <div className={`grid grid-cols-8 gap-1 ${selectedCards.length > 0 ? 'pb-52' : 'pb-16'}`}>
              {Array.from({ length: 400 }, (_, i) => i + 1).map(id => {
                const isTaken = allSelectedCards.has(id);
                const isSelectedByMe = selectedCards.includes(id);
                return (
                  <button
                    key={id}
                    disabled={isTaken && !isSelectedByMe}
                    onClick={() => {
                      if (!isTaken || isSelectedByMe) {
                        toggleCard(id);
                      }
                    }}
                    className={`h-9 rounded-md font-medium text-[10px] transition-all border flex items-center justify-center shadow-sm ${
                      isSelectedByMe
                        ? 'bg-green-600 border-green-500 text-white shadow-green-500/30 scale-105 z-10 active:scale-90 cursor-pointer'
                        : isTaken
                        ? 'bg-red-600 border-red-500 text-white cursor-not-allowed'
                        : 'bg-[#1a1c2e] border-gray-800/50 text-gray-400 hover:border-gray-600 hover:bg-[#252841] active:scale-90 cursor-pointer'
                    }`}
                  >
                    <span>{id}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedCards.length > 0 ? (
            /* Fixed Bottom Container - Side-by-side selected cards, maximized size */
            <div className="absolute bottom-0 left-0 right-0 pt-2 pb-3 px-4 bg-gradient-to-t from-[#121421] via-[#121421] to-[#121421]/90 border-t border-white/5 z-50 backdrop-blur-md">
              <div className="flex flex-col items-center gap-2 w-full max-w-lg mx-auto">
                <div className="flex flex-row justify-center gap-3 w-full">
                  {selectedCards.map((cardId, idx) => (
                    <div key={cardId} className="flex-1 max-w-[175px] animate-in zoom-in-95 duration-300" style={{ animationDelay: `${idx * 100}ms` }}>
                      <div className="bg-[#1a1c2e] rounded-lg overflow-hidden border border-purple-500/20 shadow-2xl">
                        <div className="bg-orange-500 px-1.5 py-0.5 border-b border-black/10">
                           <span className="text-[9.5px] font-black text-black uppercase tracking-wider block text-center truncate">NO: {cardId}</span>
                        </div>
                        <div className="p-0.5">
                           <BingoCardView card={getDeterministicCard(cardId)} calledBalls={[]} compact />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Simple thin bar with text only, doesn't block the grid layout */
            <div className="absolute bottom-0 left-0 right-0 py-2.5 px-4 bg-[#121421]/95 border-t border-white/10 z-50 backdrop-blur-sm flex items-center justify-center">
              <span className="text-purple-300 font-black text-[10px] uppercase tracking-[0.2em] text-center">
                ለመጫወት ካርድ ይምረጡ
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (roomState?.status === 'playing' || roomState?.status === 'result') {
      return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0a0b14] w-full text-white select-none relative">
          {/* Top Bar: Game Stats & Live Called Balls */}
          <div className="flex items-center justify-between bg-[#121421] border-b border-white/10 px-3 py-1 shrink-0 h-12 w-full">
            {/* Left: Compact Game Stats - Distributed evenly */}
            <div className="flex items-center justify-between w-[135px] shrink-0">
              <div className="flex flex-col flex-1 text-left">
                <span className="text-[7.5px] font-black text-gray-500 uppercase tracking-tighter">GAME ID</span>
                <span className="text-[11px] font-black text-purple-400 font-mono leading-none">{roomState.gameId}</span>
              </div>
              <div className="w-px h-5 bg-white/10 shrink-0 mx-1.5" />
              <div className="flex flex-col flex-1 text-left">
                <span className="text-[7.5px] font-black text-gray-500 uppercase tracking-tighter">BET</span>
                <span className="text-[11px] font-black text-white font-mono leading-none">{roomState.betAmount}</span>
              </div>
            </div>

            {/* Right: Caller Ball + 4 Preceding Called Numbers (Horizontal layout) */}
            <div className="flex items-center gap-2 justify-end">
              {/* Dynamic Caller Ball (Latest) - Larger */}
              {roomState.calledBalls.length > 0 ? (
                <motion.div 
                  key={`caller-ball-${roomState.calledBalls[roomState.calledBalls.length - 1]}`}
                  initial={{ scale: 0.2, rotate: -180, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                  className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-600 flex items-center justify-center shadow-[0_0_10px_rgba(249,115,22,0.7)] border border-white/25 select-none shrink-0"
                >
                  <span className="text-[17px] font-black text-purple-950 font-mono leading-none tracking-tighter drop-shadow-sm">
                    {(() => {
                      const lastBall = roomState.calledBalls[roomState.calledBalls.length - 1];
                      const letter = lastBall <= 15 ? 'B' : lastBall <= 30 ? 'I' : lastBall <= 45 ? 'N' : lastBall <= 60 ? 'G' : 'O';
                      return `${letter}-${lastBall}`;
                    })()}
                  </span>
                </motion.div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  <span className="text-[13px] font-black text-gray-500 font-mono leading-none">--</span>
                </div>
              )}

              {/* 4 Preceding Called Numbers (horizontal layout, larger size) */}
              <div className="flex items-center gap-1 select-none shrink-0">
                {(roomState.calledBalls.length > 1 
                  ? roomState.calledBalls.slice(0, -1).slice(-4).reverse() 
                  : []
                ).map((ball, i) => (
                  <div key={i} className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black border leading-none text-center shrink-0 shadow-sm ${
                    ball <= 15 ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' :
                    ball <= 30 ? 'bg-purple-500/10 border-purple-500/30 text-purple-400' :
                    ball <= 45 ? 'bg-pink-500/10 border-pink-500/30 text-pink-400' :
                    ball <= 60 ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                    'bg-orange-500/10 border-orange-500/30 text-orange-400'
                  }`}>
                    {ball <= 15 ? 'B' : ball <= 30 ? 'I' : ball <= 45 ? 'N' : ball <= 60 ? 'G' : 'O'}-{ball}
                  </div>
                ))}
                {roomState.calledBalls.length <= 1 && (
                  <span className="text-[9px] text-gray-500 font-black">--</span>
                )}
              </div>
            </div>
          </div>

          {/* Main Game Area */}
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Left Column: Number Board (1-75) */}
            <div className="w-[47%] border-r border-white/5 flex flex-col bg-[#121421]/50">
              <div className="grid grid-cols-5 gap-0.5 p-1 flex-1 min-h-0">
                {['B', 'I', 'N', 'G', 'O'].map((letter, i) => (
                  <div key={letter} className={`text-center font-black text-[11px] py-[3px] leading-none rounded-[2px] shadow-sm ${
                    ['bg-blue-600', 'bg-purple-600', 'bg-pink-600', 'bg-green-600', 'bg-orange-600'][i]
                  }`}>{letter}</div>
                ))}
                {Array.from({ length: 75 }, (_, i) => i + 1).map(num => {
                  const isCalled = roomState.calledBalls.includes(num);
                  const isLastCalled = roomState.calledBalls[roomState.calledBalls.length - 1] === num;
                  return (
                    <div
                      key={num}
                      className={`flex items-center justify-center text-[10px] rounded-sm h-full min-h-[14px] transition-all duration-300 ${
                        isLastCalled 
                          ? 'bg-yellow-500 border-2 border-yellow-300 text-black shadow-[0_0_8px_rgba(234,179,8,0.5)] z-10 font-black' 
                          : isCalled 
                            ? 'bg-green-600 border-2 border-green-500 text-white font-bold' 
                            : 'bg-[#131524] border border-[#2a2d42] text-gray-500 font-medium'
                      }`}
                    >
                      {num}
                    </div>
                  );
                })}
              </div>
              {/* Highlight Controls */}
              <div className="p-2 border-t border-white/5 bg-[#0a0b14]/80 shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] font-black text-gray-500 uppercase">Highlight:</span>
                  <div className="flex bg-white/5 rounded-md p-0.5 flex-1 h-7 items-center">
                    <button 
                      onClick={() => setHighlightMode('auto')}
                      className={`flex-1 h-full text-[9px] font-black rounded transition-all cursor-pointer ${
                        highlightMode === 'auto' ? 'bg-green-500/20 text-green-400 font-extrabold' : 'text-gray-500 hover:text-gray-400'
                      }`}
                    >
                      Auto
                    </button>
                    <button 
                      onClick={() => {
                        // Seed manual marks with currently called balls to prevent losing highlights when switching
                        if (highlightMode === 'auto') {
                          const newMarks = new Set(manuallyMarked);
                          selectedCards.forEach(cardId => {
                            const cardData = getDeterministicCard(cardId);
                            cardData.forEach(col => {
                              col.forEach(num => {
                                if (num !== 0 && roomState?.calledBalls.includes(num)) {
                                  newMarks.add(`${cardId}-${num}`);
                                }
                              });
                            });
                          });
                          setManuallyMarked(newMarks);
                        }
                        setHighlightMode('manual');
                      }}
                      className={`flex-1 h-full text-[9px] font-black rounded transition-all cursor-pointer ${
                        highlightMode === 'manual' ? 'bg-orange-500/20 text-orange-400 font-extrabold' : 'text-gray-500 hover:text-gray-400'
                      }`}
                    >
                      Manual
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Called Ball & User Cards */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              {/* Called Ball Section */}
              <div className="hidden">
                <div className="flex justify-between w-full items-center">
                   <div className="flex flex-col gap-1">
                      {roomState.calledBalls.slice(-4, -1).reverse().map((ball, i) => (
                        <div key={i} className={`px-2 py-0.5 rounded-full text-[9px] font-black border ${
                          ball <= 15 ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' :
                          ball <= 30 ? 'bg-purple-500/10 border-purple-500/30 text-purple-400' :
                          ball <= 45 ? 'bg-pink-500/10 border-pink-500/30 text-pink-400' :
                          ball <= 60 ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                          'bg-orange-500/10 border-orange-500/30 text-orange-400'
                        }`}>
                          {ball <= 15 ? 'B' : ball <= 30 ? 'I' : ball <= 45 ? 'N' : ball <= 60 ? 'G' : 'O'}-{ball}
                        </div>
                      ))}
                   </div>
                   
                   {/* Main Large Ball */}
                   <div className="relative">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-600 flex items-center justify-center shadow-[0_0_20px_rgba(249,115,22,0.4)] border-2 border-white/10 ring-2 ring-orange-500/20">
                         <span className="text-xl font-black text-purple-900 drop-shadow-sm">
                           {roomState.calledBalls.length > 0 
                            ? `${roomState.calledBalls[roomState.calledBalls.length - 1] <= 15 ? 'B' : roomState.calledBalls[roomState.calledBalls.length - 1] <= 30 ? 'I' : roomState.calledBalls[roomState.calledBalls.length - 1] <= 45 ? 'N' : roomState.calledBalls[roomState.calledBalls.length - 1] <= 60 ? 'G' : 'O'}-${roomState.calledBalls[roomState.calledBalls.length - 1]}`
                            : '--'}
                         </span>
                      </div>
                      <button onClick={() => setSoundEnabled(!soundEnabled)} className="absolute -right-3 top-1/2 -translate-y-1/2 p-1.5 text-green-400 active:scale-90 transition-transform">
                         {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                      </button>
                   </div>

                   <div className="w-10" /> {/* Spacer */}
                </div>
              </div>

              {/* User Cards Container - Fully Maximized Vertically */}
              <div className="flex-1 flex flex-col py-2 px-1.5 gap-2 overflow-hidden justify-center items-center w-full h-full">
                {selectedCards.length > 0 ? (
                  selectedCards.map(cardId => (
                    <div 
                      key={cardId} 
                      className={`w-full transition-all duration-300 min-h-0 flex flex-col ${
                        selectedCards.length === 1 
                          ? 'max-w-[320px] aspect-[5/6] max-h-[385px] my-auto' 
                          : 'max-w-[340px] flex-1 h-full'
                      }`}
                    >
                      <div className="bg-[#1a1c2e] rounded-xl overflow-hidden border border-purple-500/20 shadow-xl flex flex-col h-full">
                        <div className="bg-orange-500 px-3 py-0.5 shadow-inner shrink-0">
                           <span className="text-[8px] font-black text-black uppercase tracking-widest block text-center">Cartela No: {cardId}</span>
                        </div>
                        <div className="p-1 flex-1 min-h-0 h-full">
                          <BingoCardView 
                            cardId={cardId}
                            card={getDeterministicCard(cardId)} 
                            calledBalls={roomState.calledBalls} 
                            highlightMode={highlightMode}
                            manuallyMarked={manuallyMarked}
                            onCellClick={(num) => toggleManualMark(cardId, num)}
                          />
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="w-full max-w-[340px] flex-1 h-full flex flex-col my-auto animate-in zoom-in-95 duration-300">
                    <div className="bg-gradient-to-b from-[#1a1c3e] to-[#121424] rounded-2xl border border-purple-500/20 shadow-2xl flex flex-col items-center justify-center p-6 flex-1 h-full text-center relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-orange-500 via-purple-500 to-blue-500" />
                      
                      <h3 className="text-2xl font-black text-white tracking-widest uppercase mb-6">
                        ተመልካች ብቻ (WATCHING ONLY)
                      </h3>

                      <p className="text-sm font-black text-purple-200 leading-relaxed px-4">
                        የዚህ ዙር ጨዋታ ተጀምሯል። አዲስ ዙር እስኪጀምር እዚሁ ይጠብቁ።
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action Footer - Very compact */}
          <div className="p-1.5 bg-[#121421] border-t border-white/10 flex gap-1.5 shrink-0">
            <button onClick={() => { handleLeave(); onRoomSelect(null); }} className="flex-1 bg-gradient-to-br from-orange-500 to-orange-600 text-white font-black py-2 rounded-lg shadow-md active:scale-95 transition-transform text-[10px] uppercase">Leave</button>
            <button 
              onClick={() => {
                if (selectedRoomId) {
                  socket?.emit('bingo_get_state', selectedRoomId);
                  showNotification("Game state refreshed", "success");
                }
              }}
              className="flex-1 bg-gradient-to-br from-red-500 to-red-600 text-white font-black py-2 rounded-lg shadow-md active:scale-95 transition-transform text-[10px] uppercase flex items-center justify-center gap-1"
            >
              <RotateCw className="w-3 h-3" />
              Refresh
            </button>
            <button 
              disabled={selectedCards.length === 0}
              onClick={handleClaimBingo} 
              className={`flex-[1.5] bg-gradient-to-br text-black font-black py-2 rounded-lg shadow-md active:scale-95 transition-transform text-xs uppercase tracking-wider ${
                selectedCards.length === 0 
                  ? 'from-gray-600 to-gray-700 text-gray-400 cursor-not-allowed opacity-50 shadow-none' 
                  : 'from-yellow-400 via-yellow-500 to-yellow-600 shadow-yellow-500/20'
              }`}
            >
              BINGO!
            </button>
          </div>

          {/* Result Overlay */}
          <AnimatePresence>
            {roomState?.status === 'result' && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
              >
                <div className="bg-[#181a2e] border border-purple-500/20 rounded-3xl p-5 text-center max-w-[350px] w-full shadow-2xl scale-95 animate-in zoom-in-95 duration-300 flex flex-col gap-4 max-h-[95vh] overflow-y-auto custom-scrollbar">
                   {/* Top Crown visual */}
                   <div className="relative flex flex-col items-center pt-2">
                     <div className="w-12 h-12 rounded-full bg-gradient-to-b from-yellow-400 to-amber-600 flex items-center justify-center shadow-[0_0_20px_rgba(245,158,11,0.6)] border border-yellow-300 relative z-10">
                       <span className="text-2xl text-white">👑</span>
                     </div>
                     <div className="absolute top-0 w-20 h-20 bg-yellow-500/10 blur-xl rounded-full" />
                   </div>

                   <h3 className="text-2xl font-black text-yellow-400 tracking-wider uppercase">BINGO!</h3>
                   <p className="text-white font-bold text-xs -mt-2">
                     🎉 {roomState.winners.length} {roomState.winners.length === 1 ? 'ተጫዋች አሸንፏል' : 'ተጫዋቾች አሸንፈዋል'}!
                   </p>

                   {/* Winner list badges */}
                   <div className="flex flex-wrap gap-1.5 justify-center my-1 shrink-0">
                      {roomState.winners.length > 0 ? (
                        roomState.winners.map((w, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-1.5 px-3 py-1 bg-white/5 text-gray-300 border border-white/10 rounded-full text-[9px] font-black"
                          >
                            <div className="w-3 h-3 rounded-full bg-white/20 flex items-center justify-center text-[7.5px] font-black uppercase text-white">
                              {w.username.charAt(0)}
                            </div>
                            <span className="truncate max-w-[100px] text-white font-bold">
                              {w.username} #{w.cardId || w.cards?.[0] || '??'}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-gray-500 font-bold text-xs">No winners this round</p>
                      )}
                   </div>

                   {/* Winning Cards display - stacked downwards */}
                   <div className="flex flex-col gap-4 w-full overflow-y-auto max-h-[350px] pr-1 custom-scrollbar">
                     {roomState.winners.map((winner, idx) => {
                       const winnerCardId = winner.cardId || winner.cards?.[0] || 1;
                       return (
                         <div key={idx} className="bg-[#111322] rounded-2xl border border-purple-500/20 overflow-hidden shadow-xl flex flex-col p-2.5 shrink-0 animate-in fade-in zoom-in-95 duration-200">
                           <div className="flex items-center justify-between px-1 mb-2 shrink-0">
                             <span className="text-yellow-400 text-xs font-black">🏆 Winner: {winner.username}</span>
                             <span className="text-[11.5px] font-black text-purple-400 uppercase tracking-widest">
                               Cartela: #{winnerCardId}
                             </span>
                           </div>
                           <div className="w-full aspect-[5/6] max-h-[195px] flex flex-col mx-auto max-w-[240px]">
                             <BingoCardView
                               cardId={winnerCardId}
                               card={getDeterministicCard(winnerCardId)}
                               calledBalls={roomState.calledBalls}
                               compact
                               isWinnerCard={true}
                             />
                           </div>
                         </div>
                       );
                     })}
                   </div>

                   {/* Next Round Timer Badge */}
                   <div className="flex justify-center mt-1 shrink-0">
                     <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-white/5 border border-white/10 text-[9px] font-black text-gray-300 uppercase tracking-widest">
                       <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                       Auto-starting next game in {displayTime}s
                     </div>
                   </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }

  return (
    <div className="flex-1 flex flex-col h-full items-center justify-center bg-[#121421] text-white/20 p-10 text-center">
       <RotateCw className="w-10 h-10 mb-4 animate-spin opacity-20" />
       <p className="text-xs font-black uppercase tracking-[0.2em]">Connecting to Game Server...</p>
    </div>
  );
};

const BingoCardPreview: React.FC<{ id: number }> = ({ id }) => {
  const card = getDeterministicCard(id);
  return (
    <div className="bg-[#1a1c2e] border-2 border-purple-500/30 rounded-xl overflow-hidden shadow-2xl">
      <div className="bg-orange-500 px-2 py-1 text-black font-black text-[10.5px] text-center truncate">
        CARTELA NO: {id}
      </div>
      <div className="p-1">
        <div className="grid grid-cols-5 gap-0.5">
          {['B','I','N','G','O'].map((l, i) => (
            <div key={l} className={`text-center font-black text-[7px] py-0.5 rounded-sm ${
              ['bg-blue-500','bg-purple-500','bg-pink-500','bg-green-500','bg-orange-500'][i]
            } text-white`}>{l}</div>
          ))}
          {Array.from({length: 5}).map((_, row) => (
            Array.from({length: 5}).map((_, col) => (
              <div key={`${row}-${col}`} className={`h-5 w-5 flex items-center justify-center rounded-sm font-bold text-[8px] ${
                card[col][row] === 0 ? 'bg-purple-600 text-white' : 'bg-white text-[#121421]'
              }`}>
                {card[col][row] === 0 ? '★' : card[col][row]}
              </div>
            ))
          ))}
        </div>
      </div>
    </div>
  );
};

const getWinningCells = (card: number[][], calledBalls: number[]): Set<string> => {
  const winning = new Set<string>();
  const marked = card.map(col => col.map(num => num === 0 || calledBalls.includes(num)));

  // Check 4 corners
  if (marked[0][0] && marked[4][0] && marked[0][4] && marked[4][4]) {
    winning.add("0-0");
    winning.add("4-0");
    winning.add("0-4");
    winning.add("4-4");
  }

  // Check rows
  for (let row = 0; row < 5; row++) {
    let full = true;
    for (let col = 0; col < 5; col++) {
      if (!marked[col][row]) {
        full = false;
        break;
      }
    }
    if (full) {
      for (let col = 0; col < 5; col++) {
        winning.add(`${col}-${row}`);
      }
    }
  }

  // Check columns
  for (let col = 0; col < 5; col++) {
    let full = true;
    for (let row = 0; row < 5; row++) {
      if (!marked[col][row]) {
        full = false;
        break;
      }
    }
    if (full) {
      for (let row = 0; row < 5; row++) {
        winning.add(`${col}-${row}`);
      }
    }
  }

  // Check Diagonals
  let diag1 = true;
  let diag2 = true;
  for (let i = 0; i < 5; i++) {
    if (!marked[i][i]) diag1 = false;
    if (!marked[i][4 - i]) diag2 = false;
  }
  if (diag1) {
    for (let i = 0; i < 5; i++) {
      winning.add(`${i}-${i}`);
    }
  }
  if (diag2) {
    for (let i = 0; i < 5; i++) {
      winning.add(`${i}-${4 - i}`);
    }
  }

  return winning;
};

const BingoCardView: React.FC<{ 
  cardId?: number;
  card: number[][]; 
  calledBalls: number[]; 
  compact?: boolean;
  highlightMode?: 'auto' | 'manual';
  manuallyMarked?: Set<string>;
  onCellClick?: (num: number) => void;
  isWinnerCard?: boolean;
}> = ({ 
  cardId = 0, 
  card, 
  calledBalls, 
  compact, 
  highlightMode = 'auto', 
  manuallyMarked = new Set(), 
  onCellClick,
  isWinnerCard = false
}) => {
  const winningCells = isWinnerCard ? getWinningCells(card, calledBalls) : new Set<string>();

  return (
    <div className={`h-full flex flex-col ${compact ? 'p-0.5 gap-0.5' : 'p-1 gap-1'}`}>
      {/* Letters row */}
      <div className="grid grid-cols-5 gap-1 shrink-0 mb-1">
        {['B','I','N','G','O'].map((l, i) => (
          <div key={l} className={`text-center font-black ${compact ? 'text-[7px] py-0.5 rounded-sm' : 'text-[11px] py-1 rounded-md'} ${
            ['bg-blue-500','bg-purple-500','bg-pink-500','bg-green-500','bg-orange-500'][i]
          } text-white shadow-sm`}>{l}</div>
        ))}
      </div>
      
      {/* Numbers grid */}
      <div className="grid grid-cols-5 grid-rows-5 gap-1 flex-1 min-h-0">
        {Array.from({length: 5}).map((_, row) => (
          Array.from({length: 5}).map((_, col) => {
            const num = card[col][row];
            const isCalled = calledBalls.includes(num);
            const isFree = num === 0;
            const isHighlighted = highlightMode === 'auto'
              ? (isFree || isCalled)
              : (isFree || manuallyMarked.has(`${cardId}-${num}`));

            const isWinnerPattern = isWinnerCard && (winningCells.has(`${col}-${row}`) || isFree);

            return (
              <button 
                key={`${row}-${col}`} 
                disabled={isFree || highlightMode !== 'manual'}
                onClick={() => onCellClick?.(num)}
                className={`flex items-center justify-center font-medium transition-all h-full w-full select-none ${
                  compact ? 'text-[9px] rounded-sm' : 'text-[13px] md:text-base rounded-md'
                } ${
                  isWinnerCard
                    ? isWinnerPattern
                      ? 'bg-purple-600 text-white shadow-md'
                      : isCalled
                        ? 'bg-amber-500 text-[#121421] shadow-inner'
                        : 'bg-white text-[#121421] border border-gray-100'
                    : isFree 
                      ? 'bg-purple-600 text-white shadow-inner' 
                      : isHighlighted 
                        ? 'bg-purple-600 text-white shadow-md ring-1 ring-purple-400 ring-offset-0 active:scale-95 cursor-pointer' 
                        : 'bg-white text-[#121421] border border-gray-100 active:scale-95 hover:bg-gray-50 cursor-pointer'
                }`}
              >
                {isFree ? '★' : num}
              </button>
            );
          })
        ))}
      </div>
    </div>
  );
};

function getBallLabel(num: number): string {
  if (num >= 1 && num <= 15) return `B-${num}`;
  if (num >= 16 && num <= 30) return `I-${num}`;
  if (num >= 31 && num <= 45) return `N-${num}`;
  if (num >= 46 && num <= 60) return `G-${num}`;
  if (num >= 61 && num <= 75) return `O-${num}`;
  return `${num}`;
}
