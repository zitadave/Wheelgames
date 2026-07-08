import { supabase } from "./src/server/supabase";

async function inspectTables() {
  console.log("Listing tables...");
  const { data, error } = await supabase.from('pg_tables').select('tablename').eq('schemaname', 'public');
  // pg_tables might not be accessible via the client
  if (error) {
    console.log("Could not list tables via pg_tables. Trying another way...");
    // Try a known table
    const { data: users, error: uError } = await supabase.from('users').select('*').limit(1);
    console.log("Users columns:", users && users.length > 0 ? Object.keys(users[0]) : "No users or error: " + JSON.stringify(uError));
    
    const { data: transactions, error: tError } = await supabase.from('transactions').select('*').limit(1);
    console.log("Transactions columns:", transactions && transactions.length > 0 ? Object.keys(transactions[0]) : "No transactions or error: " + JSON.stringify(tError));

    const { data: logs, error: lError } = await supabase.from('game_logs').select('*').limit(1);
    console.log("Game_logs columns:", logs && logs.length > 0 ? Object.keys(logs[0]) : "No game_logs or error: " + JSON.stringify(lError));
  } else {
    console.log("Tables:", data.map(t => t.tablename));
  }
}

inspectTables();
