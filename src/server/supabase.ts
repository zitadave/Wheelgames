import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

let supabaseUrl = process.env.SUPABASE_URL;
if (supabaseUrl && supabaseUrl.includes("/rest/v1")) {
  supabaseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, "");
}
// Use service role key on the backend to bypass RLS and perform admin operations
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn("Supabase credentials not found in environment variables. Database operations may fail.");
}

export const supabase = createClient(supabaseUrl || "https://placeholder.supabase.co", supabaseKey || "placeholder_key");

/**
 * Wrapper for Supabase queries to automatically retry on network failures or timeouts.
 */
export async function withRetry<T>(
  operation: () => Promise<{ data: T | null; error: any }>,
  maxRetries = 3,
  delayMs = 1000
): Promise<{ data: T | null; error: any }> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const result = await operation();
      if (result.error && (result.error.code === 'ETIMEDOUT' || result.error.code === 'ECONNRESET' || result.error.message?.includes('fetch'))) {
        throw result.error; // trigger retry
      }
      return result;
    } catch (err: any) {
      attempt++;
      if (attempt >= maxRetries) {
        return { data: null, error: err };
      }
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
  return { data: null, error: new Error('Max retries reached') };
}
