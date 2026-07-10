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
