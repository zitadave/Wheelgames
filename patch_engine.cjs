const fs = require('fs');

let code = fs.readFileSync('src/server/GameEngine.ts', 'utf8');

// Replace logTransaction handler
code = code.replace(/socket\.on\("logTransaction", async \(data: \{ userId: string, amount: number, type: string, description: string, newBalance: number \}\) => \{[\s\S]*?(?=\}\);)/, `socket.on("logTransaction", async (data: { userId: string, amount: number, type: string, description: string }) => {
      try {
        const { txManager } = await import("./transactionManager.js");
        const { supabase } = await import("./supabase.js");
        if (!supabase) return;
        
        const res = await txManager.modifyBalance(data.userId, data.amount, data.type, data.description);
        if (res.success) {
           socket.emit("syncBalance", res.newBalance);
        }

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
    `);

// Replace logGamePlay handler
code = code.replace(/socket\.on\("logGamePlay", async \(data: \{ userId: string, gameType: string, result: string, winAmount: number, newBalance: number \}\) => \{[\s\S]*?(?=\}\);)/, `socket.on("logGamePlay", async (data: { userId: string, gameType: string, result: string, winAmount: number }) => {
      try {
        const { txManager } = await import("./transactionManager.js");
        const { supabase } = await import("./supabase.js");
        if (!supabase) return;
        
        const res = await txManager.modifyBalance(data.userId, data.winAmount, "game_win", \`Win in \${data.gameType}\`);
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
    `);

fs.writeFileSync('src/server/GameEngine.ts', code);
console.log("Patched GameEngine.ts");
