import { supabase } from "./supabase.js";

export function getStartOfWeekUTC(): Date {
  const now = new Date();
  const sun = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  sun.setUTCDate(sun.getUTCDate() - sun.getUTCDay());
  sun.setUTCHours(0, 0, 0, 0);
  return sun;
}

export interface LeaderboardEntry {
  referrer_id: string;
  volume: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}

export interface LeaderboardStats {
  startOfWeek: string;
  totalPlatformVolume: number;
  platformFees: number;
  promoterJackpot: number;
  leaderboard: LeaderboardEntry[];
}

export async function fetchLeaderboardData(): Promise<LeaderboardStats> {
  if (!supabase) {
    throw new Error("Supabase client not initialized.");
  }

  const startOfWeek = getStartOfWeekUTC();
  const startOfWeekISO = startOfWeek.toISOString();

  // 1. Fetch all referrals
  const { data: refs, error: refsError } = await supabase
    .from('transactions')
    .select('user_id, description')
    .eq('type', 'referral_link');

  if (refsError) {
    throw refsError;
  }

  const referrerMap = new Map<string, string>();
  if (refs) {
    refs.forEach(r => {
      if (r.description && r.description.startsWith('Referred by ')) {
        const referrerId = r.description.replace('Referred by ', '').trim();
        referrerMap.set(r.user_id, referrerId);
      }
    });
  }

  // 2. Fetch current week's transactions of type 'bet' and 'refund'
  const { data: txs, error: txError } = await supabase
    .from('transactions')
    .select('user_id, amount, type, description')
    .gte('created_at', startOfWeekISO);

  if (txError) {
    throw txError;
  }

  let totalPlatformVolume = 0;
  const userVolumeMap = new Map<string, number>();

  if (txs) {
    txs.forEach(t => {
      const amount = Number(t.amount || 0);
      const desc = t.description || '';

      const isJackpot = desc.includes('Secured Spot') && desc.includes('in Jackpot');
      const isChance120 = desc.includes('1-20 Room');
      const isJackpotRefund = desc.includes('Refund Spot');

      if (t.type === 'bet' && (isJackpot || isChance120)) {
        const betVal = Math.abs(amount);
        totalPlatformVolume += betVal;
        userVolumeMap.set(t.user_id, (userVolumeMap.get(t.user_id) || 0) + betVal);
      } else if (t.type === 'refund' && (isJackpotRefund || isChance120)) {
        const refundVal = Math.abs(amount);
        totalPlatformVolume -= refundVal;
        userVolumeMap.set(t.user_id, (userVolumeMap.get(t.user_id) || 0) - refundVal);
      }
    });
  }

  // 3. Map user volumes to referrers
  const referrerVolumeMap = new Map<string, number>();
  userVolumeMap.forEach((volume, player_id) => {
    if (volume > 0) {
      const referrerId = referrerMap.get(player_id);
      if (referrerId) {
        referrerVolumeMap.set(referrerId, (referrerVolumeMap.get(referrerId) || 0) + volume);
      }
    }
  });

  const leaderboardList: LeaderboardEntry[] = [];
  referrerVolumeMap.forEach((volume, referrer_id) => {
    leaderboardList.push({ referrer_id, volume });
  });

  leaderboardList.sort((a, b) => b.volume - a.volume);

  // 4. Load top 10 profiles
  const topReferrerIds = leaderboardList.slice(0, 10).map(l => l.referrer_id);
  if (topReferrerIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, username, first_name, last_name, photo_url')
      .in('id', topReferrerIds);

    if (users) {
      const userDetailMap = new Map<string, any>();
      users.forEach(u => userDetailMap.set(u.id, u));

      leaderboardList.forEach(l => {
        const details = userDetailMap.get(l.referrer_id);
        if (details) {
          l.username = details.username;
          l.first_name = details.first_name;
          l.last_name = details.last_name;
          l.photo_url = details.photo_url;
        }
      });
    }
  }

  const platformFees = Math.max(0, totalPlatformVolume) * 0.10;
  // Reward 5% of 50% of the platform's weekly overall retained fees, with no Guaranteed Minimum
  const promoterJackpot = platformFees * 0.50 * 0.05;
  const finalJackpot = promoterJackpot;

  return {
    startOfWeek: startOfWeekISO,
    totalPlatformVolume,
    platformFees,
    promoterJackpot: finalJackpot,
    leaderboard: leaderboardList.slice(0, 10)
  };
}

