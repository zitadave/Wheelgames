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

  async modifyBalance(userId: string, amount: number, transactionType: string, description: string): Promise<{ success: boolean; newBalance: number; error?: string }> {
    return this.runTransaction(userId, async () => {
      try {
        // FAST PATH: Try atomic RPC if available
        if (this.useRpc) {
           const { data, error } = await supabase.rpc('modify_balance', {
               p_user_id: userId,
               p_amount: amount,
               p_tx_type: transactionType,
               p_tx_desc: description
           });
           
           if (!error && data) {
               return data as { success: boolean; newBalance: number; error?: string };
           } else if (error && error.message && error.message.includes("Could not find the function")) {
               // Fallback permanently if RPC doesn't exist
               this.useRpc = false;
               console.warn("modify_balance RPC not found. Falling back to multi-step operations. Please apply supabase-schema.sql for better performance.");
           }
        }

        // SLOW PATH: Fallback multi-step operations
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
        
        return { success: true, newBalance };
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
    /(?:ref|reference|transaction\s*id|transaction\s*number|Ref\s*No|የማመሳከሪያ\s*ቁጥር|መለያ)(?::|\s+is)?[:\s#]+([A-Z0-9.]{8,22})/i,
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
