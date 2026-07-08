import { supabase } from "./supabase.js";

export async function getAnalysisSummary(timeframe: 'day' | 'week' | 'month' | 'year') {
  const now = new Date();
  let startDate = new Date();
  
  if (timeframe === 'day') startDate.setDate(now.getDate() - 1);
  else if (timeframe === 'week') startDate.setDate(now.getDate() - 7);
  else if (timeframe === 'month') startDate.setMonth(now.getMonth() - 1);
  else if (timeframe === 'year') startDate.setFullYear(now.getFullYear() - 1);

  // Use withRetry if available, but for now standard fetch
  const { data: txs, error: txError } = await supabase
    .from("transactions")
    .select("amount, type, description, created_at")
    .gte("created_at", startDate.toISOString());
  
  const { data: logs, error: logError } = await supabase
    .from("game_logs")
    .select("win_amount, game_type, created_at")
    .gte("created_at", startDate.toISOString());

  if (txError || logError) {
    console.error("Analysis data fetch error:", txError || logError);
    throw new Error("Failed to fetch analysis data");
  }

  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let totalBets = 0;

  txs?.forEach(tx => {
    const amount = Number(tx.amount) || 0;
    const type = tx.type;
    const desc = tx.description || "";
    
    if (type === 'reward' && desc.includes('Deposit Approved')) {
      totalDeposits += amount;
    } else if (type === 'bet' && amount < 0) {
      if (desc.includes('Withdrawal Approved')) {
        totalWithdrawals += Math.abs(amount);
      } else {
        // Game bets
        totalBets += Math.abs(amount);
      }
    }
  });

  const gamesCount: Record<string, number> = {};
  logs?.forEach(log => {
    const gType = log.game_type || "unknown";
    gamesCount[gType] = (gamesCount[gType] || 0) + 1;
  });

  const totalWinAmount = logs?.reduce((sum, log) => sum + (Number(log.win_amount) || 0), 0) || 0;
  const ggr = totalBets - totalWinAmount;

  return {
    totalDeposits,
    totalWithdrawals,
    totalBets,
    totalWins: totalWinAmount,
    totalRevenue: totalDeposits - totalWithdrawals,
    netProfit: ggr, // GGR is the real profit from games
    gamesCount
  };
}
