const fs = require('fs');
const path = require('path');

const mgrPath = path.join(__dirname, 'src/server/announcementManager.ts');
let mgrCode = fs.readFileSync(mgrPath, 'utf8');

// Replace processAnnouncements completely
const newProcessAnnouncements = `
export function formatEmojiNumbers(nums: number[]): string {
  const emojiMap: { [key: string]: string } = {
    '0': '0️⃣', '1': '1️⃣', '2': '2️⃣', '3': '3️⃣', '4': '4️⃣',
    '5': '5️⃣', '6': '6️⃣', '7': '7️⃣', '8': '8️⃣', '9': '9️⃣'
  };
  return nums.map(n => n.toString().split('').map(digit => emojiMap[digit]).join('')).join(', ');
}

export async function processAnnouncements(bot: any) {
  const announcements = loadAnnouncements();
  const now = Date.now();
  let updated = false;

  for (const ann of announcements) {
    if (!ann.enabled) continue;

    const intervalMs = (ann.intervalHours || 24) * 3600 * 1000;
    
    // Check if it's time to run
    if (!ann.lastRunTime || (now - ann.lastRunTime) >= intervalMs) {
      logBot(\`Running announcement: \${ann.type} - \${ann.id}\`);
      
      let messageText = ann.text;
      let photo = ann.photoUrl;
      
      // Dynamic logic for specific types
      if (ann.type === "vip_slots") {
        const vipGrandSlots = formatEmojiNumbers(generateSlotNumbers(100));
        const miniVipSlots = formatEmojiNumbers(generateSlotNumbers(50));
        const fastSlots = formatEmojiNumbers(generateSlotNumbers(20));
        
        messageText = \`🎲 <b>የተቀሩ ያልተያዙ ቦታዎች (Remaining Slots)</b> 🎲\\n\\n\` +
          \`🔥 <b>ዕድል 100 ሰው ቀሪ ቁጥሮች:</b> \${vipGrandSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\\n\\n\` +
          \`💥 <b>ዕድል 50 ሰው ቀሪ ቁጥሮች:</b> \${miniVipSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\\n\\n\` +
          \`⚡ <b>ፈጣን 20 ሰው ቀሪ ቁጥሮች:</b> \${fastSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\\n\\n\` +
          \`<i>አሁኑኑ ይግቡ እና ቦታዎን ያስይዙ!</i>\`;
      } else if (ann.type === "high_withdrawal") {
        // Find recent high withdrawals > 20000
        const { data } = await supabase
          .from('transactions')
          .select('amount, created_at, users(username, first_name)')
          .eq('type', 'withdraw')
          .gte('amount', 20000)
          .order('created_at', { ascending: false })
          .limit(1);

        if (data && data.length > 0) {
          const user = data[0].users;
          const name = (user && (user.username || user.first_name)) ? (user.username || user.first_name) : 'Anonymous';
          messageText = \`💸 <b>Massive Withdrawal Alert!</b> 💸\\n\\n\` +
            \`🎉 Congratulations to <b>\${name}</b> for withdrawing <b>\${data[0].amount.toLocaleString()} ETB</b>!\\n\\n\` +
            \`🚀 Play now, win big, and get paid instantly.\\n\\n\` +
            \`<i>Real winners, real money! See the screenshot proof.</i>\`;
          photo = "https://images.unsplash.com/photo-1580519542036-ed47f3e42d1d?w=800"; // Fake receipt photo
        } else {
          // Fallback dummy
          messageText = \`💸 <b>Massive Withdrawal Alert!</b> 💸\\n\\n\` +
            \`🎉 Congratulations to <b>User_***</b> for withdrawing <b>25,000 ETB</b>!\\n\\n\` +
            \`🚀 Play now, win big, and get paid instantly.\\n\\n\` +
            \`<i>Real winners, real money! See the screenshot proof.</i>\`;
          photo = "https://images.unsplash.com/photo-1580519542036-ed47f3e42d1d?w=800";
        }
      } else if (ann.type === "high_deposit") {
        // High deposit > 50000
        messageText = \`💰 <b>Whale Deposit Alert!</b> 💰\\n\\n\` +
          \`🔥 A user just deposited <b>50,000+ ETB</b> to dominate the VIP rooms!\\n\\n\` +
          \`🏆 Are you ready to challenge them?\\n\\n\` +
          \`<i>Join the action now!</i>\`;
        photo = "https://images.unsplash.com/photo-1621416894559-258a156db743?w=800";
      } else if (ann.type === "weekly_promoter") {
        messageText = \`🏆 <b>Weekly Promoter Affiliate Winners!</b> 🏆\\n\\n\` +
          \`🥇 <b>1st Place:</b> Received <b>15,000 ETB</b>\\n\` +
          \`🥈 <b>2nd Place:</b> Received <b>8,000 ETB</b>\\n\` +
          \`🥉 <b>3rd Place:</b> Received <b>4,000 ETB</b>\\n\\n\` +
          \`🤝 <i>Start referring your friends using /referral and earn your share of the weekly jackpot!</i>\`;
        photo = "https://images.unsplash.com/photo-1579621970588-a35d0e7ab9b6?w=800"; // Trophies/Money
      } else if (ann.type === "join_play") {
        const vipGrandSlots = formatEmojiNumbers(generateSlotNumbers(100).slice(0, 5));
        const miniVipSlots = formatEmojiNumbers(generateSlotNumbers(50).slice(0, 5));
        const fastSlots = formatEmojiNumbers(generateSlotNumbers(20).slice(0, 5));

        messageText = \`🎮 <b>Scheduled Match Starting Soon!</b> 🎮\\n\\n\` +
          \`⏳ <b>Games available:</b>\\n\\n\` +
          \`🔥 <b>ዕድል 100 ሰው ቀሪ ቁጥሮች:</b> \${vipGrandSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\\n\\n\` +
          \`💥 <b>ዕድል 50 ሰው ቀሪ ቁጥሮች:</b> \${miniVipSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\\n\\n\` +
          \`⚡ <b>ፈጣን 20 ሰው ቀሪ ቁጥሮች:</b> \${fastSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\\n\\n\` +
          \`⚡ <i>Don't miss the next round! Log in to the Mini App and place your bets!</i>\`;
      }

      try {
        if (photo) {
          await bot.sendPhoto(process.env.CHANNEL_ID, photo, {
            caption: messageText,
            parse_mode: "HTML"
          });
        } else {
          await bot.sendMessage(process.env.CHANNEL_ID, messageText, { parse_mode: "HTML" });
        }
        
        ann.lastRunTime = now;
        updated = true;
      } catch (err) {
        logBot(\`Error sending announcement \${ann.id}: \${err}\`);
      }
    }
  }

  if (updated) {
    saveAnnouncements(announcements);
  }
}
`;

mgrCode = mgrCode.replace(/export async function processAnnouncements[\s\S]*?if \(updated\) {\n    saveAnnouncements\(announcements\);\n  }\n}/, newProcessAnnouncements);

fs.writeFileSync(mgrPath, mgrCode, 'utf8');
console.log("Replaced processAnnouncements in announcementManager.ts");
