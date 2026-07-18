import { Server, Socket } from "socket.io";
import { BingoRoomState } from "../types";
import { supabase } from "./supabase.js";
import { txManager } from "./transactionManager.js";
import { getDeterministicCard } from "../utils/bingo.js";
import { getGameConfig } from "./gameSettings.js";

const LOBBY_TIME = 50;
const CALL_INTERVAL = 4000; // 4 seconds per ball
const RESULT_TIME = 10;

export class BingoRoom {
  state: BingoRoomState;
  private io: Server;
  private timer: NodeJS.Timeout | null = null;
  private broadcastTimeout: NodeJS.Timeout | null = null;
  private ballSequence: number[] = [];
  private ballIndex = 0;

  constructor(id: string, io: Server, betAmount: number) {
    this.io = io;
    this.state = {
      id,
      roundId: "",
      status: "lobby",
      timeLeft: LOBBY_TIME,
      players: {},
      calledBalls: [],
      winners: [],
      onlineCount: 0,
      betAmount,
      gameId: this.generateGameId(id)
    };
    this.startLobby();
  }

  private generateGameId(roomId?: string) {
     const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing characters like 0, O, 1, I
     const random = Array.from({length: 5}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
     const id = roomId || (this.state && this.state.id) || 'bingo-10';
     const prefix = id === 'bingo-10' ? 'B10' : 'B20';
     return `${prefix}-${random}`;
  }

  private clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private startLobby() {
    this.clearTimer();
    
    this.state.status = "lobby";
    this.state.timeLeft = LOBBY_TIME;
    this.state.players = {};
    this.state.calledBalls = [];
    this.state.winners = [];
    this.state.currentBall = undefined;
    this.state.roundId = Math.floor(Date.now() / 1000).toString();
    this.state.gameId = this.generateGameId();
    
    this.broadcastState();
    
    this.timer = setInterval(() => {
      if (this.state.timeLeft > 0) {
        this.state.timeLeft--;
        
        this.broadcastState();
      } else {
        this.clearTimer();
        this.startPlaying();
      }
    }, 1000);
  }

  private startPlaying() {
    // We want the game to start even if no players selected a card, so spectators can watch
    // if (Object.keys(this.state.players).length === 0) {
    //    this.startLobby();
    //    return;
    // }

    this.state.status = "playing";
    const nums = Array.from({length: 75}, (_, i) => i + 1);
    for (let i = nums.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    this.ballSequence = nums;
    this.ballIndex = 0;
    this.broadcastState();
    
    this.callNextBall();
  }

  private callNextBall() {
    this.clearTimer();

    if (this.ballIndex >= this.ballSequence.length || this.state.winners.length > 0) {
       this.showResult();
       return;
    }

    this.state.currentBall = this.ballSequence[this.ballIndex];
    this.state.calledBalls.push(this.state.currentBall);
    this.ballIndex++;
    
    this.broadcastState();

    this.timer = setTimeout(() => {
       this.callNextBall();
    }, CALL_INTERVAL);
  }

  private showResult() {
     this.clearTimer();
     
     this.state.status = "result";
     this.state.timeLeft = RESULT_TIME;
     this.broadcastState();
     
     this.timer = setInterval(() => {
        this.state.timeLeft--;
        if (this.state.timeLeft <= 0) {
           this.clearTimer();
           this.startLobby();
        } else {
           this.broadcastState();
        }
     }, 1000);
  }

  public broadcastState() {
    if (!this.broadcastTimeout) {
      this.broadcastTimeout = setTimeout(() => {
        const clientsInRoom = this.io.sockets.adapter.rooms.get(this.state.id)?.size || 0;
        this.state.onlineCount = clientsInRoom;
        
        // Calculate current jackpot
        let totalCards = 0;
        Object.values(this.state.players).forEach(p => {
           totalCards += p.cards.length;
        });
        this.state.jackpot = Math.floor(totalCards * this.state.betAmount * 0.8);
        
        this.io.to(this.state.id).emit("bingo_state", this.state);
        this.broadcastTimeout = null;
      }, 50);
    }
  }

  public join(userId: string, username: string, cards: number[], photoUrl?: string) {
     if (this.state.status !== "lobby") return { success: false, message: "Game already in progress" };
     if (cards.length === 0 || cards.length > 2) return { success: false, message: "Invalid cards count" };
     
     // Check if any of the cards is already selected by another player
     for (const card of cards) {
        for (const [pId, p] of Object.entries(this.state.players)) {
           if (pId !== userId && p.cards.includes(card)) {
              return { success: false, message: `Card ${card} is already taken by another player` };
           }
        }
     }
     
     this.state.players[userId] = { userId, username, cards, photoUrl };
     this.broadcastState();
     
     // Check if all 400 cards are taken
     let totalCards = 0;
     for (const p of Object.values(this.state.players)) {
       totalCards += p.cards.length;
     }
     if (totalCards >= 400 && this.state.status === "lobby" && this.state.timeLeft > 10) {
       this.state.timeLeft = 10;
       this.broadcastState();
     }
     
     return { success: true };
  }

  public leave(userId: string) {
     delete this.state.players[userId];
     this.broadcastState();
  }

  public claimBingo(userId: string) {
     if (this.state.status !== "playing") return { success: false, message: "Not in playing state" };
     const player = this.state.players[userId];
     if (!player) return { success: false, message: "Player not found" };

     // Check each card
     let won = false;
     let isExpired = false;
     let winType = "";
     let winningCardId = player.cards[0];
     
     for (const cardId of player.cards) {
        const cardNumbers = getDeterministicCard(cardId);
        const checkResult = checkBingo(cardNumbers, this.state.calledBalls);
        
        if (checkResult.won) {
           // Missed Call Rule: A win is only valid if the last ball called is part of a winning pattern.
           // This allows winning if a subsequent ball completes a new pattern even if an old one was missed.
           if (!checkResult.isFresh) {
              isExpired = true;
              continue; 
           }
           
           won = true;
           winType = checkResult.type;
           winningCardId = cardId;
           break;
        }
     }

     if (!won && isExpired) {
        return { success: false, message: "አልፎአል (Expired)", code: "EXPIRED" };
     }

     if (won) {
        // Calculate win amount based on total cards in play
        let totalCardsInRound = 0;
        Object.values(this.state.players).forEach(p => {
           totalCardsInRound += p.cards.length;
        });
        
        const totalPool = totalCardsInRound * this.state.betAmount;
        const configKey = this.state.id === "bingo-10" ? "bingo_10" : "bingo_20";
        const config = getGameConfig(configKey);
        const distFactor = config ? config.multiplier : 0.8;
        const winAmount = Math.floor(totalPool * distFactor);

        this.state.winners.push({ userId, username: player.username, type: winType, winAmount, cardId: winningCardId, cards: player.cards });
        this.showResult();
        return { success: true, winAmount };
     }

     return { success: false, message: "Not a valid Bingo yet! Need a Line or 4 Corners." };
  }
}

function checkBingo(card: number[][], calledBalls: number[]): { won: boolean; type: string; isFresh: boolean } {
  if (calledBalls.length === 0) return { won: false, type: "", isFresh: false };
  
  const lastBall = calledBalls[calledBalls.length - 1];
  const marked = card.map(col => col.map(num => num === 0 || calledBalls.includes(num)));
  
  let expiredWinType = "";
  let hasAnyWin = false;

  // Helper to check a specific pattern
  const checkPattern = (coords: [number, number][], type: string) => {
    if (coords.every(([c, r]) => marked[c][r])) {
      hasAnyWin = true;
      // It's a fresh win if the last ball called is part of this specific pattern
      const isFresh = coords.some(([c, r]) => card[c][r] === lastBall);
      if (isFresh) return { won: true, type, isFresh: true };
      if (!expiredWinType) expiredWinType = type;
    }
    return null;
  };

  // 1. Check 4 corners
  const res4c = checkPattern([[0,0], [4,0], [0,4], [4,4]], "4 Corners");
  if (res4c) return res4c;

  // 2. Check Horizontal Lines
  for (let r = 0; r < 5; r++) {
     const res = checkPattern([[0,r], [1,r], [2,r], [3,r], [4,r]], "Horizontal Line");
     if (res) return res;
  }

  // 3. Check Vertical Lines
  for (let c = 0; c < 5; c++) {
     const res = checkPattern([[c,0], [c,1], [c,2], [c,3], [c,4]], "Vertical Line");
     if (res) return res;
  }

  // 4. Check Diagonals
  const resD1 = checkPattern([[0,0], [1,1], [2,2], [3,3], [4,4]], "Diagonal Line");
  if (resD1) return resD1;
  const resD2 = checkPattern([[0,4], [1,3], [2,2], [3,1], [4,0]], "Diagonal Line");
  if (resD2) return resD2;

  if (hasAnyWin) {
     return { won: true, type: expiredWinType, isFresh: false };
  }

  return { won: false, type: "", isFresh: false };
}

export function initBingoEngine(io: Server) {
   const bingoRooms: Record<string, BingoRoom> = {
      "bingo-10": new BingoRoom("bingo-10", io, 10),
      "bingo-20": new BingoRoom("bingo-20", io, 20),
   };

   // Offset the start time for the second room so they aren't perfectly synced
   bingoRooms["bingo-20"].state.timeLeft = 30;

   // Broadcast global room states for the selection page every second
   setInterval(() => {
      io.emit("bingo_rooms_meta", {
         "bingo-10": { status: bingoRooms["bingo-10"].state.status, timeLeft: bingoRooms["bingo-10"].state.timeLeft },
         "bingo-20": { status: bingoRooms["bingo-20"].state.status, timeLeft: bingoRooms["bingo-20"].state.timeLeft }
      });
   }, 1000);

   io.on("connection", (socket: Socket) => {
      socket.on("bingo_join", async (data: { roomId: string, userId: string, username: string, cards: number[], photoUrl?: string }, callback) => {
         const room = bingoRooms[data.roomId];
         if (room) {
            const configKey = data.roomId === "bingo-10" ? "bingo_10" : "bingo_20";
            const config = getGameConfig(configKey);
            if (config) {
               if (!config.enabled) {
                  if (callback) callback({ success: false, message: "ቢንጎ ጨዋታ ለጊዜው ተዘግቷል። (Bingo is temporarily disabled by admin)" });
                  return;
               }
               room.state.betAmount = config.minBet;
            }

            if (room.state.status !== 'lobby') {
               if (callback) callback({ success: false, message: "Game in progress" });
               return;
            }

            const existingPlayer = room.state.players[data.userId];
            const oldCardCount = existingPlayer ? existingPlayer.cards.length : 0;
            const newCardCount = data.cards.length;
            const cardDiff = newCardCount - oldCardCount;
            
            if (cardDiff === 0) {
               // Just updating card IDs (e.g. swapping)
               const res = room.join(data.userId, data.username, data.cards, data.photoUrl);
               if (callback) callback(res);
               return;
            }

            const amountToCharge = cardDiff * room.state.betAmount;

            try {
               if (supabase) {
                  const { data: user } = await supabase.from("users").select("balance").eq("id", data.userId).single();
                  
                  if (cardDiff > 0) {
                     // Need to deduct more
                     if (!user || user.balance < amountToCharge) {
                        if (callback) callback({ success: false, message: "Insufficient balance" });
                        return;
                     }
                  }

                  const res = await txManager.modifyBalance(data.userId, -amountToCharge, cardDiff > 0 ? "bet" : "refund", cardDiff > 0 ? `Bingo Bet Update (${data.roomId}, +${cardDiff} cards)` : `Bingo Refund Update (${data.roomId}, ${Math.abs(cardDiff)} cards removed)`);
                  if (!res.success) {
                     if (callback) callback({ success: false, message: res.error || "Insufficient balance" });
                     return;
                  }
                  io.to(`user_${data.userId}`).emit("syncBalance", res.newBalance);
               }
            } catch (e) {
               console.error("Bingo balance update error:", e);
               if (callback) callback({ success: false, message: "Balance update failed" });
               return;
            }

            socket.join(data.roomId);
            const res = room.join(data.userId, data.username, data.cards, data.photoUrl);
            if (callback) callback(res);
         }
      });

      socket.on("bingo_leave", async (data: { roomId: string, userId: string }) => {
         const room = bingoRooms[data.roomId];
         const player = room?.state.players[data.userId];
         
         if (room && room.state.status === 'lobby' && player) {
            const totalRefund = player.cards.length * room.state.betAmount;
            
            // Refund the user since the game hasn't started
            try {
               const res = await txManager.modifyBalance(data.userId, totalRefund, "refund", `Bingo Refund (${data.roomId}, ${player.cards.length} cards)`);
               if (res.success) {
                  io.to(`user_${data.userId}`).emit("syncBalance", res.newBalance);
               }
            } catch (e) {
               console.error("Bingo refund error:", e);
            }
            // socket.leave(data.roomId);
            room.leave(data.userId);
         } else if (room) {
            // Do NOT remove them from the game if it is already playing
            // socket.leave(data.roomId);
         }
      });

      socket.on("bingo_claim", async (data: { roomId: string, userId: string }, callback) => {
         const room = bingoRooms[data.roomId];
         if (room) {
            const res = room.claimBingo(data.userId);
            
            if (res.success && res.winAmount) {
               try {
                  if (supabase) {
                     const txRes = await txManager.modifyBalance(data.userId, res.winAmount, "win", `Bingo Win (${room.state.id})`);
                     await supabase.from("game_logs").insert({
                        user_id: data.userId,
                        game_type: `Bingo | ${room.state.gameId}`,
                        result: "Win",
                        win_amount: res.winAmount
                     });
                     if (txRes.success) {
                        io.to(`user_${data.userId}`).emit("syncBalance", txRes.newBalance);
                     }
                  }
               } catch (e) {
                  console.error("Bingo payout error:", e);
               }
            }
            
            if (callback) callback(res);
         }
      });
      
      socket.on("bingo_get_state", (roomId: string) => {
         const room = bingoRooms[roomId];
         if (room) {
            socket.join(roomId);
            socket.emit("bingo_state", room.state);
            room.broadcastState();
         }
      });

      
   });
}
