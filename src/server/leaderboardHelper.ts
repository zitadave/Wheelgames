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
  volume: number; // Keeping for compatibility, but we will use referral_count for rank
  referral_count?: number;
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
  isJackpotAnnounced: boolean;
  announcedJackpotAmount: number;
  leaderboard: LeaderboardEntry[];
}

export async function fetchLeaderboardData(jackpotAmount: number = 0): Promise<LeaderboardStats> {
  if (!supabase) {
    throw new Error("Supabase client not initialized.");
  }
  const startOfWeek = getStartOfWeekUTC();
  const startOfWeekISO = startOfWeek.toISOString();

  // 1. Fetch referrals from users table
  const { data: usersRef, error: usersError } = await supabase
    .from('users')
    .select('id, referrer_id, created_at')
    .not('referrer_id', 'is', null)
    .gte('created_at', startOfWeekISO);

  if (usersError) {
    throw usersError;
  }

  const referrerCountMap = new Map<string, number>();
  const referredUserIds = new Set<string>();

  if (usersRef) {
    usersRef.forEach(u => {
      if (u.referrer_id) {
        referrerCountMap.set(u.referrer_id, (referrerCountMap.get(u.referrer_id) || 0) + 1);
        referredUserIds.add(u.id);
      }
    });
  }

  // 2. Fetch from transactions table (referral_link) to catch those missing from users table or legacy
  const { data: txRefs } = await supabase
    .from('transactions')
    .select('user_id, description')
    .eq('type', 'referral_link')
    .gte('created_at', startOfWeekISO);

  if (txRefs) {
    txRefs.forEach(ref => {
      if (!referredUserIds.has(ref.user_id)) {
        const match = ref.description.match(/Referred by (\d+)/);
        const refId = match ? match[1] : ref.description.replace('Referred by ', '').trim();
        if (refId && refId !== ref.user_id) {
          referrerCountMap.set(refId, (referrerCountMap.get(refId) || 0) + 1);
          referredUserIds.add(ref.user_id);
        }
      }
    });
  }

  const leaderboardList: LeaderboardEntry[] = [];
  let totalWeekReferrals = 0;
  referrerCountMap.forEach((count, referrer_id) => {
    if (referrer_id !== 'system_jackpot' && referrer_id !== 'system_keno' && referrer_id !== 'bot_house') {
      leaderboardList.push({ referrer_id, volume: count, referral_count: count });
      totalWeekReferrals += count;
    }
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

  // Check if announced
  const { data: annList } = await supabase
    .from('transactions')
    .select('amount')
    .eq('type', 'jackpot_announcement')
    .eq('description', startOfWeekISO)
    .order('created_at', { ascending: false })
    .limit(1);

  const isJackpotAnnounced = annList && annList.length > 0;
  const announcedJackpotAmount = isJackpotAnnounced ? Number(annList[0].amount) : 0;

  return {
    startOfWeek: startOfWeekISO,
    totalPlatformVolume: totalWeekReferrals,
    platformFees: 0,
    promoterJackpot: jackpotAmount,
    isJackpotAnnounced,
    announcedJackpotAmount,
    leaderboard: leaderboardList.slice(0, 10)
  };
}

