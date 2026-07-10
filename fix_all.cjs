const fs = require('fs');
let code = fs.readFileSync('src/server/GameEngine.ts', 'utf8');

const regex = /socket\.on\("logTransaction", async \(data: \{ userId: string, amount: number, type: string, description: string \}\) => \{[\s\S]*?console\.error\("Log tx error:", e\);\s*\}\s*\}\);/g;

const replacement = `socket.on("logTransaction", async (data: { userId: string, amount: number, type: string, description: string }) => {
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
                     description: \`Referred by \${pendingRefId}\`
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
                         description: \`Flagged for IP match with referred user \${data.userId}\`
                     });
                 }
               }
                 
               const { data: flags } = await supabase.from("transactions").select("id").eq("user_id", referrerId).eq("type", "affiliate_flag");
                 
               if (!flags || flags.length === 0) {
                 await supabase.from("transactions").insert({
                   user_id: referrerId,
                   amount: commission,
                   type: "affiliate_commission", // Separate type for manual payout
                   description: \`Referral Commission (1% of bet from \${data.userId})\`
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
    });`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/server/GameEngine.ts', code);
console.log("Fixed logTransaction");
