import { Server, Socket } from "socket.io";
import { supabase } from "./supabase.js";
import { txManager } from "./transactionManager.js";
import { getGameConfig } from "./gameSettings.js";

export interface KenoBet {
  id: string; // unique ticket/bet ID
  userId: string;
  username: string;
  numbers: number[];
  bet: number;
  timestamp: number;
  matchedCount?: number;
  payoutAmount?: number;
  won?: boolean;
}

export interface KenoState {
  roundId: string;
  status: 'betting' | 'draw' | 'result';
  timeLeft: number;
  history: any[];
  drawNumbers: number[];
  bets: KenoBet[];
}

const BETTING_TIME = 60;
const DRAW_TIME = 35;
const RESULT_TIME = 10; // Comfortable display time for results

const PAYOUTS: Record<number, number[]> = {
  1: [0, 3.5],
  2: [0, 1, 10],
  3: [0, 0, 2, 50],
  4: [0, 0, 1.5, 10, 80],
  5: [0, 0, 1, 3, 30, 150],
  6: [0, 0, 0, 2, 15, 60, 500],
  7: [1, 0, 0, 2, 4, 20, 80, 1000],
  8: [1, 0, 0, 0, 5, 15, 50, 200, 2000],
  9: [2, 0, 0, 0, 2, 10, 25, 125, 1000, 5000],
  10: [2, 0, 0, 0, 0, 5, 30, 100, 300, 2000, 10000]
};

class KenoEngine {
  private io: Server;
  public state: KenoState;
  private timer: NodeJS.Timeout | null = null;

  constructor(io: Server) {
    this.io = io;
    this.state = {
      roundId: '870909999',
      status: 'betting',
      timeLeft: BETTING_TIME,
      history: [],
      drawNumbers: [],
      bets: []
    };
    this.startLoop();
    this.loadHistoryFromDB().catch(e => console.error("Error loading Keno history:", e));
  }

  private async loadHistoryFromDB() {
    try {
      if (supabase) {
        // Ensure system_keno user exists in the users table to prevent FK constraint error
        await supabase.from("users").upsert({
          id: "system_keno",
          username: "system_keno",
          balance: 0
        });

        const { data, error } = await supabase
          .from("game_logs")
          .select("*")
          .eq("user_id", "system_keno")
          .order("created_at", { ascending: false })
          .limit(100);

        if (data && data.length > 0) {
          const loadedHistory = data.map(log => {
            let parsedRoundId = '';
            let balls: number[] = [];
            const parts = log.game_type.split(' | ');
            for (const part of parts) {
              const trimmed = part.trim();
              if (trimmed.startsWith('R#')) {
                parsedRoundId = trimmed.substring(2);
              } else if (trimmed.startsWith('Draw:')) {
                balls = trimmed.substring(5).split(',').map(Number);
              }
            }
            return {
              id: parsedRoundId,
              time: new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              balls
            };
          }).filter(h => h.id && h.balls.length > 0);

          const existingIds = new Set(this.state.history.map(h => h.id));
          const toAdd = loadedHistory.filter(h => !existingIds.has(h.id));
          this.state.history = [...this.state.history, ...toAdd].slice(0, 100);
          this.broadcast();
        }
      }
    } catch (e) {
      console.error("Error loading Keno history from DB:", e);
    }
  }

  private startLoop() {
    this.state.status = 'betting';
    this.state.timeLeft = BETTING_TIME;
    this.state.drawNumbers = [];
    this.state.bets = [];
    this.state.roundId = (Math.floor(Math.random() * 900000000) + 100000000).toString();
    this.broadcast();

    // Set up ticking
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.tick();
    }, 1000);
  }

  private tick() {
    try {
      this.state.timeLeft--;
      if (this.state.timeLeft < 0) this.state.timeLeft = 0;
      
      this.broadcast();

      if (this.state.timeLeft <= 0) {
        this.transition();
      }
    } catch (e) {
      console.error("Error in Keno tick:", e);
      try {
        this.transition();
      } catch (err) {
        this.startLoop();
      }
    }
  }

  private async transition() {
    try {
      if (this.timer) clearInterval(this.timer);

      if (this.state.status === 'betting') {
        this.state.status = 'draw';
        this.state.timeLeft = DRAW_TIME;
        // Generate draw numbers
        const nums = Array.from({ length: 80 }, (_, i) => i + 1);
        for (let i = nums.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [nums[i], nums[j]] = [nums[j], nums[i]];
        }
        this.state.drawNumbers = nums.slice(0, 20);
        
        this.broadcast();
        this.timer = setInterval(() => this.tick(), 1000);
      } else if (this.state.status === 'draw') {
        // Transition to result phase & resolve all bets
        this.state.status = 'result';
        this.state.timeLeft = RESULT_TIME;
        
        await this.resolveBets();
        
        this.broadcast();
        this.timer = setInterval(() => this.tick(), 1000);
      } else {
        this.startLoop();
      }
    } catch (e) {
      console.error("Error in Keno transition:", e);
      this.startLoop();
    }
  }

  private async resolveBets() {
    try {
      const drawNums = this.state.drawNumbers;
      const roundId = this.state.roundId;

      for (const bet of this.state.bets) {
        const choiceLength = bet.numbers.length;
        const matched = bet.numbers.filter(n => drawNums.includes(n));
        const count = matched.length;
        
        const multList = PAYOUTS[choiceLength];
        const baseMultiplier = (multList && count < multList.length) ? multList[count] : 0;
        const config = getGameConfig("keno");
        const multiplierFactor = config ? config.multiplier : 1.0;
        const payoutAmount = Math.floor(bet.bet * baseMultiplier * multiplierFactor);

        bet.matchedCount = count;
        bet.payoutAmount = payoutAmount;
        bet.won = payoutAmount > 0;

        // Only resolve in database for REAL players (bots have IDs starting with 'bot_')
        if (!bet.userId.startsWith('bot_')) {
          try {
            if (payoutAmount > 0) {
              // Credit balance
              const res = await txManager.modifyBalance(bet.userId, payoutAmount, "win", `Keno Win (Round #${roundId})`);
              if (res.success) {
                this.io.to(`user_${bet.userId}`).emit("syncBalance", res.newBalance);
                this.io.emit('balanceUpdated', { userId: bet.userId, balance: res.newBalance });
              }
              
              // Insert log
              if (supabase) {
                await supabase.from("game_logs").insert({
                  user_id: bet.userId,
                  game_type: `Keno | R#${roundId} | Choice:${bet.numbers.join(',')} | Bet:${bet.bet} | WinNum:${drawNums.join(',')}`,
                  result: `Win`,
                  win_amount: payoutAmount
                });
              }
            } else {
              // Loss insert log
              if (supabase) {
                await supabase.from("game_logs").insert({
                  user_id: bet.userId,
                  game_type: `Keno | R#${roundId} | Choice:${bet.numbers.join(',')} | Bet:${bet.bet} | WinNum:${drawNums.join(',')}`,
                  result: `Loss`,
                  win_amount: 0
                });
              }
            }
            
            // Trigger logs and transactions reload
            this.io.to(`user_${bet.userId}`).emit("userGameLogsUpdated");
          } catch (e) {
            console.error(`Error resolving Keno bet for user ${bet.userId}:`, e);
          }
        }
      }

      // Add this round to history
      this.state.history.unshift({
        id: roundId,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        balls: [...drawNums]
      });
      if (this.state.history.length > 100) {
        this.state.history.pop();
      }

      // Save round to DB for persistence
      if (supabase) {
        supabase.from("game_logs").insert({
          user_id: "system_keno",
          game_type: `KenoRound | R#${roundId} | Draw:${drawNums.join(',')}`,
          result: `Draw`,
          win_amount: 0
        }).then(({ error }) => {
          if (error) console.error("Error saving Keno round to DB:", error);
        });
      }
    } catch (e) {
      console.error("Critical error in resolveBets:", e);
    }
  }

  private broadcast() {
    this.io.emit('keno_state', this.state);
  }

  public async placeBet(userId: string, username: string, numbers: number[], bet: number): Promise<{ success: boolean; message?: string; newBalance?: number; ticketId?: string }> {
    if (this.state.status !== 'betting') {
      return { success: false, message: "በአሁኑ ሰዓት ውርርድ ተዘግቷል። (Betting is closed for this round)" };
    }
    if (this.state.timeLeft < 3) {
      return { success: false, message: "ውርርድ ሊያልቅ ስለሆነ መወራረድ አይችሉም። (Time limit reached)" };
    }
    if (!numbers || numbers.length < 1 || numbers.length > 10) {
      return { success: false, message: "እባክዎ ከ 1 እስከ 10 ቁጥሮች ይምረጡ። (Select 1 to 10 numbers)" };
    }
    const config = getGameConfig("keno");
    if (config) {
      if (!config.enabled) {
        return { success: false, message: "ኬኖ ጨዋታ ለጊዜው ተዘግቷል። (Keno is temporarily disabled by admin)" };
      }
      if (bet < config.minBet) {
        return { success: false, message: `ዝቅተኛው ውርርድ ${config.minBet} ብር ነው። (Minimum bet is ${config.minBet} ETB)` };
      }
      if (bet > config.maxBet) {
        return { success: false, message: `ከፍተኛው ውርርድ ${config.maxBet} ብር ነው። (Maximum bet is ${config.maxBet} ETB)` };
      }
    } else if (bet < 5) {
      return { success: false, message: "ዝቅተኛው ውርርድ 5 ብር ነው። (Minimum bet is 5 ETB)" };
    }

    // Deduct user balance
    try {
      const res = await txManager.modifyBalance(userId, -bet, "bet", `Keno Bet (Round #${this.state.roundId})`);
      if (!res.success) {
        return { success: false, message: res.error || "የሂሳብ መጠንዎ በቂ አይደለም። (Insufficient balance)" };
      }

      const ticketId = Math.floor(Math.random() * 1000000).toString();
      this.state.bets.push({
        id: ticketId,
        userId,
        username,
        numbers,
        bet,
        timestamp: Date.now()
      });

      this.broadcast();
      
      // Notify client
      this.io.to(`user_${userId}`).emit("syncBalance", res.newBalance);
      this.io.emit('balanceUpdated', { userId, balance: res.newBalance });

      return { success: true, newBalance: res.newBalance, ticketId };
    } catch (e: any) {
      console.error("Error placing Keno bet:", e);
      return { success: false, message: "ውርርድ መመዝገብ አልተቻለም። (Failed to place bet)" };
    }
  }
}

let kenoEngine: KenoEngine | null = null;

export function initKenoEngine(io: Server) {
  if (!kenoEngine) {
    kenoEngine = new KenoEngine(io);
  }

  io.on("connection", (socket: Socket) => {
    socket.emit('keno_state', kenoEngine!.state);

    socket.on('keno_place_bet', async (data: { userId: string, username: string, numbers: number[], bet: number }, callback) => {
      const res = await kenoEngine!.placeBet(data.userId, data.username, data.numbers, data.bet);
      if (callback) callback(res);
    });
  });
}
