import { Server, Socket } from "socket.io";
import { supabase } from "./supabase.js";
import { txManager } from "./transactionManager.js";
import { logBot } from "./logger.js";
import { gridRooms, saveGridState, syncFromSupabase } from "./gridState.js";

export type Side = "even" | "odd";

export interface PlayerBet {
  userId: string;
  username: string;
  amount: number;
  side: Side;
  partial: boolean;
}

export interface RoomState {
  id: string;
  roundId: number;
  status: "betting" | "balancing" | "spinning" | "result";
  timeLeft: number;
  players: Record<string, PlayerBet>;
  pools: { even: number; odd: number };
  feed: string[];
  history: { roundId: number; winner: number; pools: { even: number; odd: number } }[];
  capacity: { even: number; odd: number };
  winner?: number; // 1-6
  onlineCount?: number;
  onlinePlayers?: Record<string, { userId: string; username: string; photoUrl?: string }>;
}

const MAX_CAPACITY = 200;
const BETTING_TIME = 60; // 0-55 open, 55-60 soft close (UI handles soft close)
const BALANCING_TIME = 10;
const SPINNING_TIME = 60;
const RESULT_TIME = 6; // Show result before restarting

class Room {
  state: RoomState;
  private timer: NodeJS.Timeout | null = null;
  private broadcastTimeout: NodeJS.Timeout | null = null;
  private io: Server;
  private roundIdCounter = 1;

  constructor(id: string, io: Server) {
    this.io = io;
    this.state = {
      id,
      roundId: this.roundIdCounter,
      status: "betting",
      timeLeft: BETTING_TIME,
      players: {},
      pools: { even: 0, odd: 0 },
      feed: [],
      history: [],
      capacity: { even: 0, odd: 0 },
      onlineCount: 0,
    };
    this.initRoundCounterAndStart();
  }

  private async initRoundCounterAndStart() {
    try {
      if (supabase) {
        // Load latest round number
        const { data, error } = await supabase
          .from("rounds")
          .select("round_number")
          .eq("room_id", this.state.id)
          .order("round_number", { ascending: false })
          .limit(1);
          
        if (!error && data && data.length > 0) {
          this.roundIdCounter = data[0].round_number;
          console.log(`Persistent Round ID Counter initialized to ${this.roundIdCounter} from database for room ${this.state.id}`);
        }

        // Load recent history (last 10 rounds)
        const { data: historyData, error: historyError } = await supabase
          .from("rounds")
          .select("round_number, winner, pools_even, pools_odd")
          .eq("room_id", this.state.id)
          .order("round_number", { ascending: false })
          .limit(10);

        if (!historyError && historyData) {
          this.state.history = historyData.map(r => ({
            roundId: r.round_number,
            winner: r.winner,
            pools: { even: r.pools_even, odd: r.pools_odd }
          }));
        }
      }
    } catch (err) {
      console.error("Failed to fetch initial state from Supabase:", err);
    }
    this.startLoop();
  }

  public updateOnlineCount() {
    const clientsInRoom = this.io.sockets.adapter.rooms.get(this.state.id);
    const count = clientsInRoom?.size || 0;
    this.state.onlineCount = count;

    const onlinePlayers: Record<string, { userId: string; username: string; photoUrl?: string }> = {};
    if (clientsInRoom) {
      for (const socketId of clientsInRoom) {
        const clientSocket = this.io.sockets.sockets.get(socketId);
        if (clientSocket && clientSocket.data && clientSocket.data.userId) {
          onlinePlayers[clientSocket.data.userId] = {
            userId: clientSocket.data.userId,
            username: clientSocket.data.username || `User_${clientSocket.data.userId.slice(0, 4)}`,
            photoUrl: clientSocket.data.photoUrl,
          };
        }
      }
    }
    this.state.onlinePlayers = onlinePlayers;
  }

  private startLoop() {
    this.roundIdCounter++;
    this.state.roundId = this.roundIdCounter;
    this.state.status = "betting";
    this.state.timeLeft = BETTING_TIME;
    this.state.players = {};
    this.state.pools = { even: 0, odd: 0 };
    // Maintain feed instead of clearing it
    // this.state.feed = []; 
    this.state.capacity = { even: 0, odd: 0 };
    this.state.winner = undefined;

    this.updateOnlineCount();
    this.broadcastState();

    this.timer = setInterval(() => {
      this.tick();
    }, 1000);
  }

  private tick() {
    this.state.timeLeft -= 1;
    this.broadcastState();

    if (this.state.timeLeft <= 0) {
      this.transitionState();
    }
  }

  private transitionState() {
    if (this.timer) clearInterval(this.timer);

    switch (this.state.status) {
      case "betting":
        this.doBalancing();
        break;
      case "balancing":
        this.startSpinning();
        break;
      case "spinning":
        this.showResult();
        break;
      case "result":
        this.startLoop();
        break;
    }
  }

  private doBalancing() {
    this.state.status = "balancing";
    this.state.timeLeft = BALANCING_TIME;

    // Balancing Logic
    // P2P Match - balance the pools
    if (this.state.pools.even !== this.state.pools.odd) {
        const overSide = this.state.pools.even > this.state.pools.odd ? 'even' : 'odd';
        const underSide = overSide === 'even' ? 'odd' : 'even';
        const targetPool = this.state.pools[underSide];
        
        let currentOverPool = 0;
        // Sort players by timestamp or just array order (first come first served)
        const overPlayers = Object.values(this.state.players).filter(p => p.side === overSide);
        
        for (const p of overPlayers) {
          if (currentOverPool + p.amount <= targetPool) {
            currentOverPool += p.amount;
          } else {
            // This bet crosses the threshold
            const remaining = targetPool - currentOverPool;
            if (remaining > 0 && p.partial) {
              // Refund the difference
              const refund = p.amount - remaining;
              p.amount = remaining;
              currentOverPool += remaining;
              if (p.amount > 0) {
              this.state.feed.unshift(`የ${p.username} ባለው ${p.amount.toLocaleString()} ሄደሃል።`);
            } else {
              this.state.feed.unshift(`የ${p.username} በዚህ ዙር አልሄድክም`);
            }
              this.io.to(p.userId).emit('refund', refund);
              // Update user balance in DB
              txManager.modifyBalance(p.userId, refund, "refund", "Partial Refund / Balance Adjust").then((res) => { if (res.success) { this.io.to(`user_${p.userId}`).emit("syncBalance", res.newBalance); } });
              // Log refund to DB for factual reporting
              supabase.from("transactions").insert({
                user_id: p.userId,
                amount: refund,
                type: "refund",
                description: `Even/Odd Partial Refund (Pool Limit, Round #${this.state.roundId})`
              }).then(({ error }) => { if (error) console.error("Refund log failed:", error); });
            } else {
              // Reject the whole bet
              const refund = p.amount;
              p.amount = 0; // effectively removed
              this.state.feed.unshift(`የ${p.username} በዚህ ዙር አልሄድክም`);
              this.io.to(p.userId).emit('refund', refund);
              // Update user balance in DB
              txManager.modifyBalance(p.userId, refund, "refund", "Partial Refund / Balance Adjust").then((res) => { if (res.success) { this.io.to(`user_${p.userId}`).emit("syncBalance", res.newBalance); } });
              // Log refund to DB for factual reporting
              supabase.from("transactions").insert({
                user_id: p.userId,
                amount: refund,
                type: "refund",
                description: `Even/Odd Refund (Pool Limit, Round #${this.state.roundId})`
              }).then(({ error }) => { if (error) console.error("Refund log failed:", error); });
            }
          }
        }
        this.state.pools[overSide] = targetPool;
      }

    // Determine winner early for animation
    const isEvenWinner = Math.random() > 0.5;

    // Even numbers: 2, 4, 6. Odd numbers: 1, 3, 5
    const evenNumbers = [2, 4, 6];
    const oddNumbers = [1, 3, 5];

    this.state.winner = isEvenWinner 
       ? evenNumbers[Math.floor(Math.random() * evenNumbers.length)]
       : oddNumbers[Math.floor(Math.random() * oddNumbers.length)];

    this.broadcastState();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  private startSpinning() {
    this.state.status = "spinning";
    this.state.timeLeft = SPINNING_TIME;
    this.broadcastState();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  private async showResult() {
    this.state.status = "result";
    this.state.timeLeft = RESULT_TIME;
    
    // Add to history
    if (this.state.winner !== undefined) {
      this.state.history.unshift({
        roundId: this.state.roundId,
        winner: this.state.winner,
        pools: { ...this.state.pools }
      });
      if (this.state.history.length > 20) this.state.history.pop();
    }

    this.broadcastState();
    this.timer = setInterval(() => this.tick(), 1000);

    // Async save to Supabase and handle payouts
    try {
      if (supabase) {
        // Handle Payouts for Main-Room
        const winners: string[] = [];
        const winningSide = (this.state.winner !== undefined && this.state.winner % 2 === 0) ? 'even' : 'odd';
        
        for (const p of Object.values(this.state.players)) {
          if (p.amount > 0 && p.side === winningSide) {
            const prize = p.amount * 2;
            winners.push(p.userId);
            
            // Update balance in Supabase
            txManager.modifyBalance(p.userId, prize, "win", `Even/Odd Win (Round #${this.state.roundId}, Side: ${winningSide})`).then((res) => {
              if (res.success) {
                this.io.to(`user_${p.userId}`).emit("syncBalance", res.newBalance);
              }
            });
          }
        }

        // Save round
        const { data: roundData, error: roundError } = await supabase
          .from("rounds")
          .insert({
            round_number: this.state.roundId,
            winner: this.state.winner,
            pools_even: this.state.pools.even,
            pools_odd: this.state.pools.odd,
            room_id: this.state.id
          })
          .select()
          .single();
          
        if (roundError) {
          console.error("Error saving round to Supabase:", roundError);
        } else if (roundData) {
          // Save bets
          const betsToInsert = Object.values(this.state.players).map(p => ({
            round_id: roundData.id,
            user_id: p.userId,
            username: p.username,
            amount: p.amount,
            side: p.side
          })).filter(b => b.amount > 0);
          
          if (betsToInsert.length > 0) {
            const { error: betsError } = await supabase
              .from("bets")
              .insert(betsToInsert);
            if (betsError) console.error("Error saving bets to Supabase:", betsError);
          }
        }
      }
    } catch (err) {
      console.error("Failed to connect to Supabase for logging:", err);
    }
  }

  public broadcastState() {
    if (!this.broadcastTimeout) {
      this.broadcastTimeout = setTimeout(() => {
        this.io.to(this.state.id).emit("roomState", this.state);
        this.broadcastTimeout = null;
      }, 50);
    }
  }

  public placeBet(userId: string, username: string, amount: number, side: Side, partial: boolean) {
    if (this.state.status !== "betting" || this.state.timeLeft < 5) {
      return { success: false, message: "Betting is closed for this round." };
    }

    const existingBet = this.state.players[userId];

    if (existingBet) {
      const oldAmount = existingBet.amount;
      const oldSide = existingBet.side;
      
      if (oldSide !== side) {
         if (this.state.capacity[side] >= MAX_CAPACITY) {
           return { success: false, message: "Room capacity reached for this side." };
         }
         this.state.capacity[oldSide] -= 1;
         this.state.capacity[side] += 1;
      }
      
      this.state.pools[oldSide] -= oldAmount;
      this.state.pools[side] += amount;
      
      existingBet.amount = amount;
      existingBet.side = side;
      existingBet.partial = partial;
      
      const sideName = side === 'even' ? 'ሞላ' : 'ጎደል';
      this.state.feed.unshift(`${username} ውርርዱን ወደ ${amount.toLocaleString()} ETB ${sideName} ላይ አሻሽሏል!`);
    } else {
      if (this.state.capacity[side] >= MAX_CAPACITY) {
        return { success: false, message: "Room capacity reached for this side." };
      }
      this.state.players[userId] = { userId, username, amount, side, partial };
      this.state.capacity[side] += 1;
      this.state.pools[side] += amount;
      
      const sideName = side === 'even' ? 'ሞላ' : 'ጎደል';
      this.state.feed.unshift(`${username} ${amount.toLocaleString()} ETB ${sideName} ላይ ተጫውቷል!`);
    }

    if (this.state.feed.length > 30) this.state.feed.pop();
    this.broadcastState();

    // Instant lock if both sides full
    if (this.state.capacity.even >= MAX_CAPACITY && this.state.capacity.odd >= MAX_CAPACITY) {
       this.transitionState(); // Move to balancing instantly
    }

    return { success: true };
  }
}

export function initGameEngine(io: Server) {
  const rooms = {
    "Main-Room": new Room("Main-Room", io),
  };
  
  const generateWinnersForRoom = (roomName: string, maxSlots: number) => {
    const slots = Array.from({ length: maxSlots }, (_, i) => i + 1);
    const picked: number[] = [];
    while (picked.length < 3 && slots.length > 0) {
      const idx = Math.floor(Math.random() * slots.length);
      picked.push(slots.splice(idx, 1)[0]);
    }
    return {
      1: picked[0],
      2: picked[1],
      3: picked[2],
      first: picked[0],
      second: picked[1],
      third: picked[2]
    };
  };

  // Pre-fetch history for grid rooms
  Object.keys(gridRooms).forEach(async (roomName) => {
      try {
        const { supabase } = await import("./supabase.js");
        if (supabase) {
            const { data: historyData } = await supabase
              .from("rounds")
              .select("round_number, winner, pools_even, pools_odd") // Note: pools_even/odd might not apply, need to check DB schema if possible. Using winners instead.
              .eq("room_id", roomName)
              .order("round_number", { ascending: false })
              .limit(10);
            
            if (historyData) {
                gridRooms[roomName].history = historyData.map(r => ({
                    roundId: r.round_number,
                    winners: { 
                        1: r.winner,
                        2: r.pools_even !== null && r.pools_even !== undefined && Number(r.pools_even) !== 0 ? Number(r.pools_even) : undefined,
                        3: r.pools_odd !== null && r.pools_odd !== undefined && Number(r.pools_odd) !== 0 ? Number(r.pools_odd) : undefined
                    }
                }));
            }
        }
      } catch (err) {
          console.error(`Failed to fetch history for grid room ${roomName}:`, err);
      }
  });

  // Setup Realtime Listener for Balance Changes
  import("./supabase.js").then(({ supabase }) => {
    if (supabase) {
      supabase.channel('public:users')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, (payload) => {
          const updatedUser = payload.new;
          if (updatedUser && updatedUser.id) {
            io.to(`user_${updatedUser.id}`).emit('syncBalance', updatedUser.balance);
          }
        })
        .subscribe();
    }
  }).catch(console.error);

  io.on("connection", (socket: Socket) => {
    let currentRoomId: string | null = null;
    
    // Auth & Balance syncing
    socket.on("syncUser", async (userId: string, username: string, photoUrl?: string, firstName?: string, lastName?: string) => {
      socket.data.userId = userId;
      socket.data.username = username;
      socket.data.photoUrl = photoUrl;

      if (currentRoomId && rooms[currentRoomId as keyof typeof rooms]) {
        const r = rooms[currentRoomId as keyof typeof rooms];
        r.updateOnlineCount();
        r.broadcastState();
      }

      // Join a personal room to receive private realtime updates
      socket.join(`user_${userId}`);
      
      const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

      try {
        const { supabase } = await import("./supabase.js");
        if (!supabase) return;
        
        if (clientIp) {
            const ipString = Array.isArray(clientIp) ? clientIp[0] : clientIp;
            const { data: existingIp } = await supabase.from("transactions").select("id").eq("user_id", userId).eq("type", "ip_log").eq("description", `IP: ${ipString}`).limit(1);
            if (!existingIp || existingIp.length === 0) {
                await supabase.from("transactions").insert({ user_id: userId, amount: 0, type: "ip_log", description: `IP: ${ipString}` });
            }
        }

        
        // Fetch user first to see if they exist
        let { data: user, error: fetchError } = await supabase
          .from("users")
          .select("*")
          .eq("id", userId)
          .single();

        if (!user) {
          // New player - insert with balance 0
          const { data: newUser, error: insertError } = await supabase
            .from("users")
            .insert({
              id: userId,
              username,
              balance: 0,
              ...(photoUrl ? { photo_url: photoUrl } : {}),
              ...(firstName ? { first_name: firstName } : {}),
              ...(lastName ? { last_name: lastName } : {})
            })
            .select()
            .single();
          if (newUser) user = newUser;
        } else {
          // Update existing user info
          const { data: updatedUser } = await supabase
            .from("users")
            .update({
              username,
              ...(photoUrl ? { photo_url: photoUrl } : {}),
              ...(firstName ? { first_name: firstName } : {}),
              ...(lastName ? { last_name: lastName } : {})
            })
            .eq("id", userId)
            .select()
            .single();
          if (updatedUser) user = updatedUser;
        }
          
        if (user) {
           socket.emit("syncBalance", user.balance);
        } else {
           // Fallback for preview/local dev if Supabase is not configured or working
           socket.emit("syncBalance", 0);
        }
      } catch (e) {
        console.error("Sync user error:", e);
        // Fallback for preview/local dev
        socket.emit("syncBalance", 0);
      }
    });

    socket.on("logTransaction", async (data: { userId: string, amount: number, type: string, description: string }) => {
      try {
        const { txManager } = await import("./transactionManager.js");
        const { supabase } = await import("./supabase.js");
        if (!supabase) return;
        
        const res = await txManager.modifyBalance(data.userId, data.amount, data.type, data.description);
        if (res.success) {
           socket.emit("syncBalance", res.newBalance);
        }

        // --- REFERRAL REVENUE SHARE (Passive Income for Influencers) ---
        // Give the referrer 1% of the bet amount as passive commission
        if (data.type === "bet" && data.amount < 0) {
           // Check and bind pending deep link share referral first
           try {
             const { getPendingReferral, deletePendingReferral } = await import("./redisClient.js");
             const pendingRefId = await getPendingReferral(data.userId);
             if (pendingRefId && pendingRefId !== data.userId) {
                // Check if they already have an existing referral_link transaction
                const { data: existingRef } = await supabase.from("transactions")
                  .select("id")
                  .eq("user_id", data.userId)
                  .eq("type", "referral_link")
                  .limit(1);

                if (!existingRef || existingRef.length === 0) {
                   await supabase.from("transactions").insert({
                     user_id: data.userId,
                     amount: 0,
                     type: "referral_link",
                     description: `Referred by ${pendingRefId}`
                   });

                   try {
                     await supabase.from("users").update({ referrer_id: pendingRefId }).eq("id", data.userId);
                   } catch (err) {
                     console.warn("⚠️ Failed to update users.referrer_id during claim-slot bind:", err.message);
                   }
                }
                await deletePendingReferral(data.userId);
             }
           } catch (e) {
             console.error("⚠️ Failed processing pending referral deep-link:", e.message);
           }

           const { data: refTx } = await supabase.from("transactions")
             .select("description")
             .eq("user_id", data.userId)
             .eq("type", "referral_link")
             .limit(1);
               
           if (refTx && refTx.length > 0 && refTx[0].description.startsWith("Referred by ")) {
             const referrerId = refTx[0].description.replace("Referred by ", "");
             const betAmount = Math.abs(data.amount);
             const commission = Math.floor(betAmount * 0.01); // 1% commission
               
             if (commission > 0 && referrerId && referrerId !== data.userId) {
                 
               // Anti-Syndicate IP Check
               const { data: pIps } = await supabase.from("transactions").select("description").eq("user_id", data.userId).eq("type", "ip_log");
               const { data: rIps } = await supabase.from("transactions").select("description").eq("user_id", referrerId).eq("type", "ip_log");
                 
               const playerIps = pIps?.map(t => t.description) || [];
               const referrerIps = rIps?.map(t => t.description) || [];
                 
               const hasOverlap = playerIps.some(ip => referrerIps.includes(ip));
                 
               if (hasOverlap) {
                 const { data: existingFlags } = await supabase.from("transactions").select("id").eq("user_id", referrerId).eq("type", "affiliate_flag");
                 if (!existingFlags || existingFlags.length === 0) {
                     await supabase.from("transactions").insert({
                         user_id: referrerId,
                         amount: 0,
                         type: "affiliate_flag",
                         description: `Flagged for IP match with referred user ${data.userId}`
                     });
                 }
               }
                 
               const { data: flags } = await supabase.from("transactions").select("id").eq("user_id", referrerId).eq("type", "affiliate_flag");
                 
               if (!flags || flags.length === 0) {
                 await supabase.from("transactions").insert({
                   user_id: referrerId,
                   amount: commission,
                   type: "affiliate_commission", // Separate type for manual payout
                   description: `Referral Commission (1% of bet from ${data.userId})`
                 });
               }
             }
           }
        }
        // ---------------------------------------------------------------

        // Auto-sync client with the latest 50 transactions from DB
        const { data: txData, error: txError } = await supabase
          .from("transactions")
          .select("*")
          .eq("user_id", data.userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (!txError && txData) {
          socket.emit("userTransactions", txData);
        }
      } catch (e) {
         console.error("Log tx error:", e);
      }
    });


    socket.on("logGamePlay", async (data: { userId: string, gameType: string, result: string, winAmount: number }) => {
      try {
        const { txManager } = await import("./transactionManager.js");
        const { supabase } = await import("./supabase.js");
        if (!supabase) return;
        
        const res = await txManager.modifyBalance(data.userId, data.winAmount, "game_win", `Win in ${data.gameType}`);
        if (res.success) {
           socket.emit("syncBalance", res.newBalance);
        }

        await supabase.from("game_logs").insert({
           user_id: data.userId,
           game_type: data.gameType,
           result: data.result,
           win_amount: data.winAmount
        });

        // Auto-sync client with the latest 50 game logs from DB
        const { data: logsData, error: logsError } = await supabase
          .from("game_logs")
          .select("*")
          .eq("user_id", data.userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (!logsError && logsData) {
          socket.emit("userGameLogs", logsData);
        }
      } catch (e) {
         console.error("Log game error:", e);
      }
    });

    socket.on("getUserTransactions", async (userId: string) => {
      try {
        const { supabase } = await import("./supabase.js");
        if (!supabase) return;
        const { data, error } = await supabase
          .from("transactions")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (!error && data) {
          socket.emit("userTransactions", data);
        }
      } catch (e) {
        console.error("Get tx error:", e);
      }
    });

    socket.on("getAffiliateStats", async (userId: string) => {
      try {
        const { supabase } = await import("./supabase.js");
        if (!supabase) return;
        // 1. Get unique user IDs from referral transactions
        const { data: refTx } = await supabase.from('transactions')
          .select('user_id')
          .eq('type', 'referral_link')
          .ilike('description', `Referred by ${userId}%`);
        
        const referredUserIds = new Set<string>();
        if (refTx) {
          refTx.forEach(tx => {
            if (tx.user_id) referredUserIds.add(tx.user_id);
          });
        }

        // 2. Also check the users table directly (for newer referrals)
        const { data: directUsers } = await supabase
          .from('users')
          .select('id')
          .eq('referrer_id', userId);

        if (directUsers) {
          directUsers.forEach(u => referredUserIds.add(u.id));
        }

        const totalReferrals = referredUserIds.size;
        
        // Check if flagged
        const { data: flags } = await supabase.from('transactions')
          .select('id').eq('type', 'affiliate_flag').eq('user_id', userId);
        const isFlagged = flags && flags.length > 0;
        
        const { data: earnTx } = await supabase.from('transactions')
          .select('amount, type, description')
          .eq('user_id', userId)
          .in('type', ['affiliate_commission', 'affiliate_withdrawal', 'reward', 'affiliate_payout_request']);

        let totalEarned = 0;
        let availableBalance = 0;
        if (earnTx) {
            earnTx.forEach(tx => {
                const amt = Number(tx.amount || 0);
                if (tx.type === 'affiliate_commission') {
                    totalEarned += amt;
                    availableBalance += amt;
                } else if (tx.type === 'reward') {
                    // Only count as affiliate reward if it's explicitly referral-related
                    if (tx.description?.toLowerCase().includes('referral') || tx.description?.toLowerCase().includes('promoter')) {
                        totalEarned += amt;
                        availableBalance += amt;
                    }
                } else {
                    // affiliate_withdrawal and affiliate_payout_request are negative
                    availableBalance += amt;
                }
            });
        }
        
        availableBalance = Math.max(0, availableBalance);
        
        socket.emit("affiliateStats", { totalReferrals, totalEarned, availableBalance, isFlagged });
      } catch (e) {
        console.error("Error fetching affiliate stats:", e);
      }
    });

    socket.on("requestAffiliatePayout", async (data: { userId: string, amount: number, bankName: string, bankAccount: string }) => {
        try {
            const { userId, amount, bankName, bankAccount } = data;
            const { supabase } = await import("./supabase.js");
            if (!supabase) return;
            
            // Validate minimum amount (1000 ETB)
            if (amount < 1000) {
                socket.emit("notification", { message: "Minimum payout threshold is 1,000 ETB.", type: "error" });
                return;
            }

            if (!bankName || !bankAccount) {
                socket.emit("notification", { message: "Bank name and account number are required.", type: "error" });
                return;
            }
            
            // Check if already flagged
            const { data: flags } = await supabase.from('transactions')
              .select('id').eq('type', 'affiliate_flag').eq('user_id', userId);
            if (flags && flags.length > 0) {
                socket.emit("notification", { message: "Your affiliate account is currently flagged. Payout denied.", type: "error" });
                return;
            }
            
            // Calculate available balance
            const { data: earnTx } = await supabase.from('transactions')
              .select('amount, type, description')
              .eq('user_id', userId)
              .in('type', ['affiliate_commission', 'affiliate_withdrawal', 'reward', 'affiliate_payout_request']);
            
            let availableBalance = 0;
            if (earnTx) {
                earnTx.forEach(tx => {
                    const amt = Number(tx.amount || 0);
                    if (tx.type === 'affiliate_commission') {
                        availableBalance += amt;
                    } else if (tx.type === 'reward') {
                        if (tx.description?.toLowerCase().includes('referral') || tx.description?.toLowerCase().includes('promoter')) {
                            availableBalance += amt;
                        }
                    } else {
                        // negative for withdrawals and requests
                        availableBalance += amt;
                    }
                });
            }
            
            availableBalance = Math.max(0, availableBalance);
            
            if (availableBalance < amount) {
                socket.emit("notification", { message: `Insufficient affiliate balance. Available: ${availableBalance.toLocaleString()} ETB`, type: "error" });
                return;
            }

            // Update user's default bank details (ignore error if columns don't exist yet)
            try {
                await supabase.from('users').update({
                    bank_name: bankName,
                    bank_account: bankAccount
                }).eq('id', userId);
            } catch (err) {
                console.warn("Could not update user bank info, columns might be missing:", err);
            }
            
            const description = `Affiliate Payout Request (Bank: ${bankName}, Acc: ${bankAccount})`;
            const { error } = await supabase.from('transactions').insert({
                user_id: userId,
                amount: -amount,
                type: 'affiliate_payout_request',
                description: description
            });
            
            if (error) throw error;
            
            socket.emit("notification", { message: "Payout request submitted for manual admin review.", type: "success" });
            
            // Notify Admins
            try {
                const { getBotInstance, getPrimaryOwnerId } = await import("./telegramBot.js");
                const bot = getBotInstance();
                if (bot) {
                    const ownerId = getPrimaryOwnerId();
                    const adminIds = process.env.TELEGRAM_ADMIN_IDS?.split(',') || [];
                    const allAdminIds = new Set([ownerId.toString(), ...adminIds.map(id => id.trim())]);
                    
                    const { data: user } = await supabase.from('users').select('username, first_name').eq('id', userId).single();
                    const userName = user?.username ? `@${user.username}` : (user?.first_name || userId);
                    
                    const adminMsg = `🚨 <b>New Affiliate Payout Request</b>\n\n` +
                                    `👤 <b>User:</b> ${userName} (<code>${userId}</code>)\n` +
                                    `💰 <b>Amount:</b> ${amount.toLocaleString()} ETB\n` +
                                    `🏦 <b>Bank:</b> ${bankName}\n` +
                                    `💳 <b>Account:</b> <code>${bankAccount}</code>\n\n` +
                                    `Review this request in the Affiliate Management panel.`;
                    
                    for (const adminId of allAdminIds) {
                        if (adminId) {
                            await bot.sendMessage(parseInt(adminId), adminMsg, { parse_mode: 'HTML' });
                        }
                    }
                }
            } catch (notifyErr) {
                console.error("Error notifying admins of payout request:", notifyErr);
            }

        } catch (e: any) {
            console.error("Payout request error:", e);
            socket.emit("notification", { message: `Error: ${e.message}`, type: "error" });
        }
    });

    socket.on("getUserGameLogs", async (userId: string) => {
      try {
        const { supabase } = await import("./supabase.js");
        if (!supabase) return;
        const { data, error } = await supabase
          .from("game_logs")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (!error && data) {
          socket.emit("userGameLogs", data);
        }
      } catch (e) {
        console.error("Get game logs error:", e);
      }
    });

    socket.on("joinRoom", (roomId: string) => {
      if (currentRoomId) {
        socket.leave(currentRoomId);
      }
      socket.join(roomId);
      currentRoomId = roomId;
      if (rooms[roomId as keyof typeof rooms]) {
        const r = rooms[roomId as keyof typeof rooms];
        r.updateOnlineCount();
        socket.emit("roomState", r.state);
        r.broadcastState();
      }
    });

    socket.on("disconnect", () => {
      if (currentRoomId && rooms[currentRoomId as keyof typeof rooms]) {
        const r = rooms[currentRoomId as keyof typeof rooms];
        r.updateOnlineCount();
        r.broadcastState();
      }
    });

    socket.on("getRoomsStatus", () => {
      const status = Object.keys(rooms).reduce((acc, key) => {
        const room = rooms[key as keyof typeof rooms];
        acc[key] = {
           status: room.state.status,
           even: room.state.capacity.even,
           odd: room.state.capacity.odd
        };
        return acc;
      }, {} as Record<string, any>);
      socket.emit("roomsStatus", status);
    });

    socket.on("grid_join", async (roomName: string) => {
      socket.join(roomName);
      if (!gridRooms[roomName]) {
        await syncFromSupabase();
        if (!gridRooms[roomName]) gridRooms[roomName] = { claimedSlots: {}, roundId: 1, history: [] };
      }
      socket.emit("grid_state", { ...gridRooms[roomName], roomName });
    });

    socket.on("grid_leave", (roomName: string) => {
      socket.leave(roomName);
    });

    socket.on("grid_gameResult", async (data: { room: string, roundId: number, winners: any }) => {
        const room = gridRooms[data.room];
        if (room) {
            // Check if this round was already processed to prevent double payouts
            if (room.roundId !== data.roundId) return;

            room.history.unshift({ roundId: data.roundId, winners: data.winners });
            if (room.history.length > 10) room.history.pop();
            
            // Save to Supabase and handle payouts
            try {
                const { supabase } = await import("./supabase.js");
                if (supabase) {
                    const winnerNum = data.winners[1] || data.winners.first;
                    const secondWinner = data.winners[2] || data.winners.second;
                    const thirdWinner = data.winners[3] || data.winners.third;
                    await supabase.from("rounds").insert({
                        round_number: data.roundId,
                        winner: winnerNum,
                        pools_even: secondWinner || null,
                        pools_odd: thirdWinner || null,
                        room_id: data.room
                    });

                    // Payout logic
                    const config = {
                      '1-10': { slots: 10, entry: 1000, p1: 9000 },
                      '1-20': { slots: 20, entry: 1000, p1: 18000 },
                      'mini': { slots: 50, entry: 2000, p1: 72000, p2: 12600, p3: 5400 },
                      'grand': { slots: 100, entry: 2000, p1: 144000, p2: 25200, p3: 10800 }
                    };
                    const roomConfig = (config as any)[data.room];

                    if (roomConfig) {
                        const winNums = [data.winners[1] || data.winners.first, data.winners[2] || data.winners.second, data.winners[3] || data.winners.third].filter(Boolean);
                        
                        for (let i = 0; i < winNums.length; i++) {
                            const wNum = winNums[i];
                            const winner = room.claimedSlots[wNum];
                            if (winner) {
                                let prize = 0;
                                if (data.room === 'mini' || data.room === 'grand') {
                                    if (i === 0) prize = roomConfig.p1;
                                    else if (i === 1) prize = roomConfig.p2;
                                    else prize = roomConfig.p3;
                                } else {
                                    prize = roomConfig.p1;
                                }

                                if (prize > 0) {
                                    const { txManager } = await import("./transactionManager.js");
                                    const res = await txManager.modifyBalance(winner.userId, prize, "win", `Win #${wNum} in ${data.room} (Place ${i+1})`);
                                    if (res.success) {
                                        io.to(`user_${winner.userId}`).emit("syncBalance", res.newBalance);
                                    }
                                    await supabase.from("game_logs").insert({
                                       user_id: winner.userId,
                                       game_type: `Jackpot ${data.room} | R#${data.roundId}`,
                                       result: `${i === 0 ? '1st' : i === 1 ? '2nd' : '3rd'} Place Win`,
                                       win_amount: prize
                                    });
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("Failed to save grid game result or payout to Supabase:", err);
            }
            
            // Broadcast the updated history
            io.to(data.room).emit("grid_state", { ...room, roomName: data.room });
            
            // Increment roundId for next game
            room.roundId += 1;
            room.claimedSlots = {};
            delete room.winners;
            saveGridState();
        }
    });

    socket.on("grid_claimSlot", async (data: { room: string, num: number, userId: string, username: string, photoUrl?: string }, callback) => {
      try {
        await syncFromSupabase();
        const room = gridRooms[data.room];
        const entryFee = data.room === '1-10' ? 1000 : data.room === '1-20' ? 1000 : data.room === 'mini' ? 2000 : 2000;
        const { supabase } = await import("./supabase.js");
        if (!supabase || !data.userId) {
          if (callback) callback({ success: false, message: "Unauthenticated session." });
          return;
        }

        if (room && !room.claimedSlots[data.num]) {
           const { txManager } = await import("./transactionManager.js");
           const res = await txManager.modifyBalance(data.userId, -entryFee, "bet", `Secured Slot #${data.num} in ${data.room}`);
           if (!res.success) {
               if (callback) callback({ success: false, message: res.error || `Insufficient balance (${entryFee} ETB required) or account not found.` });
               return;
           }
           io.to(`user_${data.userId}`).emit("syncBalance", res.newBalance);

           room.claimedSlots[data.num] = { isSelf: false, userId: data.userId, username: data.username, photoUrl: data.photoUrl };
           saveGridState();
           logBot(`[GameEngine] Slot #${data.num} claimed in ${data.room} by ${data.username} (${data.userId}). Total claimed: ${Object.keys(room.claimedSlots).length}`);
           
           const maxSlots = data.room === '1-10' ? 10 : data.room === '1-20' ? 20 : data.room === 'mini' ? 50 : 100;
           if (Object.keys(room.claimedSlots).length === maxSlots) {
             room.winners = generateWinnersForRoom(data.room, maxSlots);
           }

           io.to(data.room).emit("grid_state", { ...room, roomName: data.room });
           if (callback) callback({ success: true });
        } else {
           if (callback) callback({ success: false, message: "Slot already taken" });
        }
      } catch (err: any) {
        if (callback) callback({ success: false, message: "Authentication validation failed." });
        return;
      }
    });

    socket.on("grid_releaseSlot", async (data: { room: string, num: number, userId: string }, callback) => {
      await syncFromSupabase();
      const room = gridRooms[data.room];
      const entryFee = data.room === '1-10' ? 1000 : data.room === '1-20' ? 1000 : data.room === 'mini' ? 2000 : 2000;

      if (room && room.claimedSlots[data.num]?.userId === data.userId) {
         try {
           const { supabase } = await import("./supabase.js");
           if (supabase) {
             const { txManager } = await import("./transactionManager.js");
             const res = await txManager.modifyBalance(data.userId, entryFee, "refund", `Refund Slot #${data.num} (${data.room})`);
             if (res.success) {
                io.to(`user_${data.userId}`).emit("syncBalance", res.newBalance);
             }
           }
         } catch (e) {
           console.error("Refund error:", e);
         }

         delete room.claimedSlots[data.num];
         delete room.winners;
         saveGridState();
         io.to(data.room).emit("grid_state", { ...room, roomName: data.room });
         if (callback) callback({ success: true });
      }
    });

    socket.on("grid_nextRound", async (roomName: string) => {
       const room = gridRooms[roomName];
       if (room) {
          const maxSlots = roomName === '1-10' ? 10 : roomName === '1-20' ? 20 : roomName === 'mini' ? 50 : 100;
          if (Object.keys(room.claimedSlots).length >= maxSlots) {
             room.claimedSlots = {};
             room.roundId += 1;
             delete room.winners;
             saveGridState();
             io.to(roomName).emit("grid_state", { ...room, roomName });
          }
       }
    });

    socket.on("placeBet", async (data: { roomId: string, userId: string, username: string, amount: number, side: Side, partial: boolean }, callback) => {
      // Balance and authentication check
      try {
        const { supabase } = await import("./supabase.js");
        if (!supabase || !data.userId) {
          if (callback) callback({ success: false, message: "Unauthenticated session." });
          return;
        }

        const room = rooms[data.roomId as keyof typeof rooms];
        if (!room) {
          if (callback) callback({ success: false, message: "Room not found." });
          return;
        }

        const existingBet = room.state.players[data.userId];
        const oldAmount = existingBet ? existingBet.amount : 0;
        const diff = data.amount - oldAmount;

        const { txManager } = await import("./transactionManager.js");
        const res = await txManager.modifyBalance(data.userId, -diff, "bet", `Even/Odd Bet (Round #${room.state.roundId}, Side: ${data.side})`);
        
        if (!res.success) {
          if (callback) callback({ success: false, message: res.error || "Transaction failed. Try again." });
          return;
        }
        io.to(`user_${data.userId}`).emit("syncBalance", res.newBalance);

        const result = room.placeBet(data.userId, data.username, data.amount, data.side, data.partial);
        if (callback) callback(result);
      } catch (err: any) {
        console.error("placeBet error:", err);
        if (callback) callback({ success: false, message: "Server error placing bet." });
      }
    });
  });
}
