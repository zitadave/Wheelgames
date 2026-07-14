import { supabase } from "./src/server/supabase.js";

async function main() {
  if (!supabase) {
    console.error("Supabase client is not initialized.");
    return;
  }
  const { data, error } = await supabase
    .from("bot_config")
    .select("*")
    .eq("key", "grid_state")
    .single();

  if (error) {
    console.error("Error fetching grid_state:", error);
  } else {
    console.log("Grid state in Supabase bot_config table:");
    console.log(JSON.stringify(data, null, 2));
  }
}

main();
