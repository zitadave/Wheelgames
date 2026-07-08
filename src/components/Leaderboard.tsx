import React, { useState } from 'react';
import { Award, Trophy, Users, Copy, Check, Share2, RefreshCw } from 'lucide-react';

interface LeaderboardProps {
  stats: {
    startOfWeek: string;
    totalPlatformVolume: number;
    platformFees: number;
    promoterJackpot: number;
    leaderboard: any[];
  } | null;
  isLoading: boolean;
  onRefresh: () => void;
  userId: string;
  botUsername: string;
  showNotification: (msg: string, type: 'success' | 'error') => void;
}

export function Leaderboard({ stats, isLoading, onRefresh, userId, botUsername, showNotification }: LeaderboardProps) {
  const [copied, setCopied] = useState<boolean>(false);
  const referralLink = `https://t.me/${botUsername || 'ETBGameHubBot'}?start=ref_${userId}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    showNotification("Referral link copied to clipboard!", "success");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareLink = () => {
    if (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) {
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("🎮 Play and win ETB on the best Telegram Mini App games! Use my link to join and start playing!")}`;
      window.Telegram.WebApp.openTelegramLink(shareUrl);
    } else {
      handleCopyLink();
    }
  };

  const startOfWeekDate = stats ? new Date(stats.startOfWeek) : new Date();
  const dateStr = startOfWeekDate.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      
      {/* Header and explanation */}
      <div className="text-center space-y-1">
        <h2 className="text-lg font-black text-gray-900 dark:text-white flex items-center justify-center gap-2">
          <Award className="w-5 h-5 text-yellow-500" />
          <span>Weekly Leaderboard</span>
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Rankings updated in real-time based on your referred playing volume
        </p>
      </div>

      {/* Promoter Jackpot Pool Card (Visually Spectacular) */}
      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 rounded-3xl p-5 border border-indigo-500/30 text-white shadow-xl">
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl -z-10" />
        <div className="absolute -bottom-5 -left-5 w-40 h-40 bg-purple-500/10 rounded-full blur-2xl -z-10" />
        
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 bg-indigo-500/20 px-2.5 py-1 rounded-full border border-indigo-400/20">
            <Trophy className="w-3.5 h-3.5 text-yellow-400" />
            <span className="text-[9px] font-black uppercase tracking-wider text-indigo-200">Weekly Promoter Jackpot</span>
          </div>
          <button 
            onClick={onRefresh} 
            disabled={isLoading}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-white/80 active:scale-95 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="space-y-1">
          <span className="text-[10px] font-bold text-indigo-200/80">CURRENT JACKPOT POOL</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-black font-mono tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-amber-200 to-yellow-400">
              {stats ? stats.promoterJackpot.toLocaleString() : "0"}
            </span>
            <span className="text-sm font-black text-yellow-300">ETB</span>
          </div>
          <p className="text-[10px] text-indigo-200/75 leading-relaxed">
            Funded by a reward of <b>5% of 50%</b> of the platform's overall weekly fee retention with no guaranteed minimum. Only playing volume from <b>ዕድል (Jackpot)</b> and <b>ፈጣን (1-20 room)</b> contributes.
          </p>
        </div>

        {/* Prize Split Tiers */}
        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-indigo-500/20">
          <div className="text-center p-2 rounded-2xl bg-yellow-500/10 border border-yellow-500/20">
            <span className="block text-[9px] font-black text-yellow-400 uppercase">🥇 1st Place</span>
            <span className="text-xs font-black font-mono text-white mt-0.5 block">
              {stats ? Math.floor(stats.promoterJackpot * 0.50).toLocaleString() : "0"} ETB
            </span>
            <span className="text-[8px] font-semibold text-yellow-400/80">50% Share</span>
          </div>
          <div className="text-center p-2 rounded-2xl bg-slate-300/10 border border-slate-300/20">
            <span className="block text-[9px] font-black text-slate-300 uppercase">🥈 2nd Place</span>
            <span className="text-xs font-black font-mono text-white mt-0.5 block">
              {stats ? Math.floor(stats.promoterJackpot * 0.30).toLocaleString() : "0"} ETB
            </span>
            <span className="text-[8px] font-semibold text-slate-300/80">30% Share</span>
          </div>
          <div className="text-center p-2 rounded-2xl bg-amber-600/10 border border-amber-600/20">
            <span className="block text-[9px] font-black text-amber-500 uppercase">🥉 3rd Place</span>
            <span className="text-xs font-black font-mono text-white mt-0.5 block">
              {stats ? Math.floor(stats.promoterJackpot * 0.20).toLocaleString() : "0"} ETB
            </span>
            <span className="text-[8px] font-semibold text-amber-500/80">20% Share</span>
          </div>
        </div>
      </div>

      {/* Week and Platform Volume metadata */}
      <div className="flex items-center justify-between text-[10px] text-gray-400 px-1 font-mono font-bold">
        <span>WEEK COMMENCING: {dateStr} (UTC)</span>
        <span>REFERRED VOL: {stats ? stats.totalPlatformVolume.toLocaleString() : "0"} ETB</span>
      </div>

      {/* Leaderboard Entries List */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 transition-colors shadow-xs overflow-hidden flex flex-col">
        <div className="p-3 border-b border-gray-100 dark:border-gray-800/40 flex items-center justify-between bg-gray-50/50 dark:bg-gray-950/20">
          <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-400">Current Standings</h3>
          <span className="text-[9px] font-bold text-gray-400">TOP 10 REFERRERS</span>
        </div>

        {isLoading && !stats ? (
          <div className="p-8 text-center space-y-2">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-blue-500" />
            <p className="text-xs text-gray-400 font-medium">Loading standings...</p>
          </div>
        ) : !stats || stats.leaderboard.length === 0 ? (
          <div className="p-8 text-center space-y-2 text-gray-400">
            <Users className="w-8 h-8 mx-auto stroke-1 text-gray-300" />
            <p className="text-xs font-semibold">No playing volume recorded yet this week.</p>
            <p className="text-[10px] max-w-xs mx-auto text-gray-400/80 leading-normal">
              Be the first to invite friends to ዕድል (Jackpot) and ፈጣን (1-20 room) to claim the #1 spot!
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800/40">
            {stats.leaderboard.map((entry, idx) => {
              const rank = idx + 1;
              const isCurrentUser = entry.referrer_id === userId;
              const displayName = entry.first_name || entry.username || `User_${entry.referrer_id.slice(0, 6)}`;
              const displayUsername = entry.username ? `@${entry.username}` : `ID: ${entry.referrer_id.slice(0, 8)}`;

              return (
                <div 
                  key={entry.referrer_id} 
                  className={`flex items-center gap-3 p-3 transition-colors ${
                    isCurrentUser 
                      ? 'bg-blue-50/50 dark:bg-blue-900/10' 
                      : 'hover:bg-gray-50/50 dark:hover:bg-gray-950/20'
                  }`}
                >
                  {/* Rank indicator */}
                  <div className="w-6 text-center font-black text-sm">
                    {rank === 1 ? (
                      <span className="text-lg">🥇</span>
                    ) : rank === 2 ? (
                      <span className="text-lg">🥈</span>
                    ) : rank === 3 ? (
                      <span className="text-lg">🥉</span>
                    ) : (
                      <span className="text-xs font-mono text-gray-400">#{rank}</span>
                    )}
                  </div>

                  {/* Avatar */}
                  <div className="relative w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 flex items-center justify-center font-black text-xs overflow-hidden shrink-0 border border-gray-150 dark:border-gray-850">
                    {entry.photo_url ? (
                      <img src={entry.photo_url} alt="Avatar" className="w-full h-full object-cover animate-in fade-in" referrerPolicy="no-referrer" />
                    ) : (
                      displayName.charAt(0).toUpperCase()
                    )}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-extrabold text-gray-900 dark:text-white truncate">
                        {displayName}
                      </span>
                      {isCurrentUser && (
                        <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[8px] font-black px-1.5 py-0.2 rounded uppercase tracking-wider shrink-0">
                          You
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 font-bold block truncate">
                      {displayUsername}
                    </span>
                  </div>

                  {/* Volume score */}
                  <div className="text-right">
                    <span className="text-xs font-black font-mono text-gray-900 dark:text-white">
                      {entry.volume.toLocaleString()}
                    </span>
                    <span className="text-[8px] font-bold text-gray-400 block tracking-tight">ETB VOL</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Share/Promote Call to Action Card */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-200 dark:border-gray-800 transition-colors shadow-xs space-y-3">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-blue-500 shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div className="space-y-0.5">
            <h4 className="text-xs font-extrabold text-gray-900 dark:text-white">Earn Passive Income</h4>
            <p className="text-[10px] text-gray-400 leading-normal">
              You automatically earn a lifetime <b>1% commission</b> on all bets placed by your referred friends, PLUS a share of the Weekly Promoter Jackpot if you land in the top 3!
            </p>
          </div>
        </div>

        {/* Action Button Controls */}
        <div className="flex gap-2.5 pt-1">
          <button
            onClick={handleCopyLink}
            className="flex-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white text-xs font-black py-2.5 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>Copy Link</span>
          </button>
          
          <button
            onClick={handleShareLink}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black py-2.5 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Invite Friends</span>
          </button>
        </div>
      </div>

    </div>
  );
}
