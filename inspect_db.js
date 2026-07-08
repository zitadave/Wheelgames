import { supabase } from "./src/server/supabase.js";

async function inspectTable() {
  const { data, error } = await supabase.from('users').select('*').limit(1);
  if (error) {
    console.error("Error fetching user:", error);
  } else if (data && data.length > 0) {
    console.log("Columns in 'users' table:", Object.keys(data[0]));
  } else {
    console.log("No data in 'users' table or table empty.");
  }
}

inspectTable();
