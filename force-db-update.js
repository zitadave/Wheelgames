import fs from 'fs';
import { supabase } from './src/server/supabase.js';

async function forceUpdate() {
  const localData = fs.readFileSync('prompts_config.json', 'utf8');
  await supabase.from("bot_config").upsert({ key: "prompts_v4", value: localData, updated_at: new Date().toISOString() });
  console.log("✅ Forced DB update to match prompts_config.json");
}
forceUpdate();
