import { supabase } from './src/server/supabase.js';
async function test() {
  const { data } = await supabase.from('bot_config').select('value').eq('key', 'prompts_v4').maybeSingle();
  console.log(data);
}
test();
