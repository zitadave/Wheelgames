import { supabase } from './dist/server.cjs';
async function run() {
  const { data: bets } = await supabase.from('bets').select('*').limit(1);
  console.log("Bets:", bets);
  const { data: rounds } = await supabase.from('rounds').select('*').limit(1);
  console.log("Rounds:", rounds);
}
run();
