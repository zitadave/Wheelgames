import fs from 'fs';

let content = fs.readFileSync('src/server/telegramBot.ts', 'utf-8');

content = content.replace(/bot\.onText\(\/\\\/affiliate\/, async \(msg\) => \{[\s\S]*?bot\.sendMessage\(chatId, msgText, \{ parse_mode: "HTML" \}\);\s*\} catch \(e: any\) \{/m,
`bot.onText(/\\/affiliate/, async (msg) => {
    await checkRegisteredAndHandle(msg, async () => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id.toString();
      if (!userId) return;
      
      try {
        // Count total referrals
        const { data: refTx } = await supabase.from('transactions')
          .select('id')
          .eq('type', 'referral_link')
          .ilike('description', \`Referred by \${userId}%\`);
        const totalReferrals = refTx ? refTx.length : 0;

        // Calculate total earnings & available balance
        const { data: earnTx } = await supabase.from('transactions')
          .select('amount, type')
          .eq('user_id', userId)
          .in('type', ['affiliate_commission', 'affiliate_withdrawal', 'reward']); // Support old reward logic
        
        let totalEarned = 0;
        let availableBalance = 0;
        if (earnTx) {
            earnTx.forEach(tx => {
                const amt = Number(tx.amount || 0);
                if (tx.type === 'affiliate_withdrawal') {
                    availableBalance -= Math.abs(amt);
                } else {
                    totalEarned += amt;
                    availableBalance += amt;
                }
            });
        }

        const msgText = \`💰 <b>Your Affiliate Dashboard</b>\\n\\n👥 <b>Total Referrals:</b> \${totalReferrals}\\n💵 <b>Total Commission Earned:</b> \${totalEarned.toLocaleString()} ETB\\n💰 <b>Available to Withdraw:</b> \${availableBalance.toLocaleString()} ETB\\n\\n<i>To request a payout or view detailed logs, open the Mini App!\\n\\nShare your referral link using /referral to earn 1% on all your friends' bets!</i>\`;
        
        bot.sendMessage(chatId, msgText, { parse_mode: "HTML" });
      } catch (e: any) {`);

fs.writeFileSync('src/server/telegramBot.ts', content);
