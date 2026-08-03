import { supabase } from "./src/server/supabase.js";

async function run() {
  const { data, error } = await supabase.from("bot_config").select("value").eq("key", "game_settings").maybeSingle();
  if (data && data.value) {
    let settings = data.value;
    if (settings.keno) {
       settings.keno.minBet = 2;
       await supabase.from("bot_config").upsert({ key: "game_settings", value: settings }, { onConflict: "key" });
       console.log("Updated keno minBet to 2 in DB");
    }
  }
}
run();
