const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log("No supabase keys found");
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function createIndexes() {
  const sql = `
    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions (user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_game_logs_user_id ON game_logs (user_id);
    CREATE INDEX IF NOT EXISTS idx_game_logs_created_at ON game_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rounds_room_id ON rounds (room_id);
    CREATE INDEX IF NOT EXISTS idx_rounds_created_at ON rounds (created_at DESC);
  `;
  const { data, error } = await supabase.rpc('exec_sql', { sql_string: sql });
  if (error) {
    console.error("Error creating indexes via rpc:", error.message);
    // Usually exec_sql is not available out of the box in Supabase, but we can try.
  } else {
    console.log("Indexes created successfully!");
  }
}
createIndexes();
