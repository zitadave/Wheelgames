import { supabase } from "./supabase.js";

class TransactionManager {
  private userQueues: Map<string, Promise<any>> = new Map();
  private useRpc: boolean = true; // Flag to track if RPC is available

  async runTransaction<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const previousPromise = this.userQueues.get(userId) || Promise.resolve();
    const nextPromise = previousPromise.then(fn).catch(err => {
      throw err;
    });
    this.userQueues.set(userId, nextPromise.catch(() => {}));
    return nextPromise;
  }

  private async processReferralCommission(userId: string, betAmount: number) {
    try {
        let referrerId: string | null = null;

        // 1. First, check if the user already has a bound referrer in the users table
        const { data: userData } = await supabase.from("users").select("referrer_id").eq("id", userId).single();
        if (userData?.referrer_id) {
            referrerId = userData.referrer_id;
        } else {
            // 2. If not bound, check and bind pending deep link share referral from Redis
            try {
                const { getPendingReferral, deletePendingReferral } = await import("./redisClient.js");
                const pendingRefId = await getPendingReferral(userId);
                
                if (pendingRefId && pendingRefId !== userId) {
                    referrerId = pendingRefId;
                    
                    // Bind them in the users table for permanent association
                    await supabase.from("users").update({ referrer_id: referrerId }).eq("id", userId);
                    
                    // Create a referral_link transaction for historical/ranking purposes
                    await supabase.from("transactions").insert({
                        user_id: userId,
                        amount: 0,
                        type: "referral_link",
                        description: `Referred by ${referrerId}`
                    });
                    
                    await deletePendingReferral(userId);
                }
            } catch (e: any) {
                console.error("⚠️ Failed processing pending referral deep-link:", e.message);
            }
        }
            
        if (referrerId && referrerId !== userId) {
            const commission = Math.floor(betAmount * 0.01); // 1% commission
            
            if (commission > 0) {
                // Anti-Syndicate IP Check (Optional/House rule)
                const { data: pIps } = await supabase.from("transactions").select("description").eq("user_id", userId).eq("type", "ip_log");
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
                            description: `Flagged for IP match with referred user ${userId}`
                        });
                    }
                }
                
                const { data: flags } = await supabase.from("transactions").select("id").eq("user_id", referrerId).eq("type", "affiliate_flag");
                
                if (!flags || flags.length === 0) {
                    await supabase.from("transactions").insert({
                        user_id: referrerId,
                        amount: commission,
                        type: "affiliate_commission",
                        description: `Referral Commission (1% of bet from ${userId})`
                    });
                }
            }
        }
    } catch (e: any) {
        console.error("Failed to process referral commission:", e.message);
    }
  }

  async modifyBalance(userId: string, amount: number, transactionType: string, description: string): Promise<{ success: boolean; newBalance: number; error?: string }> {
    return this.runTransaction(userId, async () => {
      try {
        let finalResult: { success: boolean; newBalance: number; error?: string } | null = null;

        // FAST PATH: Try atomic RPC if available
        if (this.useRpc) {
           const { data, error } = await supabase.rpc('modify_balance', {
               p_user_id: userId,
               p_amount: amount,
               p_tx_type: transactionType,
               p_tx_desc: description
           });
           
           if (!error && data) {
               finalResult = data as { success: boolean; newBalance: number; error?: string };
           } else if (error && error.message && error.message.includes("Could not find the function")) {
               // Fallback permanently if RPC doesn't exist
               this.useRpc = false;
               console.warn("modify_balance RPC not found. Falling back to multi-step operations. Please apply supabase-schema.sql for better performance.");
           }
        }

        // SLOW PATH: Fallback multi-step operations
        if (!finalResult) {
            const { data: user, error: fetchError } = await supabase.from("users").select("balance").eq("id", userId).single();
            if (fetchError || !user) {
              return { success: false, newBalance: 0, error: "User not found or database error." };
            }

            const newBalance = Number(user.balance) + amount;
            
            if (amount < 0 && newBalance < 0) {
                return { success: false, newBalance: Number(user.balance), error: "Insufficient balance." };
            }

            const { error: updateError } = await supabase.from("users").update({ balance: newBalance }).eq("id", userId);
            if (updateError) {
              return { success: false, newBalance: Number(user.balance), error: "Failed to update balance." };
            }

            if (amount !== 0) {
                await supabase.from("transactions").insert({
                    user_id: userId,
                    amount: amount,
                    type: transactionType,
                    description: description
                });
            }
            
            finalResult = { success: true, newBalance };
        }

        // Apply Referral Commission IF it was a successful bet
        if (finalResult.success && transactionType === "bet" && amount < 0) {
             // Run in background so it doesn't block the game
             this.processReferralCommission(userId, Math.abs(amount)).catch(e => console.error("Referral Error:", e));
        }

        return finalResult;
      } catch (e: any) {
        return { success: false, newBalance: 0, error: e.message };
      }
    });
  }
}

export const txManager = new TransactionManager();

export function parseReceiptSMS(text: string): { txId: string | null; amount: number | null } {
  if (!text) return { txId: null, amount: null };
  
  // Clean text and remove zero width spaces or carriage returns
  const cleanText = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

  // 1. Try to find a transaction ID.
  const txIdPatterns = [
    /\b(MT[A-Z0-9.]{8,22})\b/i,
    /\b(FT[A-Z0-9.]{8,22})\b/i,
    /\b(TXN[A-Z0-9.]{8,22})\b/i,
    /\b(DG[A-Z0-9.]{8,22})\b/i,
    /(?:ref|reference|transaction\s*id|transaction\s*number|Ref\s*No|የማመሳከሪያ\s*ቁጥር|መለያ|ቁጥር)(?::|\s+is)?[:\s#]*([A-Z0-9.]{8,22})/i,
    /\b([A-Z0-9]{8,22})\b/
  ];

  let txId: string | null = null;
  for (const pattern of txIdPatterns) {
    const match = cleanText.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].toUpperCase().trim();
      // Exclude some common non-ref uppercase strings in SMS
      if (!["CUSTOMER", "TELEBIRR", "PAYMENT", "ACCOUNT", "MERCHANT", "TRANSFER"].includes(candidate)) {
        txId = candidate;
        break;
      }
    }
  }

  // 2. Try to find monetary amount.
  const amountPatterns = [
    // CBE: credited with Birr 500.00
    /(?:credited\s*with|transferred|sent|received|deposited)\s*(?:birr|etb|br|ብር)?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
    // CBE/Telebirr Amharic: ብር 500.00 ገቢ ሆኗል
    /(?:ብር|ብር\s* መጠን)\s*([0-9,]+(?:\.[0-9]{2})?)/i,
    // Telebirr: You have received 500.00 Birr
    /([0-9,]+(?:\.[0-9]{2})?)\s*(?:birr|etb|br|ብር)/i,
    // CBE/Awash fallback: Ref... ETB 500.00
    /(?:etb|birr|br|ብር)[:\s]*([0-9,]+(?:\.[0-9]{2})?)/i,
    // Amharic fallback: ገቢ 500.00
    /(?:ገቢ|ተሞልቷል|ገባ)\s*(?:ብር)?\s*([0-9,]+(?:\.[0-9]{2})?)/i
  ];

  let amount: number | null = null;
  for (const pattern of amountPatterns) {
    const match = cleanText.match(pattern);
    if (match && match[1]) {
      const cleanAmt = match[1].replace(/,/g, '');
      const parsed = parseFloat(cleanAmt);
      if (!isNaN(parsed) && parsed > 0) {
        amount = parsed;
        break;
      }
    }
  }

  // If amount is still null, try general regex to find the first numeric value preceding or succeeding Birr/ETB
  if (!amount) {
    const fallbackPatterns = [
      /([0-9,]+(?:\.[0-9]{2})?)\s*(?:birr|etb|br|ብር)/i,
      /(?:birr|etb|br|ብር)\s*([0-9,]+(?:\.[0-9]{2})?)/i
    ];
    for (const pattern of fallbackPatterns) {
      const match = cleanText.match(pattern);
      if (match && match[1]) {
        const cleanAmt = match[1].replace(/,/g, '');
        const parsed = parseFloat(cleanAmt);
        if (!isNaN(parsed) && parsed > 0) {
          amount = parsed;
          break;
        }
      }
    }
  }

  return { txId, amount };
}
