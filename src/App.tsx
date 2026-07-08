import React, { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { RoomState, Side } from './types';
import { Wheel } from './components/Wheel';
import { JackpotArena } from './components/JackpotArena';
import { WheelOfChance } from './components/WheelOfChance';
import { Leaderboard } from './components/Leaderboard';
import { BingoGame, unlockBingoAudio } from './components/BingoGame';
import { ChevronLeft, Users, Clock, History, AlertCircle, Coins, Moon, Sun, Settings, X, HelpCircle, Search, Trophy, Gamepad2, TrendingUp, Wallet, User, Plus, ArrowUpRight, ArrowDownLeft, Copy, Check, ChevronRight, Dices, Binary, RefreshCw, Info, Award, Grid3X3, Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { playWin, playLoss, suspendAudio, resumeAudio } from './utils/sound';
import { triggerHaptic } from './utils/haptic';

const BACKEND_URL = (import.meta as any).env?.VITE_BACKEND_URL || window.location.origin;
const SOCKET_URL = BACKEND_URL;

interface HistoryItem {
  roundId: number;
  winner: number;
  betAmount?: number;
  betSide?: Side;
  netWin?: number;
}

const getTelegramUser = () => {
  if (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) {
    window.Telegram.WebApp.ready();
    const user = window.Telegram.WebApp.initDataUnsafe?.user;
    return user || null;
  }
  return null;
};

export default function App() {
  const [tgUser] = useState(getTelegramUser);
  const [socket, setSocket] = useState<Socket | null>(null);
  
  const [userId] = useState(() => tgUser?.id ? tgUser.id.toString() : 'user_' + Math.floor(Math.random() * 100000));
  const [roomState, setRoomState] = useState<RoomState | null>(() => {
    const saved = sessionStorage.getItem('roomState');
    return saved ? JSON.parse(saved) : null;
  });
  const [bingoRoomState, setBingoRoomState] = useState<any>(null);
  const [bingoRoomsMeta, setBingoRoomsMeta] = useState<any>(null);

  const [displayTime, setDisplayTime] = useState(0);


  // Smooth local timer for Even/Odd
  useEffect(() => {
    if (roomState?.status === 'betting' || roomState?.status === 'balancing' || roomState?.status === 'result') {
      setDisplayTime(roomState.timeLeft);
    }
  }, [roomState?.timeLeft, roomState?.status]);

  useEffect(() => {
    const timer = setInterval(() => {
      setDisplayTime(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Smooth local timer for Bingo


  const [username] = useState(() => tgUser?.username || tgUser?.first_name || 'Player_' + Math.floor(Math.random() * 1000));
  const [photoUrl] = useState(() => tgUser?.photo_url || null);
  const [firstName] = useState(() => tgUser?.first_name || '');
  const [lastName] = useState(() => tgUser?.last_name || '');

  const [balance, setBalance] = useState<number | null>(null);
  const [isBalanceSynced, setIsBalanceSynced] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string>('Main-Room');
  const [selectedBingoRoomId, setSelectedBingoRoomId] = useState<string | null>(null);
  const selectedBingoRoomIdRef = useRef(selectedBingoRoomId);
  useEffect(() => {
    selectedBingoRoomIdRef.current = selectedBingoRoomId;
  }, [selectedBingoRoomId]);
  
  const [roomsStatus, setRoomsStatus] = useState<Record<string, { status: string, even: number, odd: number }>>({});

  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [failedBet, setFailedBet] = useState<{ side: Side; amount: number } | null>(null);
  const [isPlacingBet, setIsPlacingBet] = useState<boolean>(false);
  const [affiliateStats, setAffiliateStats] = useState<{totalReferrals: number, totalEarned: number, availableBalance: number, isFlagged: boolean} | null>(null);

  const showNotification = React.useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
  }, []);

  useEffect(() => {
    if (socket) {
      socket.on('syncBalance', (newBalance: number) => {
        setBalance(newBalance);
        setIsBalanceSynced(true);
      });
      return () => {
        socket.off('syncBalance');
      };
    }
  }, [socket]);

  const handleTriggerFlow = async (type: 'deposit' | 'withdraw') => {
    const tgUsername = botUsername || 'YOUR_BOT_USERNAME';
    if (tgUser?.id && window.Telegram?.WebApp) {
      try {
        showNotification(`Triggering ${type} flow...`, "info");
        const res = await fetch(`${BACKEND_URL}/api/trigger-bot-flow`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: tgUser.id, flowType: type })
        });
        if (res.ok) {
          window.Telegram.WebApp.close();
        } else {
          window.Telegram.WebApp.openTelegramLink(`https://t.me/${tgUsername}?start=${type}`);
        }
      } catch (err) {
        console.error("Failed to trigger flow via API:", err);
        window.Telegram.WebApp.openTelegramLink(`https://t.me/${tgUsername}?start=${type}`);
      }
    } else {
      if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.openTelegramLink(`https://t.me/${tgUsername}?start=${type}`);
      } else {
        window.open(`https://t.me/${tgUsername}?start=${type}`, '_blank');
        showNotification("Opening Telegram Bot...", "success");
      }
    }
  };

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => {
      setNotification(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    if (window.Telegram?.WebApp) {
      const webApp = window.Telegram.WebApp as any;
      webApp.ready();
      webApp.expand();
      webApp.enableClosingConfirmation();
      try {
        // This helps prevent background scrolling and unexpected movement
        webApp.disableVerticalSwipes?.();
      } catch (e) {
        console.warn("disableVerticalSwipes not supported", e);
      }
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        suspendAudio();
      } else {
        resumeAudio();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const [betAmount, setBetAmount] = useState<number | null>(null);
  const [partialBet, setPartialBet] = useState<boolean>(true);
  const [showResult, setShowResult] = useState<boolean>(false);
  const [lastWinner, setLastWinner] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    return roomState?.history || [];
  });
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);

  const [pulseSide, setPulseSide] = useState<Side | null>(null);
  
  const [soundTicks, setSoundTicks] = useState<boolean>(true);
  const [soundAlerts, setSoundAlerts] = useState<boolean>(true);
  const [bingoSoundEnabled, setBingoSoundEnabled] = useState<boolean>(true);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const soundAlertsRef = useRef(true);
  
  const [activeTab, setActiveTab] = useState<'even_odd' | 'jackpot' | 'chance' | 'bingo' | 'profile'>('even_odd');
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const [initialRoomChance, setInitialRoomChance] = useState<'1-10' | '1-20' | undefined>(undefined);
  const [initialTierJackpot, setInitialTierJackpot] = useState<'mini' | 'grand' | undefined>(undefined);

  useEffect(() => {
    // Get start_param from Telegram WebApp
    let startParam = "";
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      startParam = (window.Telegram.WebApp.initDataUnsafe as any)?.start_param || "";
    }

    if (!BACKEND_URL) return;

    fetch(`${BACKEND_URL}/api/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, startParam })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.roomId) {
          const rId = data.roomId;
          if (rId === '1-10' || rId === '1-20') {
            setInitialRoomChance(rId);
            setActiveTab('chance');
            showNotification(`Welcome! Switched to Wheel of Chance room ${rId}`, 'success');
          } else if (rId === 'mini' || rId === 'grand') {
            setInitialTierJackpot(rId);
            setActiveTab('jackpot');
            showNotification(`Welcome! Switched to Jackpot Arena tier ${rId}`, 'success');
          }
        }
      })
      .catch(err => {
        console.error("Failed to initialize session with deep link:", err);
      });
  }, [userId]);

  const [isWalletOpen, setIsWalletOpen] = useState<boolean>(false);
  const [ledgerTab, setLedgerTab] = useState<'play' | 'transactions'>('play');
  const [isJackpotTheaterMode, setIsJackpotTheaterMode] = useState<boolean>(false);
  const [isPlayersDrawerOpen, setIsPlayersDrawerOpen] = useState<boolean>(false);
  const [isEvenOddInfoOpen, setIsEvenOddInfoOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [gameHistory, setGameHistory] = useState<any[]>([]);
  const [historyFilter, setHistoryFilter] = useState<string>('all');

  const [botUsername, setBotUsername] = useState<string>('');
  const [copiedId, setCopiedId] = useState<boolean>(false);

  useEffect(() => {
    if (!BACKEND_URL) return;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    fetch(`${BACKEND_URL}/api/bot-info`, { signal: controller.signal })
      .then(res => {
        clearTimeout(timeoutId);
        const contentType = res.headers.get("content-type");
        if (res.ok && contentType && contentType.includes("application/json")) {
          return res.json();
        }
        return null;
      })
      .then(data => {
        if (data && data.username) setBotUsername(data.username);
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.warn("Failed to fetch bot-info gracefully:", err.message);
        }
      });
      
    return () => clearTimeout(timeoutId);
  }, []);

  const [leaderboardStats, setLeaderboardStats] = useState<{
    startOfWeek: string;
    totalPlatformVolume: number;
    platformFees: number;
    promoterJackpot: number;
    leaderboard: any[];
  } | null>(null);
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState<boolean>(false);

  const fetchLeaderboard = () => {
    if (!BACKEND_URL) return;
    setIsLeaderboardLoading(true);
    fetch(`${BACKEND_URL}/api/leaderboard`)
      .then(res => res.json())
      .then(data => {
        setLeaderboardStats(data);
        setIsLeaderboardLoading(false);
      })
      .catch(err => {
        console.error("Error fetching leaderboard:", err);
        setIsLeaderboardLoading(false);
      });
  };

  useEffect(() => {
    if (activeTab === 'profile') {
      fetchLeaderboard();
    }
  }, [activeTab]);

  const totalActivePlayersCount = activeTab === 'bingo' ? (bingoRoomState?.onlineCount || 0) : (roomState?.onlineCount || 0);

  const vipPlayersList = React.useMemo(() => {
    const realPlayers = roomState?.players || {};
    
    const list: any[] = [];
    
    // Add real players first
    Object.entries(realPlayers).forEach(([id, playerObj]) => {
      const p = playerObj as any;
      list.push({
        id,
        username: p.username || `@User_${id.slice(5, 9)}`,
        amount: p.amount,
        side: p.side,
        photoUrl: p.photoUrl || null,
        badge: p.amount >= 10000 ? "Crown VIP" : p.amount >= 5000 ? "Gold VIP" : "VIP Pro",
        joinTime: "0.1s",
        isReal: true,
      });
    });

    // Ensure current user is always included in the online listing
    const currentInList = list.some(p => p.id === userId);
    if (!currentInList) {
      list.push({
        id: userId,
        username: username || "You",
        photoUrl: photoUrl || null,
        amount: 0,
        side: undefined,
        badge: "Active Player",
        joinTime: "Online",
        isReal: true,
      });
    }

    return list;
  }, [roomState?.roundId, roomState?.players, totalActivePlayersCount, userId, username, photoUrl]);
  
  useEffect(() => {
    soundAlertsRef.current = soundAlerts;
  }, [soundAlerts]);

  const [isInputFocused, setIsInputFocused] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket'],
      upgrade: false,
      reconnectionAttempts: 10,
      timeout: 5000
    });
    setSocket(newSocket);

    newSocket.on('connect_error', (err) => {
      console.warn("Socket connection error, falling back to polling if available:", err.message);
    });

    newSocket.on('roomsStatus', (status) => setRoomsStatus(status));
    
    const interval = setInterval(() => {
       newSocket.emit('getRoomsStatus');
    }, 2000);

    return () => {
      newSocket.disconnect();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onConnect = () => {
      socket.emit('joinRoom', currentRoom);
      socket.emit('getRoomsStatus');
      socket.emit('syncUser', userId, username, photoUrl, firstName, lastName);
      socket.emit('getUserTransactions', userId);
      socket.emit('getUserGameLogs', userId);
      socket.emit('getAffiliateStats', userId);
    };

    if (socket.connected) {
      onConnect();
    }

    socket.on('connect', onConnect);
    
    socket.on('syncBalance', (serverBalance: number) => {
      setBalance(serverBalance);
    });

    socket.on('balanceUpdated', (data: { userId: string, balance: number }) => {
      if (data.userId === userId) {
        setBalance(data.balance);
        showNotification(`Wallet updated to ${data.balance.toLocaleString()} ETB`, 'success');
        socket.emit('getUserTransactions', userId);
        socket.emit('getUserGameLogs', userId);
        socket.emit('getAffiliateStats', userId);
      }
    });

    socket.on('affiliateStats', (stats: {totalReferrals: number, totalEarned: number, availableBalance: number, isFlagged: boolean}) => {
      setAffiliateStats(stats);
    });

    socket.on('notification', (data: { message: string, type: 'success' | 'error' | 'info' }) => {
        showNotification(data.message, data.type);
        // If it's a success payout request, refresh affiliate stats
        if (data.message.includes("Payout request submitted")) {
            socket.emit("getAffiliateStats", userId);
        }
    });

    socket.on('userTransactions', (data: any[]) => {
      const formatted = data.map(tx => ({
        id: tx.id,
        type: tx.type === 'win' || tx.type === 'reward' || tx.type === 'refund' ? 'reward' : 'bet',
        desc: tx.description,
        amount: tx.amount,
        date: new Date(tx.created_at).toLocaleString(),
        positive: tx.amount > 0
      }));
      setTransactions(formatted);
    });

    socket.on('userGameLogs', (data: any[]) => {
      // Ensure we only show logs for the current user, just in case the server sends more
      const userLogs = data.filter(log => log.user_id === userId);
      const formatted = userLogs.map(log => {
        let rawType = log.game_type || '';
        let gameType = rawType;
        let roundId = log.id.slice(0, 8).toUpperCase();
        let playerChoice = '-';
        let winningNums = '-';
        
        if (rawType.includes(' | ')) {
          const parts = rawType.split(' | ');
          gameType = parts[0];
          for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed.startsWith('R#')) {
              roundId = trimmed;
            } else if (trimmed.startsWith('Choice:')) {
              playerChoice = trimmed.substring(7);
            } else if (trimmed.startsWith('WinNum:')) {
              winningNums = trimmed.substring(7);
            }
          }
        }

        let guessedBet = 0;
        const gLower = gameType.toLowerCase();
        if (gLower.includes('1-10')) guessedBet = 500;
        else if (gLower.includes('1-20')) guessedBet = 1000;
        else if (gLower.includes('mini')) guessedBet = 1000;
        else if (gLower.includes('grand')) guessedBet = 2000;

        return {
          id: roundId,
          type: gameType,
          bet: guessedBet,
          numbers: playerChoice,
          winningNums: winningNums,
          result: log.result,
          change: log.win_amount,
          date: new Date(log.created_at).toLocaleString(),
          status: 'Completed'
        };
      });
      setGameHistory(formatted);
    });

    socket.on('recentRounds', (roundsData: any[]) => {
      const mappedHistory: HistoryItem[] = roundsData.map((r: any) => ({
        roundId: r.round_number,
        winner: r.winner,
      }));
      setHistory(mappedHistory);
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('syncBalance');
      socket.off('userTransactions');
      socket.off('userGameLogs');
      socket.off('recentRounds');
    };
  }, [socket, currentRoom, userId, username]);

  useEffect(() => {
    if (!socket) return;

    socket.on('bingo_rooms_meta', (meta: any) => {
      setBingoRoomsMeta(meta);
    });

    socket.on('bingo_state', (state: any) => {
      if (activeTabRef.current === 'bingo' && state && state.id === selectedBingoRoomIdRef.current) {
        setBingoRoomState(state);
      }
    });
    
    socket.on('roomState', (state: RoomState) => {
      setRoomState(state);
      sessionStorage.setItem('roomState', JSON.stringify(state));

      if (state.history) {
        setHistory(state.history as any);
      }

      if (state.status === 'result' && state.winner) {
        if (!showResult && lastWinner !== state.winner) {
          const isActive = activeTabRef.current === 'even_odd';
          if (isActive) {
            setShowResult(true);
            triggerHaptic('notification', 'success');
          }
          setLastWinner(state.winner);
          
          // Check if we won
          const myBet = state.players[userId];
          if (myBet) {
             const isEven = state.winner % 2 === 0;
             const isEvenWinner = state.winner % 2 === 0;
             const mySideWon = (isEvenWinner && myBet.side === 'even') || (!isEvenWinner && myBet.side === 'odd');
             const isActive = activeTabRef.current === 'even_odd';
             
             if (mySideWon) {
                if (soundAlertsRef.current) {
                   if (isActive) playWin();
                 }
             } else {
                if (soundAlertsRef.current) {
                   if (isActive) playLoss();
                 }
             }
             
             // The server handles balance updates and transaction logging
             // Client just needs to refresh its view
             socket?.emit('syncUser', userId, username, photoUrl);
             socket?.emit('getUserTransactions', userId);
             socket?.emit('getUserGameLogs', userId);
          }
        }
      } else {
        setShowResult(false);
        setLastWinner(null);
      }
    });

    socket.on('refund', (amount: number) => {
      socket.emit('syncUser', userId, username, photoUrl);
      showNotification(`Bet partially refunded: ${amount.toLocaleString()} ETB`, 'info');
    });

    return () => {
      socket.off('roomState');
      socket.off('bingo_state');
      socket.off('refund');
    };
  }, [socket, showResult, lastWinner, userId]);

  const handleJoinRoom = React.useCallback((roomId: string) => {
    if (socket) {
      socket.emit('joinRoom', roomId);
      setCurrentRoom(roomId);
    }
  }, [socket]);

  const handlePlaceBet = (side: Side, retryAmount?: number) => {
    const targetAmount = retryAmount !== undefined ? retryAmount : betAmount;
    if (targetAmount === null || targetAmount === 0) {
      showNotification("Please select or enter a bet amount!", "error");
      return;
    }
    if (!socket) {
      showNotification("Not connected to server. Retrying connection...", "error");
      setFailedBet({ side, amount: targetAmount });
      return;
    }
    if (!roomState) {
      showNotification("Waiting for room state. Please wait...", "info");
      setFailedBet({ side, amount: targetAmount });
      return;
    }
    if (roomState.status !== 'betting') {
      showNotification("Betting is not active right now.", "error");
      setFailedBet({ side, amount: targetAmount });
      return;
    }
    if (roomState.timeLeft < 5) {
      showNotification("Betting is closed for this round.", "error");
      setFailedBet({ side, amount: targetAmount });
      return;
    }

    if (targetAmount < 200) {
      showNotification("Minimum bet is 200 ETB", "error");
      return;
    }

    const myBet = roomState.players[userId];
    const currentBetAmount = myBet ? myBet.amount : 0;
    const diff = targetAmount - currentBetAmount;

    if (balance < diff) {
       showNotification("Insufficient balance for this bet!", "error");
       setFailedBet({ side, amount: targetAmount });
       return;
    }

    setIsPlacingBet(true);
    setFailedBet(null);

    let hasResponded = false;
    const timeoutTimer = setTimeout(() => {
      if (!hasResponded) {
        setIsPlacingBet(false);
        setFailedBet({ side, amount: targetAmount });
        showNotification("Bet placement timed out. Try again?", "error");
      }
    }, 4000);

    socket.emit('placeBet', {
      roomId: currentRoom,
      userId,
      username,
      amount: targetAmount,
      side,
      partial: partialBet
    }, (res: any) => {
      hasResponded = true;
      clearTimeout(timeoutTimer);
      setIsPlacingBet(false);

      if (res && res.success) {
         setPulseSide(side);
         setTimeout(() => setPulseSide(null), 300);
         if (window.Telegram?.WebApp?.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
         }
         showNotification(`Successfully placed ${targetAmount.toLocaleString()} bet!`, "success");
         
         // Fetch latest balance and history from server immediately
         socket.emit('syncUser', userId, username, photoUrl);
         socket.emit('getUserTransactions', userId);
      } else {
         const errMsg = res?.message || "Server failed to process bet.";
         showNotification(errMsg, "error");
         setFailedBet({ side, amount: targetAmount });
      }
    });
  };

  const handlePlaceBetRef = useRef(handlePlaceBet);
  const setBetAmountRef = useRef(setBetAmount);

  useEffect(() => {
    handlePlaceBetRef.current = handlePlaceBet;
    setBetAmountRef.current = setBetAmount;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showSettings) return;

      if (document.activeElement?.tagName === 'INPUT') {
        if (e.key === 'Enter') {
          e.preventDefault();
          (document.activeElement as HTMLElement).blur();
          handlePlaceBetRef.current('even');
        }
        return;
      }
      
      if (e.key === 'Enter') {
        e.preventDefault();
        handlePlaceBetRef.current('even');
      } else if (e.key === '1') {
        setBetAmountRef.current(1000);
      } else if (e.key === '2') {
        setBetAmountRef.current(2000);
      } else if (e.key === '5') {
        setBetAmountRef.current(5000);
      } else if (e.key === '0') {
        setBetAmountRef.current(10000);
      } else if (e.key.toLowerCase() === 'e') {
        handlePlaceBetRef.current('even');
      } else if (e.key.toLowerCase() === 'o') {
        handlePlaceBetRef.current('odd');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSettings]);

  const isSoftClosed = roomState?.status === 'betting' && roomState.timeLeft < 5;

  const getDerashAmount = () => {
    if (!bingoRoomState) return 0;
    if (bingoRoomState.jackpot !== undefined) return bingoRoomState.jackpot;
    const pCount = Object.keys(bingoRoomState.players || {}).length;
    const bet = bingoRoomState.betAmount || 10;
    return Math.floor(pCount * bet * 0.8);
  };

  return (
    <div className={isDarkMode ? "dark" : ""}>
      <div className="h-screen max-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100 flex flex-col w-full max-w-md mx-auto relative overflow-hidden font-sans transition-colors duration-300 overscroll-none select-none" style={{ touchAction: 'pan-y' }}>
        
        {/* Top Header Panel */}
        {!isJackpotTheaterMode && (
          <header className="flex justify-between items-center px-4 py-2 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 shrink-0 transition-colors duration-300 z-40 fixed top-0 left-0 right-0 w-full max-w-md mx-auto">
            {activeTab === 'bingo' && selectedBingoRoomId && bingoRoomState?.status === 'lobby' ? (
              // BINGO LOBBY HEADER: Equal space between balance, timer, label, and profile
              <div className="flex items-center justify-between w-full">
                <button 
                  onClick={() => {
                    socket?.emit('bingo_leave', { roomId: selectedBingoRoomId, userId });
                    setSelectedBingoRoomId(null);
                    setBingoRoomState(null);
                  }}
                  className="flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-purple-500 active:scale-95 transition-transform border border-gray-200 dark:border-gray-700 shrink-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setIsWalletOpen(true)}
                  className="flex items-center gap-1 bg-yellow-500/10 hover:bg-yellow-500/20 dark:bg-yellow-500/5 dark:hover:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30 px-1.5 py-1 rounded-full text-[11px] font-bold transition-all active:scale-95 cursor-pointer shrink-0"
                >
                  <Coins className="w-3 h-3 text-yellow-500 shrink-0" />
                  <span className="font-mono font-black">{balance === null ? '...' : balance.toLocaleString()}</span>
                </button>

                <div className="flex items-center gap-1.5 bg-orange-500/10 px-2 py-1.5 rounded-full border border-orange-500/30 shadow-lg shadow-orange-500/10 shrink-0">
                   <Clock className="w-3.5 h-3.5 text-orange-500 animate-pulse shrink-0" />
                   <span className={`font-mono text-[14px] font-black tracking-tighter ${(bingoRoomState?.timeLeft || 0) < 10 ? 'text-red-500 animate-pulse' : 'text-orange-500'}`}>
                    {(bingoRoomState?.timeLeft || 0)}s
                  </span>
                </div>

                <div className="text-[11px] font-black text-orange-400 uppercase tracking-widest px-1.5 py-1 bg-orange-500/10 border border-orange-500/30 rounded-lg whitespace-nowrap shrink-0">
                  {selectedBingoRoomId === 'bingo-10' ? 'ባለ 10' : 'ባለ 20'}
                </div>

                <button
                  onClick={() => setActiveTab('profile')}
                  className="p-0 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 transition-all active:scale-95 cursor-pointer relative w-7 h-7 flex items-center justify-center overflow-hidden shrink-0"
                >
                  {photoUrl ? (
                    <img src={photoUrl} alt="Avatar" className="w-full h-full object-cover rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <User className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            ) : (
              // DEFAULT HEADER FOR OTHER TABS
              <>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsWalletOpen(true)}
                    className="flex items-center gap-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 dark:bg-yellow-500/5 dark:hover:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30 px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 cursor-pointer shrink-0"
                  >
                    <Coins className="w-3.5 h-3.5 text-yellow-500" />
                    <span className="font-mono font-black">{balance === null ? '...' : balance.toLocaleString()}</span>
                  </button>

                  {activeTab === 'bingo' && bingoRoomState && !(!selectedBingoRoomId) && (
                    <div className="flex flex-col items-center justify-center bg-green-500/10 dark:bg-green-500/5 text-green-600 dark:text-green-400 border border-green-500/30 rounded-lg py-1 px-2 select-none shrink-0 text-[9px] font-bold leading-none gap-1 animate-in fade-in duration-300 w-[85px]">
                      <span className="text-[9px] font-black tracking-wider text-green-600/70 dark:text-green-400/70 uppercase font-bold">DERASH</span>
                      <div className="border-t border-green-500/20 pt-1 w-full text-center">
                        <span className="font-mono font-black text-[10px] text-green-600 dark:text-green-400">
                          {getDerashAmount().toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center justify-center">
                  {activeTab === 'even_odd' && roomState?.status !== 'spinning' && roomState?.status !== 'result' && (
                    <div className="flex items-center gap-1 bg-blue-50 dark:bg-blue-950/40 px-3 py-1 rounded-full border border-blue-100 dark:border-blue-900/50 animate-in fade-in duration-300">
                      <Clock className="w-3 h-3 text-blue-500 animate-pulse" />
                      <span className={`font-mono text-sm font-black tracking-tight ${displayTime < 10 ? 'text-red-500 animate-pulse' : 'text-blue-600 dark:text-blue-400'}`}>
                        00:{displayTime.toString().padStart(2, '0')}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {activeTab === 'bingo' ? (
                    bingoRoomState && (bingoRoomState.status === 'playing' || bingoRoomState.status === 'result') && !(!selectedBingoRoomId) && (
                      <div className="flex flex-col items-center justify-center bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg py-1 px-2 select-none shrink-0 text-[9px] font-bold leading-none gap-1 animate-in fade-in duration-300 w-[85px]">
                        <button 
                          id="players-portal-btn-top"
                          onClick={() => setIsPlayersDrawerOpen(true)}
                          className="flex items-center justify-center gap-1 font-black text-orange-500 active:scale-95 transition-transform w-full"
                        >
                          <span>PLAYERS</span>
                          <span className="font-mono font-black text-gray-800 dark:text-gray-100">{totalActivePlayersCount}</span>
                        </button>
                        <div className="flex items-center justify-center gap-1 font-black text-purple-500 border-t border-gray-300/30 dark:border-gray-700/30 pt-1 w-full">
                          <span>CALLED</span>
                          <span className="font-mono font-black text-gray-800 dark:text-gray-100">{bingoRoomState.calledBalls?.length || 0}</span>
                        </div>
                      </div>
                    )
                  ) : (
                    <button 
                      id="players-portal-btn-top"
                      onClick={() => setIsPlayersDrawerOpen(true)}
                      className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-full px-2.5 py-1.5 border border-gray-200 dark:border-gray-700 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer animate-in fade-in duration-300"
                    >
                      <Users className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                      <span className="font-mono tracking-tight font-bold">{totalActivePlayersCount}</span>
                    </button>
                  )}
                  
                  {activeTab === 'bingo' && bingoRoomState && (bingoRoomState.status === 'playing' || bingoRoomState.status === 'result') && !(!selectedBingoRoomId) && (
                    <button
                      onClick={() => { unlockBingoAudio(); setBingoSoundEnabled(!bingoSoundEnabled); }}
                      className="p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-green-500 hover:text-green-600 dark:text-green-400 dark:hover:text-green-300 border border-gray-200 dark:border-gray-700 transition-all active:scale-95 cursor-pointer flex items-center justify-center w-8 h-8 shrink-0 select-none animate-in fade-in duration-300"
                      title={bingoSoundEnabled ? "Mute Caller Voice" : "Unmute Caller Voice"}
                    >
                      {bingoSoundEnabled ? <Volume2 className="w-4.5 h-4.5" /> : <VolumeX className="w-4.5 h-4.5 text-gray-400" />}
                    </button>
                  )}
                  
                  {!(activeTab === 'bingo' && selectedBingoRoomId && bingoRoomState?.status !== 'lobby') && (
                    <button
                      onClick={() => setActiveTab('profile')}
                      className="p-0 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 transition-all active:scale-95 cursor-pointer relative w-8 h-8 flex items-center justify-center overflow-hidden shrink-0"
                    >
                      {photoUrl ? (
                        <img src={photoUrl} alt="Avatar" className="w-full h-full object-cover rounded-full" referrerPolicy="no-referrer" />
                      ) : (
                        <User className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </>
            )}
          </header>
        )}

        {/* Global Notifications Handler */}
        {notification && (
          <div className={`absolute left-4 right-4 z-[100] animate-in fade-in slide-in-from-top-4 duration-300 ${isJackpotTheaterMode ? 'top-4' : 'top-16'}`}>
            <div className={`rounded-xl px-4 py-3 shadow-lg flex items-center gap-2 border text-sm font-semibold transition-all duration-300 ${
              notification.type === 'success' 
                ? 'bg-green-50 text-green-900 border-green-200 dark:bg-green-950/40 dark:text-green-100 dark:border-green-900/50' 
                : notification.type === 'error'
                ? 'bg-red-50 text-red-900 border-red-200 dark:bg-red-950/40 dark:text-red-100 dark:border-red-900/50'
                : 'bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950/40 dark:text-blue-100 dark:border-blue-900/50'
            }`}>
              <AlertCircle className={`w-4 h-4 shrink-0 ${
                notification.type === 'success' ? 'text-green-500' : notification.type === 'error' ? 'text-red-500' : 'text-blue-500'
              }`} />
              <span className="flex-1">{notification.message}</span>
              <button onClick={() => setNotification(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 font-bold ml-2">×</button>
            </div>
          </div>
        )}

        {/* Scrollable Main Content Frame */}
        <main className={`flex-1 min-h-0 relative z-10 flex flex-col transition-all duration-300 ${activeTab === 'bingo' ? 'px-0 overflow-hidden pb-14' : 'px-4 overflow-y-auto overflow-x-hidden pb-[62px]'} ${isJackpotTheaterMode ? 'pt-4 pb-4' : 'pt-[52px]'}`}>
            
            {/* TAB 1: Game Arena (Even/Odd) */}
            <div
              className={`flex-1 flex-col justify-between py-4 relative ${activeTab === 'even_odd' ? 'flex' : 'hidden'}`}
            >
              {/* Info Icon Button */}
              <button
                onClick={() => setIsEvenOddInfoOpen(true)}
                className="absolute top-0 left-0 z-30 w-6 h-6 rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-all active:scale-95 cursor-pointer flex items-center justify-center shadow-md shadow-blue-500/20"
                title="የጨዋታ መረጃ"
              >
                <span className="font-serif font-black italic text-[13px] leading-none select-none">i</span>
              </button>
              {/* Wheel Canvas & Quick Arena Label */}
              <div className="relative mx-auto flex flex-col items-center my-auto">
                <div className="absolute -top-4 -right-4 z-20 text-[10px] font-black uppercase text-blue-500 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full tracking-widest">
                  Round #{roomState?.roundId || '...'}
                </div>
                <Wheel status={roomState?.status || 'betting'} winner={roomState?.winner} soundTicks={soundTicks && activeTab === 'even_odd'} timeLeft={roomState?.timeLeft} />
              </div>

                {/* Result Announcement Overlay */}
                {showResult && roomState?.winner && (
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-50 flex items-center justify-center p-4">
                    <div className="bg-white/95 dark:bg-gray-900/95 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 text-center shadow-2xl max-w-xs mx-auto animate-in zoom-in duration-300 backdrop-blur-md">
                      <div className="text-4xl mb-2">🎉</div>
                      <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Winner Number Is:</h2>
                      <div className="text-5xl font-black text-gray-900 dark:text-white my-3 animate-bounce tracking-tight font-mono">
                        {roomState.winner}
                      </div>
                      <div className={`text-sm font-black uppercase px-6 py-2.5 rounded-full inline-block text-white tracking-wider ${roomState.winner % 2 === 0 ? 'bg-red-500 shadow-md shadow-red-500/20' : 'bg-blue-500 shadow-md shadow-blue-500/20'}`}>
                        {roomState.winner % 2 === 0 ? 'ሞላ (EVEN)' : 'ጎደል (ODD)'} WINS!
                      </div>
                    </div>
                  </div>
                )}

                {/* Betting controls dashboard */}
                <div className="px-4 space-y-4 mt-auto">
                  {/* Shortcut Amounts Grid */}
                  <div className="flex gap-2 justify-center">
                    {[200, 1000, 2000, 5000, 10000, 20000].map(amt => (
                      <button
                        key={amt}
                        onClick={() => setBetAmount(amt)}
                        className={`px-3 py-2 rounded-xl text-xs font-black transition-all transform active:scale-95 flex-1 ${
                          betAmount === amt 
                            ? 'bg-yellow-500 text-black shadow-sm font-bold scale-[1.02]' 
                            : 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {amt >= 1000 ? `${amt/1000}k` : amt}
                      </button>
                    ))}
                  </div>

                  {/* Input and Partial Bet options row */}
                  <div className="flex gap-2">
                    {/* Bet Amount Input */}
                    <div className="flex flex-1 bg-white/40 dark:bg-gray-900/40 rounded-xl p-0.5 border border-gray-200 dark:border-gray-800 transition-all duration-300 items-center relative overflow-hidden">
                      <div className={`absolute inset-0 bg-white/60 dark:bg-gray-900/60 transition-all duration-300 -z-10 ${!isInputFocused ? 'backdrop-blur-[2px]' : 'backdrop-blur-none'}`} />
                      <input
                        type="number"
                        min="200"
                        step="10"
                        value={betAmount || ''}
                        onFocus={() => setIsInputFocused(true)}
                        onBlur={() => setIsInputFocused(false)}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBetAmount(val === '' ? null : Math.max(0, parseInt(val) || 0));
                        }}
                        className="bg-transparent text-gray-800 dark:text-gray-200 px-3 py-1.5 text-center font-bold text-sm outline-none w-full transition-colors placeholder:text-gray-400 dark:placeholder:text-gray-600 z-10"
                        placeholder="min bet 200"
                      />
                    </div>

                    {/* Partial Bet toggle Switch */}
                    <div className="flex justify-between items-center bg-white dark:bg-gray-900 rounded-xl px-3 py-1 border border-gray-200 dark:border-gray-800 transition-colors shrink-0 gap-2">
                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Partial</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={partialBet} onChange={e => setPartialBet(e.target.checked)} className="sr-only peer" />
                        <div className="w-8 h-4.5 bg-gray-300 dark:bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>
                  </div>

                  {/* Failed Bet Retry Banner helper */}
                  {failedBet && (
                    <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-xl p-3 text-sm text-red-800 dark:text-red-200 animate-in fade-in duration-300">
                      <div className="flex items-center gap-1.5 text-xs">
                        <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        <span>Bet of <strong>{failedBet.amount}</strong> failed.</span>
                      </div>
                      <button 
                        onClick={() => handlePlaceBet(failedBet.side, failedBet.amount)}
                        className="bg-red-600 hover:bg-red-500 text-white font-black px-2.5 py-1 rounded-lg text-[10px] transition-colors shadow-sm cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  {/* Placement Actions: EVEN and ODD */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => handlePlaceBet('even')}
                      disabled={roomState?.status !== 'betting' || isSoftClosed}
                      className={`flex-1 font-black py-3.5 rounded-xl active:shadow-none active:translate-y-[2px] transition-all text-base uppercase tracking-wider flex flex-col items-center justify-center ${
                        pulseSide === 'even' ? 'scale-95 brightness-150' : ''
                      } ${
                        roomState?.players[userId]?.side === 'even'
                          ? 'bg-red-500 shadow-none translate-y-[2px] ring-2 ring-white dark:ring-gray-950 ring-offset-2 ring-offset-red-500'
                          : 'bg-red-600 hover:bg-red-500 shadow-[0_4px_0_rgb(185,28,28)]'
                      } disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer`}
                    >
                      <span>ሞላ (Even)</span>
                      {roomState?.players[userId]?.side === 'even' && (
                        <span className="text-[10px] font-black mt-0.5 bg-black/30 px-2 py-0.5 rounded-full">
                          {roomState.players[userId].amount.toLocaleString()} Bet
                        </span>
                      )}
                    </button>

                    <button
                      onClick={() => handlePlaceBet('odd')}
                      disabled={roomState?.status !== 'betting' || isSoftClosed}
                      className={`flex-1 font-black py-3.5 rounded-xl active:shadow-none active:translate-y-[2px] transition-all text-base uppercase tracking-wider flex flex-col items-center justify-center ${
                        pulseSide === 'odd' ? 'scale-95 brightness-150' : ''
                      } ${
                        roomState?.players[userId]?.side === 'odd'
                          ? 'bg-blue-500 shadow-none translate-y-[2px] ring-2 ring-white dark:ring-gray-950 ring-offset-2 ring-offset-blue-500'
                          : 'bg-blue-600 hover:bg-blue-500 shadow-[0_4px_0_rgb(29,78,216)]'
                      } disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer`}
                    >
                      <span>ጎደል (Odd)</span>
                      {roomState?.players[userId]?.side === 'odd' && (
                        <span className="text-[10px] font-black mt-0.5 bg-black/30 px-2 py-0.5 rounded-full">
                          {roomState.players[userId].amount.toLocaleString()} Bet
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Recent round mini list */}
                  {history.length > 0 && (
                    <div className="bg-white dark:bg-gray-900 rounded-xl p-3 border border-gray-200 dark:border-gray-800 transition-colors">
                      <div className="flex justify-between items-center mb-2">
                        <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-wider flex items-center gap-1">
                          <History className="w-3 h-3" /> Recent Results
                        </h3>
                        <span className="text-[9px] font-semibold text-gray-400">Showing last 10</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {history.slice(0, 10).map((h, index) => {
                          const isEven = h.winner % 2 === 0;
                          return (
                            <div 
                              key={`${h.roundId}-${index}`} 
                              className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono font-black text-[11px] border transition-all ${
                                isEven 
                                  ? 'bg-red-500/10 text-red-500 border-red-500/20 shadow-xs' 
                                  : 'bg-blue-500/10 text-blue-500 border-blue-500/20 shadow-xs'
                              }`}
                              title={`Round #${h.roundId}: ${h.winner} (${isEven ? 'Even' : 'Odd'})`}
                            >
                              {h.winner}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Live Game Log/Feed */}
                  {roomState?.feed && roomState.feed.length > 0 && (
                    <div className="bg-white dark:bg-gray-900 rounded-xl p-3 border border-gray-200 dark:border-gray-800 transition-colors">
                      <div className="flex justify-between items-center mb-2">
                        <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-wider flex items-center gap-1">
                          <RefreshCw className="w-3 h-3" /> Live Feed
                        </h3>
                        <div className="flex h-1.5 w-1.5 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
                        </div>
                      </div>
                      <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                        {roomState.feed.map((msg, idx) => (
                          <div key={idx} className="text-[10px] font-bold text-gray-600 dark:text-gray-400 flex items-start gap-1.5 animate-in fade-in slide-in-from-left-1 duration-200">
                            <span className="text-gray-300 dark:text-gray-700">•</span>
                            <span className="leading-tight">{msg}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
            </div>
            
            {/* TAB 1.5: High-Stakes Jackpot Systems */}
            <div className={`flex-1 flex-col ${activeTab === 'jackpot' ? 'flex' : 'hidden'}`}>
                <JackpotArena
                  balance={balance}
                  setBalance={setBalance}
                  showNotification={showNotification}
                  setTransactions={setTransactions}
                  setGameHistory={setGameHistory}
                  isDarkMode={isDarkMode}
                  soundTicks={soundTicks}
                  isActive={activeTab === 'jackpot'}
                  onTheaterModeChange={setIsJackpotTheaterMode}
                  socket={socket}
                  userId={userId}
                  username={username}
                  photoUrl={photoUrl}
                  initialTier={initialTierJackpot}
                />
            </div>

            {/* TAB 2: P2P Wheel of Chance Page (Ultra-Clean UI/UX Spec) */}
            <div className={`flex-1 flex-col ${activeTab === 'chance' ? 'flex' : 'hidden'}`}>
                <WheelOfChance
                  balance={balance}
                  setBalance={setBalance}
                  setTransactions={setTransactions}
                  setGameHistory={setGameHistory}
                  isDarkMode={isDarkMode}
                  soundTicks={soundTicks}
                  isActive={activeTab === 'chance'}
                  socket={socket}
                  userId={userId}
                  username={username}
                  photoUrl={photoUrl}
                  showNotification={showNotification}
                  initialRoom={initialRoomChance}
                />
            </div>

            {/* TAB 3: Traditional Bingo Game */}
            <div className={`flex-1 min-h-0 overflow-hidden flex-col ${activeTab === 'bingo' ? 'flex' : 'hidden'}`}>
                <BingoGame
                  bingoRoomsMeta={bingoRoomsMeta}
                  selectedRoomId={selectedBingoRoomId}
                  onRoomSelect={setSelectedBingoRoomId}
                  socket={socket}
                  userId={userId}
                  username={username}
                  photoUrl={photoUrl}
                  balance={balance || 0}
                  showNotification={showNotification}
                  roomState={bingoRoomState}
                  displayTime={(bingoRoomState?.timeLeft || 0)}
                  soundEnabled={bingoSoundEnabled}
                  setSoundEnabled={setBingoSoundEnabled}
                  isActive={activeTab === 'bingo'}
                />
            </div>

            {/* TAB 4: Profile Page */}
            <div className={`flex-1 p-4 space-y-4 ${activeTab === 'profile' ? 'block' : 'hidden'}`}>
                {/* User Info Row */}
                <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/60 rounded-3xl p-5 shadow-sm transition-all duration-300 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="relative w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-950/50 p-1 flex items-center justify-center border border-gray-150 dark:border-gray-800/80 shrink-0">
                      {photoUrl ? (
                        <img src={photoUrl} alt="Avatar" className="w-full h-full object-cover rounded-full" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="text-2xl font-black text-blue-600 dark:text-blue-400">{username.charAt(0).toUpperCase()}</span>
                      )}
                      <div className="absolute bottom-0 right-0 bg-green-500 w-4.5 h-4.5 rounded-full border-[3px] border-white dark:border-gray-900 shadow-sm" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-lg font-black text-gray-900 dark:text-white tracking-tight truncate">
                        {firstName || lastName ? `${firstName} ${lastName}`.trim() : username}
                      </h2>
                      <p className="text-gray-400 dark:text-gray-500 text-xs font-semibold">@{username}</p>
                    </div>
                  </div>

                  {/* ID badge and copy button */}
                  <div className="bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800/50 rounded-2xl py-2 px-3 flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 font-mono tracking-wider">ID: {userId.slice(5, 15).toUpperCase()}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(userId);
                        setCopiedId(true);
                        setTimeout(() => setCopiedId(false), 2000);
                        showNotification("Copied User ID!", "success");
                      }}
                      className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-all text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 active:scale-95 cursor-pointer"
                      title="Copy Full ID"
                    >
                      {copiedId ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Unified Wallet Balance Widget */}
                <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl p-6 text-white shadow-xl shadow-blue-600/15 relative overflow-hidden">
                  {/* Subtle decorative circles */}
                  <div className="absolute -right-6 -bottom-6 w-32 h-32 bg-white/5 rounded-full blur-xl pointer-events-none" />
                  <div className="absolute -left-6 -top-6 w-24 h-24 bg-white/5 rounded-full blur-lg pointer-events-none" />

                  <div className="relative flex justify-between items-start gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 opacity-80">
                        <Wallet className="w-4 h-4" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Available Balance</span>
                      </div>
                      <div className="text-3xl font-black font-mono tracking-tight flex items-baseline gap-1.5">
                        {(balance || 0).toLocaleString()}
                        <span className="text-sm font-bold opacity-80">ETB</span>
                      </div>
                    </div>

                    <button
                      onClick={() => setIsWalletOpen(true)}
                      className="bg-white/15 hover:bg-white/25 active:scale-95 transition-all text-white text-xs font-black py-2.5 px-4 rounded-2xl border border-white/10 flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <span>Manage Wallet</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Affiliate & Earnings Dashboard */}
                <div className="bg-white dark:bg-gray-900 rounded-3xl p-5 border border-gray-100 dark:border-gray-800/60 shadow-sm transition-colors space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-50 dark:border-gray-800/40 pb-3">
                    <h3 className="text-xs font-black uppercase text-gray-400 dark:text-gray-500 tracking-widest flex items-center gap-2">
                      <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> Passive Income
                    </h3>
                    <span className="bg-green-500/10 text-green-500 text-[9px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider border border-green-500/10">1% Comm.</span>
                  </div>
                  
                  {affiliateStats?.isFlagged && (
                      <div className="bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 p-4 rounded-2xl text-xs font-bold flex items-center gap-3 border border-red-100 dark:border-red-900/30">
                          <AlertCircle className="w-5 h-5 shrink-0" />
                          <span>Account flagged for review. Payouts disabled.</span>
                      </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-3.5">
                      <div className="bg-gray-50 dark:bg-gray-800/30 p-4 rounded-2xl border border-gray-100 dark:border-gray-800/50">
                          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Total Referrals</div>
                          <div className="text-xl font-black text-gray-900 dark:text-white mt-1">
                            {affiliateStats?.totalReferrals || 0}
                          </div>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800/30 p-4 rounded-2xl border border-gray-100 dark:border-gray-800/50">
                          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Total Earned</div>
                          <div className="text-xl font-black text-green-600 dark:text-green-400 mt-1 flex items-baseline gap-0.5">
                            {(affiliateStats?.totalEarned || 0).toLocaleString()} <span className="text-[10px] font-bold text-gray-400">ETB</span>
                          </div>
                      </div>
                  </div>

                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/10 dark:to-indigo-900/10 p-4 rounded-2xl flex items-center justify-between border border-blue-100/40 dark:border-blue-900/20">
                    <div>
                      <div className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Available to Payout</div>
                      <div className="text-2xl font-black text-blue-800 dark:text-blue-200 mt-0.5 flex items-baseline gap-1">
                         {(affiliateStats?.availableBalance || 0).toLocaleString()} <span className="text-xs font-bold text-blue-400 dark:text-blue-500">ETB</span>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                          if (!affiliateStats?.availableBalance || affiliateStats.availableBalance < 1000) {
                              showNotification("Minimum withdrawal is 1,000 ETB.", "error");
                              return;
                          }
                          const reqAmt = prompt(`Enter amount to withdraw (Available: ${affiliateStats.availableBalance}):`);
                          if (reqAmt) {
                              const amt = parseInt(reqAmt, 10);
                              if (isNaN(amt) || amt < 1000 || amt > affiliateStats.availableBalance) {
                                  showNotification("Invalid amount. Minimum 1,000 ETB.", "error");
                              } else {
                                  socket?.emit('requestAffiliatePayout', userId, amt);
                              }
                          }
                      }}
                      disabled={affiliateStats?.isFlagged || (affiliateStats?.availableBalance || 0) < 1000}
                      className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-black py-2.5 px-4 rounded-xl transition-all active:scale-95 shadow-md shadow-blue-600/10 flex justify-center items-center gap-1 cursor-pointer"
                    >
                      Request Payout
                    </button>
                  </div>
                    
                  <p className="text-[10px] text-gray-400 leading-relaxed pt-3 border-t border-gray-100 dark:border-gray-800/40 text-center">
                    Share your unique link below to earn lifetime commissions.
                  </p>
                </div>

                {/* Weekly Referral Leaderboard */}
                <Leaderboard
                  stats={leaderboardStats}
                  isLoading={isLeaderboardLoading}
                  onRefresh={fetchLeaderboard}
                  userId={userId}
                  botUsername={botUsername}
                  showNotification={showNotification}
                />

                {/* Profile Controls (Settings & Switches) */}
                <div className="bg-white dark:bg-gray-900 rounded-3xl p-5 border border-gray-100 dark:border-gray-800/60 shadow-sm transition-colors space-y-4">
                  <h3 className="text-xs font-black uppercase text-gray-400 dark:text-gray-500 tracking-widest flex items-center gap-2 border-b border-gray-50 dark:border-gray-800/40 pb-3">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    App Settings
                  </h3>
                  
                  {/* Theme Switcher Row */}
                  <div className="flex justify-between items-center py-2 border-b border-gray-50 dark:border-gray-800/40">
                    <span className="text-sm font-bold text-gray-800 dark:text-gray-200">Visual Appearance</span>
                    <button 
                      onClick={() => setIsDarkMode(!isDarkMode)}
                      className="px-3 py-1.5 rounded-full bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
                    >
                      {isDarkMode ? (
                        <span className="flex items-center gap-2 text-xs font-black">
                          <Sun className="w-4 h-4 text-yellow-500" /> Light
                        </span>
                      ) : (
                        <span className="flex items-center gap-2 text-xs font-black">
                          <Moon className="w-4 h-4 text-blue-500" /> Dark
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Sound Ticks switch */}
                  <div className="flex justify-between items-center py-2 border-b border-gray-50 dark:border-gray-800/40">
                    <span className="text-sm font-bold text-gray-800 dark:text-gray-200">Wheel Ticks Audio</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={soundTicks} onChange={e => setSoundTicks(e.target.checked)} className="sr-only peer" />
                      <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  {/* Win/Loss alert switch */}
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm font-bold text-gray-800 dark:text-gray-200">Game Alerts Sound</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={soundAlerts} onChange={e => setSoundAlerts(e.target.checked)} className="sr-only peer" />
                      <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                </div>
            </div>

        </main>

        {/* Modern Bottom Tabbed Menu Bar */}
        {!isJackpotTheaterMode && (
          <nav id="bottom-navigation-bar" className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-t border-gray-200 dark:border-gray-800 flex justify-around items-center py-1.5 px-1 z-40 transition-colors duration-300 shadow-lg shrink-0 w-full max-w-md mx-auto">
            <button
              onClick={() => { unlockBingoAudio(); resumeAudio(); setActiveTab('even_odd'); }}
              className={`flex flex-col items-center gap-0.5 flex-1 py-0.5 transition-all cursor-pointer ${
                activeTab === 'even_odd' 
                  ? 'text-blue-600 dark:text-blue-400 scale-105 font-black' 
                  : 'text-gray-400 hover:text-gray-500'
              }`}
            >
              <Binary className="w-5 h-5" />
              <span className="text-[10px] tracking-tight font-black uppercase">ሞላ/ጎደለ</span>
            </button>

            <button
              onClick={() => { unlockBingoAudio(); resumeAudio(); setActiveTab('jackpot'); }}
              className={`flex flex-col items-center gap-0.5 flex-1 py-0.5 transition-all cursor-pointer ${
                activeTab === 'jackpot' 
                  ? 'text-blue-600 dark:text-blue-400 scale-105 font-black' 
                  : 'text-gray-400 hover:text-gray-500'
              }`}
            >
              <Trophy className="w-5 h-5" />
              <span className="text-[10px] tracking-tight font-black uppercase">ዕድል</span>
            </button>

            <button
              onClick={() => { unlockBingoAudio(); resumeAudio(); setActiveTab('chance'); }}
              className={`flex flex-col items-center gap-0.5 flex-1 py-0.5 transition-all cursor-pointer ${
                activeTab === 'chance' 
                  ? 'text-blue-600 dark:text-blue-400 scale-105 font-black' 
                  : 'text-gray-400 hover:text-gray-500'
              }`}
            >
              <Dices className="w-5 h-5" />
              <span className="text-[10px] tracking-tight font-black uppercase">ፈጣን</span>
            </button>

            <button
              onClick={() => { unlockBingoAudio(); resumeAudio(); setActiveTab('bingo'); }}
              className={`flex flex-col items-center gap-0.5 flex-1 py-0.5 transition-all cursor-pointer ${
                activeTab === 'bingo' 
                  ? 'text-blue-600 dark:text-blue-400 scale-105 font-black' 
                  : 'text-gray-400 hover:text-gray-500'
              }`}
            >
              <Grid3X3 className="w-5 h-5" />
              <span className="text-[10px] tracking-tight font-black uppercase">ቢንጎ</span>
            </button>
          </nav>
        )}

      </div>



      {/* Wallet Portal Drawer */}
      <AnimatePresence>
        {isWalletOpen && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsWalletOpen(false)}
              className="absolute inset-0 z-[80] bg-black/60 backdrop-blur-xs transition-opacity"
            />

            {/* Bottom Sheet Drawer */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="absolute bottom-0 left-0 right-0 h-[80vh] bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 rounded-t-[2.5rem] shadow-2xl z-[90] flex flex-col overflow-hidden transition-colors duration-300"
            >
              {/* Native Grab Indicator */}
              <div className="mx-auto my-3 w-12 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full cursor-pointer hover:bg-gray-400 dark:hover:bg-gray-600 transition-colors" onClick={() => setIsWalletOpen(false)} />

              {/* Drawer Header */}
              <div className="px-5 pb-3 pt-1 border-b border-gray-100 dark:border-gray-800/80 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Coins className="w-5 h-5 text-yellow-500 animate-pulse" />
                  <div>
                    <h2 className="text-base font-black text-gray-900 dark:text-white leading-tight font-sans">Interactive Wallet Ledger</h2>
                    <p className="text-xs font-bold text-gray-500 dark:text-gray-400">
                      Balance: <span className="font-mono text-amber-500 font-extrabold">{balance === null ? '...' : (balance || 0).toLocaleString()} ETB</span>
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsWalletOpen(false)} 
                  className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-12">
                {/* Deposit and Withdrawal Bot Redirect Panels */}
                <div className="bg-gray-50 dark:bg-gray-950 rounded-2xl p-4 border border-gray-200 dark:border-gray-800 transition-colors shadow-xs space-y-4 text-center">
                  <div className="p-2">
                    <h3 className="text-sm font-black text-gray-900 dark:text-white mb-1">Deposit & Withdrawal</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                      All financial transactions are handled securely through our official Telegram Bot. Your balance will update instantly upon approval.
                    </p>
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => handleTriggerFlow('deposit')}
                        className="flex-1 bg-green-600 hover:bg-green-500 text-white font-black px-4 py-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                      >
                        <ArrowDownLeft className="w-4 h-4" /> Deposit via Bot
                      </button>
                      <button
                        onClick={() => handleTriggerFlow('withdraw')}
                        className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-black px-4 py-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                      >
                        <ArrowUpRight className="w-4 h-4" /> Withdraw via Bot
                      </button>
                    </div>
                  </div>
                </div>

                {/* Ledger Tabs Segmented Control */}
                <div className="bg-gray-100 dark:bg-gray-800 p-1 rounded-xl flex gap-1 mb-4 shadow-inner">
                  <button
                    onClick={() => setLedgerTab('play')}
                    className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${
                      ledgerTab === 'play' 
                        ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white' 
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer'
                    }`}
                  >
                    Play History
                  </button>
                  <button
                    onClick={() => setLedgerTab('transactions')}
                    className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${
                      ledgerTab === 'transactions' 
                        ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white' 
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer'
                    }`}
                  >
                    Transactions
                  </button>
                </div>

                {ledgerTab === 'transactions' ? (
                  <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-200 dark:border-gray-800 transition-colors shadow-xs">
                    <h3 className="text-xs font-black uppercase text-gray-400 tracking-wider mb-2 flex items-center gap-1.5 flex">
                      <History className="w-4 h-4 mr-1" /> Transaction History
                    </h3>
                    <div className="space-y-2 divide-y divide-gray-100 dark:divide-gray-800/40">
                      {transactions.map((tx, index) => (
                        <div key={`${tx.id}-${index}`} className="flex justify-between items-center pt-2.5 first:pt-0">
                          <div>
                            <div className="text-xs font-bold text-gray-800 dark:text-gray-200">{tx.desc}</div>
                            <div className="text-[10px] text-gray-400 font-medium mt-0.5">{tx.date}</div>
                          </div>
                          <span className={`text-xs font-black font-mono ${tx.positive ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                            {tx.positive ? '+' : ''}{tx.amount.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (() => {
                  interface GroupedGameLog {
                    id: string;
                    type: string;
                    date: string;
                    status: string;
                    totalChange: number;
                    bet: number;
                    choices: string[];
                    winningNums: string;
                    outcomes: Array<{
                      result: string;
                      change: number;
                      numbers: string;
                    }>;
                  }

                  const getGameBadgeName = (type: string): string => {
                    const t = type.toLowerCase();
                    if (t === 'even/odd' || t.includes('even/odd')) return 'ሞላ/ጎደለ';
                    if (t === 'chance 1-10' || t.includes('1-10')) return 'ፈጣን 10 ሰው';
                    if (t === 'chance 1-20' || t.includes('1-20')) return 'ፈጣን 20 ሰው';
                    if (t === 'jackpot mini' || (t.includes('jackpot') && t.includes('mini'))) return 'ዕድል (1-50)';
                    if (t === 'jackpot grand' || (t.includes('jackpot') && t.includes('grand'))) return 'ዕድል (1-100)';
                    return type;
                  };

                  const getBadgeStyles = (type: string): string => {
                    const t = type.toLowerCase();
                    if (t.includes('even/odd')) {
                      return 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200/40 dark:border-emerald-900/20';
                    }
                    if (t.includes('1-10')) {
                      return 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 border-indigo-200/40 dark:border-indigo-900/20';
                    }
                    if (t.includes('1-20')) {
                      return 'bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 border-purple-200/40 dark:border-purple-900/20';
                    }
                    if (t.includes('mini')) {
                      return 'bg-cyan-50 dark:bg-cyan-950/30 text-cyan-600 dark:text-cyan-400 border-cyan-200/40 dark:border-cyan-900/20';
                    }
                    if (t.includes('grand')) {
                      return 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200/40 dark:border-amber-900/20';
                    }
                    return 'bg-gray-50 dark:bg-gray-950/30 text-gray-600 dark:text-gray-400 border-gray-200/40 dark:border-gray-900/20';
                  };

                  const groups: { [key: string]: GroupedGameLog } = {};
                  const sortedLogs = [...gameHistory].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                  sortedLogs.forEach(log => {
                    const key = `${log.id}_${log.type}`;
                    if (!groups[key]) {
                      groups[key] = {
                        id: log.id,
                        type: log.type,
                        date: log.date,
                        status: log.status || 'Completed',
                        totalChange: 0,
                        bet: 0,
                        choices: [],
                        winningNums: log.winningNums || '-',
                        outcomes: []
                      };
                    }
                    
                    groups[key].totalChange += log.change;
                    if (log.bet && log.bet > 0) {
                      groups[key].bet += log.bet;
                    }
                    if (log.numbers && log.numbers !== '-') {
                      const incomingChoices = log.numbers.split(',').map(n => n.trim()).filter(Boolean);
                      incomingChoices.forEach(choice => {
                        if (!groups[key].choices.includes(choice)) {
                          groups[key].choices.push(choice);
                        }
                      });
                    }
                    if (log.winningNums && log.winningNums !== '-') {
                      if (groups[key].winningNums === '-') {
                        groups[key].winningNums = log.winningNums;
                      } else {
                        const existing = groups[key].winningNums.split(',').map(n => n.trim()).filter(Boolean);
                        const incoming = log.winningNums.split(',').map(n => n.trim()).filter(Boolean);
                        const combined = Array.from(new Set([...existing, ...incoming]));
                        groups[key].winningNums = combined.join(', ');
                      }
                    }
                    
                    const exists = groups[key].outcomes.some(o => o.result === log.result && o.change === log.change && o.numbers === log.numbers);
                    if (!exists) {
                      groups[key].outcomes.push({
                        result: log.result,
                        change: log.change,
                        numbers: log.numbers
                      });
                    }
                  });

                  const groupedList = Object.values(groups).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                  const filteredGroups = groupedList.filter(group => {
                    if (historyFilter === 'all') return true;
                    const typeLower = group.type.toLowerCase();
                    if (historyFilter === 'even_odd') {
                      return typeLower === 'even/odd' || typeLower.includes('even/odd');
                    }
                    if (historyFilter === 'wheel_1_10') {
                      return typeLower === 'chance 1-10' || typeLower.includes('1-10');
                    }
                    if (historyFilter === 'wheel_1_20') {
                      return typeLower === 'chance 1-20' || typeLower.includes('1-20');
                    }
                    if (historyFilter === 'jackpot_mini') {
                      return typeLower === 'jackpot mini' || (typeLower.includes('jackpot') && typeLower.includes('mini'));
                    }
                    if (historyFilter === 'jackpot_grand') {
                      return typeLower === 'jackpot grand' || (typeLower.includes('jackpot') && typeLower.includes('grand'));
                    }
                    return true;
                  });

                  return (
                    <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-200 dark:border-gray-800 transition-colors shadow-xs">
                      <div className="flex justify-between items-center mb-4 flex-wrap gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
                        <h3 className="text-xs font-black uppercase text-gray-400 tracking-wider flex items-center gap-1.5">
                          <TrendingUp className="w-4 h-4 mr-1 text-blue-500" /> Play History
                        </h3>
                        
                        <div className="relative">
                          <select
                            value={historyFilter}
                            onChange={(e) => setHistoryFilter(e.target.value)}
                            className="text-[11px] font-black bg-gray-50 dark:bg-gray-950 text-gray-700 dark:text-gray-300 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 outline-none cursor-pointer focus:ring-1 focus:ring-blue-500 transition-all"
                          >
                            <option value="all">ሁሉም ጨዋታዎች (All Games)</option>
                            <option value="even_odd">🟢 ሞላ/ጎደለ (Even/Odd)</option>
                            <option value="wheel_1_10">🎡 ፈጣን 10 ሰው</option>
                            <option value="wheel_1_20">🎡 ፈጣን 20 ሰው</option>
                            <option value="jackpot_mini">🏆 ዕድል (1-50)</option>
                            <option value="jackpot_grand">🏆 ዕድል (1-100)</option>
                          </select>
                        </div>
                      </div>

                      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                        {filteredGroups.length === 0 ? (
                           <div className="text-center py-8 text-xs text-gray-400 font-medium">
                             No play logs found for this filter.
                           </div>
                        ) : (
                          filteredGroups.map((log, index) => {
                            const isWin = log.outcomes.some(o => o.result.toLowerCase().includes('win'));

                            const gameIcon = () => {
                              const t = log.type.toLowerCase();
                              if (t.includes('even/odd')) return <Coins className="w-5 h-5 text-emerald-500" />;
                              if (t.includes('chance')) return <RefreshCw className="w-5 h-5 text-indigo-500 animate-spin-slow" />;
                              return <Trophy className="w-5 h-5 text-amber-500" />;
                            };

                            return (
                              <div 
                                key={`${log.id}-${index}`} 
                                className={`group relative overflow-hidden bg-gray-50/40 dark:bg-zinc-950/20 border border-gray-150/60 dark:border-zinc-800/40 rounded-xl p-3 md:p-4 transition-all hover:border-blue-500/20 hover:shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-4 border-l-[5px] ${
                                  isWin 
                                    ? 'border-l-emerald-500 dark:border-l-emerald-500/80' 
                                    : 'border-l-zinc-300 dark:border-l-zinc-700/80'
                                }`}
                              >
                                {/* Left section: Game badge, round, and time */}
                                <div className="flex items-center gap-3 shrink-0">
                                  <div className={`p-2 rounded-lg border shrink-0 shadow-3xs ${
                                    log.type.toLowerCase().includes('even/odd')
                                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                                      : log.type.toLowerCase().includes('chance')
                                      ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-500'
                                      : 'bg-amber-500/10 border-amber-500/20 text-amber-500'
                                  }`}>
                                    {gameIcon()}
                                  </div>
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${getBadgeStyles(log.type)}`}>
                                        {getGameBadgeName(log.type)}
                                      </span>
                                      <span className="text-[9px] text-gray-500 dark:text-zinc-400 font-mono font-black bg-white dark:bg-zinc-900 border border-gray-150 dark:border-zinc-800 px-1.5 py-0.5 rounded shadow-2xs">
                                        {log.id}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-gray-400 dark:text-zinc-500 font-bold flex items-center gap-1">
                                      <Clock className="w-3.5 h-3.5 text-gray-300 dark:text-zinc-600" />
                                      {log.date}
                                    </div>
                                  </div>
                                </div>

                                {/* Responsive Two-Column Grid for Choice & Winning Numbers on Mobile, Side-By-Side Flex on Desktop */}
                                <div className="grid grid-cols-2 md:flex md:flex-row flex-1 gap-3 md:gap-6 justify-between items-start md:items-center">
                                  {/* Middle section: Player's Choice */}
                                  <div className="flex flex-col gap-1 md:border-l md:border-gray-150 md:dark:border-zinc-800/60 md:pl-5">
                                    <span className="text-[8.5px] font-black tracking-wider text-gray-400 dark:text-zinc-500 uppercase flex items-center gap-1">
                                      <Dices className="w-3.5 h-3.5 text-blue-500/80" /> የአንተ ምርጫ • YOUR CHOICE
                                    </span>
                                    <div className="flex flex-wrap gap-1">
                                      {log.choices.length > 0 ? (
                                        log.choices.flatMap(c => c.split(',').map(s => s.trim())).map((choice, cIdx) => {
                                          const cleanChoice = choice.trim();
                                          const cleanWinNums = (log.winningNums || '').split(',').map(s => s.trim());
                                          const isMatch = cleanWinNums.includes(cleanChoice);
                                          return (
                                            <span 
                                              key={cIdx} 
                                              className={`inline-flex items-center text-[10px] font-mono font-black px-2 py-0.5 rounded-full border transition-all ${
                                                isMatch 
                                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 dark:border-emerald-500/20 shadow-xs animate-pulse' 
                                                : 'bg-blue-50/70 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border-blue-100/30 dark:border-blue-900/10'
                                              }`}
                                            >
                                              {isMatch && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1" />}
                                              {choice}
                                            </span>
                                          );
                                        })
                                      ) : (
                                        <span className="text-xs text-gray-400 dark:text-zinc-500 font-mono">-</span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Right section: Winning Numbers */}
                                  <div className="flex flex-col gap-1 md:items-end md:border-l md:border-gray-150 md:dark:border-zinc-800/60 md:pl-5 md:text-right">
                                    <span className="text-[8.5px] font-black tracking-wider text-gray-400 dark:text-zinc-500 uppercase flex items-center gap-1 md:justify-end">
                                      <Trophy className="w-3.5 h-3.5 text-amber-500/80" /> አሸናፊ ቁጥር • WINNING NUMBERS
                                    </span>
                                    <div className="flex items-center gap-2 flex-wrap md:justify-end">
                                      <div className="flex flex-wrap gap-1 md:justify-end">
                                        {(log.winningNums || '-').split(',').map((wn, wnIdx) => {
                                          const cleanWn = wn.trim();
                                          if (!cleanWn) return null;
                                          const userHadThis = log.choices.flatMap(c => c.split(',').map(s => s.trim())).includes(cleanWn);
                                          
                                          // Format with 1st, 2nd, 3rd prefix labels for multiple draws
                                          const typeLower = log.type.toLowerCase();
                                          const showLabel = typeLower.includes('chance') || typeLower.includes('jackpot');
                                          const label = showLabel 
                                            ? (wnIdx === 0 ? '1st - ' : wnIdx === 1 ? '2nd - ' : wnIdx === 2 ? '3rd - ' : `${wnIdx + 1}th - `)
                                            : '';

                                          return (
                                            <span 
                                              key={wnIdx} 
                                              className={`inline-flex items-center font-mono font-black text-[10px] px-2 py-0.5 rounded-md border ${
                                                userHadThis 
                                                  ? 'bg-emerald-500/10 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800/40 shadow-xs' 
                                                  : 'bg-zinc-100 dark:bg-zinc-900/60 text-gray-700 dark:text-zinc-400 border-gray-200/80 dark:border-zinc-800/50'
                                              }`}
                                            >
                                              {label}<span className={userHadThis ? 'text-emerald-500 font-black' : ''}>{cleanWn}</span>
                                            </span>
                                          );
                                        })}
                                      </div>
                                      
                                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border shrink-0 flex items-center gap-1 ${
                                        isWin 
                                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' 
                                          : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
                                      }`}>
                                        {isWin ? '🏆 WIN' : '❌ MISS'}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Right-most column: Beautiful, Precise Payout Outcomes */}
                                  <div className="flex flex-col md:items-end justify-center shrink-0 border-t border-gray-100 dark:border-zinc-800/40 pt-2.5 md:pt-0 md:border-t-0 md:border-l md:border-gray-150 md:dark:border-zinc-800/60 md:pl-5 min-w-[95px]">
                                    <span className="text-[8.5px] font-black tracking-wider text-gray-400 dark:text-zinc-500 uppercase">
                                      የክፍያ ሁኔታ • PAYOUT
                                    </span>
                                    <div className="flex md:flex-col items-center md:items-end gap-2 md:gap-0.5 mt-0.5">
                                      <span className={`text-xs font-mono font-black ${
                                        isWin 
                                          ? 'text-emerald-500 dark:text-emerald-400' 
                                          : 'text-zinc-500 dark:text-zinc-400'
                                      }`}>
                                        {isWin ? `+${log.totalChange.toLocaleString()}` : '0'} ETB
                                      </span>
                                      <span className="text-[9px] font-mono text-gray-400 dark:text-zinc-500 font-bold">
                                        Bet: {log.bet?.toLocaleString() || '0'} ETB
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Active Players Portal - Simplified VIP Lobby Bottom Sheet Drawer */}
      <AnimatePresence>
        {isPlayersDrawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPlayersDrawerOpen(false)}
              className="absolute inset-0 z-[80] bg-black/60 backdrop-blur-xs transition-opacity"
            />

            {/* Bottom Sheet Drawer */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="absolute bottom-0 left-0 right-0 h-[75vh] bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 rounded-t-[2.5rem] shadow-2xl z-[90] flex flex-col overflow-hidden transition-colors duration-300"
            >
              {/* Native Grab Indicator */}
              <div className="mx-auto my-3 w-12 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full cursor-pointer hover:bg-gray-400 dark:hover:bg-gray-600 transition-colors" onClick={() => setIsPlayersDrawerOpen(false)} />

              {/* Drawer Header */}
              <div className="px-5 pb-3 pt-1 border-b border-gray-100 dark:border-gray-800/80">
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-yellow-500 animate-pulse" />
                    <div>
                      <h2 className="text-base font-black text-gray-900 dark:text-white leading-tight">VIP Lobby Portal</h2>
                      <p className="text-[9px] font-bold uppercase tracking-wider text-blue-500">First 100 Early placements</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsPlayersDrawerOpen(false)} 
                    className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-all cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Search Bar */}
                <div className="relative mt-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search player username..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-gray-100 dark:bg-gray-950 pl-9 pr-4 py-2 rounded-xl text-xs border-none focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-600 transition-all"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 font-bold text-xs"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Player List */}
              <div className="flex-1 overflow-y-auto px-5 py-3 divide-y divide-gray-100 dark:divide-gray-800/40">
                {vipPlayersList.filter(p => p.username.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 ? (
                  <div className="text-center py-10 text-gray-400 dark:text-gray-600 text-sm">
                    No early-joining players found matching "{searchQuery}"
                  </div>
                ) : (
                  vipPlayersList
                    .filter(p => p.username.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((player, index) => {
                      const isCurrentUser = player.id === userId;
                      return (
                        <div key={`${player.id}-${index}`} className={`flex items-center justify-between py-2.5 transition-colors ${isCurrentUser ? 'bg-blue-50/40 dark:bg-blue-950/10 px-2 rounded-xl border border-blue-100/30 dark:border-blue-900/10' : ''}`}>
                          <div className="flex items-center gap-2.5">
                            {/* Rank Badge */}
                            <span className="font-mono text-xs font-bold text-gray-400 dark:text-gray-500 w-5 shrink-0">
                              #{index + 1}
                            </span>

                            {/* Avatar with image or initials */}
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white relative shrink-0 overflow-hidden ${
                              player.side === 'even' 
                                ? 'bg-gradient-to-tr from-red-600 to-red-400' 
                                : player.side === 'odd'
                                ? 'bg-gradient-to-tr from-blue-600 to-blue-400'
                                : 'bg-gradient-to-tr from-gray-500 to-gray-400'
                            }`}>
                              {player.photoUrl ? (
                                <img src={player.photoUrl} alt="Avatar" className="w-full h-full object-cover rounded-full" referrerPolicy="no-referrer" />
                              ) : (
                                player.username.replace('@', '').charAt(0).toUpperCase()
                              )}
                              {player.isReal && (
                                <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-green-500 border-2 border-white dark:border-gray-900 z-10" />
                              )}
                            </div>

                            {/* Player Name & Tag */}
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs font-bold ${isCurrentUser ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'}`}>
                                  {player.username}
                                </span>
                                {isCurrentUser && (
                                  <span className="text-[8px] bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 font-black px-1.5 py-0.5 rounded-md">
                                    YOU
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[9px] text-gray-400 font-semibold uppercase">{player.badge}</span>
                                <span className="text-[9px] text-gray-300 dark:text-gray-700">•</span>
                                <span className="text-[9px] text-gray-400 font-mono">{player.joinTime}</span>
                              </div>
                            </div>
                          </div>

                          {/* Player Bet Details (Omit their exact side choice Even/Odd as requested!) */}
                          {player.amount > 0 && (
                            <div className="text-right">
                              <div className="text-xs font-black text-yellow-600 dark:text-yellow-400 flex items-center justify-end gap-0.5">
                                <Coins className="w-3.5 h-3.5 shrink-0" />
                                {player.amount.toLocaleString()}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                )}
              </div>
              
              {/* Footer status bar */}
              <div className="bg-gray-50 dark:bg-gray-950 p-3 text-center border-t border-gray-100 dark:border-gray-800/60 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                🔒 Sealed Rounds VIP Registry
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Even/Odd Info Modal */}
      <AnimatePresence>
        {isEvenOddInfoOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100] flex items-center justify-center p-4 max-w-md mx-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 shadow-2xl relative w-full max-h-[85vh] overflow-y-auto"
            >
              <button
                onClick={() => setIsEvenOddInfoOpen(false)}
                className="absolute top-4 right-4 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2.5 mb-4 text-blue-600 dark:text-blue-400">
                <Info className="w-6 h-6 fill-blue-500/10" />
                <h2 className="text-lg font-black tracking-tight">ሞላ/ጎደለ (Even/Odd Wheel)</h2>
              </div>

              <div className="text-sm space-y-4 text-gray-700 dark:text-gray-300 leading-relaxed font-medium">
                <p>ይህ በደቂቃ ልዩነት የሚሽከረከር እና ቀላል መሠረታዊ ህግ ያለው የዕድል መንኰራኩር ጨዋታ ነው።</p>
                <p><strong>እንዴት እንደሚጫወት፦</strong> ተጫዋቾች በመንኰራኩሩ ላይ የሚመጣው አሸናፊ ቁጥር ሞላ (Even) ወይም ጎደል (Odd) ይሆናል በሚለው ላይ የራሳቸውን ውርርድ ያስቀምጣሉ።</p>

                <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
                  <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-1">የጊዜ ቆጣሪ (Betting Timer):</h3>
                  <p>ለእያንዳንዱ ዙር ውርርድ ለማስገባት የተወሰነ ሰከንድ ይሰጥዎታል።</p>
                  <p className="mt-1">ሰዓቱ ወደ ማብቂያው ሲቃረብ (የመጨረሻዎቹ 5 ሰከንዶች ሲቀሩ) ውርርድ በጊዜያዊነት ይዘጋል (Soft Close)። ይህ ተጫዋቾች ሳይደናገጡ የመጨረሻውን ሽክርክሪት እንዲጠባበቁ ይረዳል።</p>
                </div>

                <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
                  <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-1.5">ዋና ዋና ባህሪያት፦</h3>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><strong>የመንኰራኩሩ ቁጥሮች፦</strong> መንኰራኩሩ ከ 1 እስከ 6 የተከፈለ ሲሆን እኩል ዕድል ያላቸውን ቁጥሮች ይዟል።</li>
                    <li><strong>ሞላ (Even)፦</strong> መንኰራኩሩ ተሽከርክሮ 2፣ 4፣ ወይም 6 ላይ ሲያርፍ ያሸንፋሉ።</li>
                    <li><strong>ጎደል (Odd)፦</strong> መንኰራኩሩ ተሽከርክሮ 1፣ 3፣ ወይም 5 ላይ ሲያርፍ ያሸንፋሉ።</li>
                    <li><strong>የውርርድ ገደብ፦</strong> ዝቅተኛው የመጫወቻ መጠን 200 ETB ነው።</li>
                  </ul>
                </div>

                <div className="border-t border-gray-100 dark:border-gray-800 pt-3 bg-blue-50/50 dark:bg-blue-950/20 p-3 rounded-2xl border border-blue-100/50 dark:border-blue-900/30">
                  <h3 className="font-bold text-blue-700 dark:text-blue-300 mb-0.5">ማሸነፍ (Winning):</h3>
                  <p className="text-xs text-blue-800 dark:text-blue-200">እሽከርክሪቱ ቆሞ ጠቋሚው ያረፈበት ቁጥር እርስዎ የመረጡት ወገን (ሞላ ወይም ጎደለ) ከሆነ ወዲያውኑ አሸናፊ ይሆናሉ!</p>
                </div>
              </div>

              <button
                onClick={() => setIsEvenOddInfoOpen(false)}
                className="w-full mt-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all active:scale-95 cursor-pointer shadow-md shadow-blue-500/25"
              >
                እሺ ተረዳሁ
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
