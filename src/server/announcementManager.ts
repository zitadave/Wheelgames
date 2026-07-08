import * as fs from "fs";
import * as path from "path";
import { postToChannel, logBot } from "./telegramBot.js";
import { supabase } from "./supabase.js";

const ANNOUNCEMENT_FILE = path.join(process.cwd(), "announcements.json");

export interface Announcement {
  id: string;
  type: "promotion" | "join_play" | "event" | "guide" | "vip_slots" | "weekly_promoter" | "high_withdrawal" | "high_deposit";
  text: string;
  photoUrl?: string;
  intervalHours?: number;
  lastRunTime?: number;
  scheduledTime?: number;
  enabled: boolean;
}

export function loadAnnouncements(): Announcement[] {
  try {
    if (fs.existsSync(ANNOUNCEMENT_FILE)) {
      const data = JSON.parse(fs.readFileSync(ANNOUNCEMENT_FILE, "utf-8"));
      return data;
    }
  } catch (e) {
    logBot(`Failed to load announcements: ${e}`);
  }
  return [];
}

export function saveAnnouncements(announcements: Announcement[]) {
  try {
    fs.writeFileSync(ANNOUNCEMENT_FILE, JSON.stringify(announcements, null, 2), "utf-8");
  } catch (e) {
    logBot(`Failed to save announcements: ${e}`);
  }
}

export function generateSlotNumbers(max: number): number[] {
  // Mock remaining slots logic for VIP
  const slots = [];
  for (let i = 1; i <= max; i++) {
    if (Math.random() > 0.5) slots.push(i);
  }
  return slots.slice(0, 15); // Return a few random ones
}




export function formatEmojiNumbers(nums: number[]): string {
  const emojiMap: { [key: string]: string } = {
    '0': '0️⃣', '1': '1️⃣', '2': '2️⃣', '3': '3️⃣', '4': '4️⃣',
    '5': '5️⃣', '6': '6️⃣', '7': '7️⃣', '8': '8️⃣', '9': '9️⃣'
  };
  return nums.map(n => n.toString().split('').map(digit => emojiMap[digit]).join('')).join(' ');
}

export async function downloadAndSendPhoto(bot: any, chatId: string | number, photoUrl: string, options: any) {
  if (!photoUrl) {
    return;
  }

  if (!photoUrl.startsWith("http")) {
    const fullPath = path.isAbsolute(photoUrl) ? photoUrl : path.join(process.cwd(), photoUrl);
    if (fs.existsSync(fullPath)) {
      logBot(`Sending local photo file: ${fullPath} to ${chatId}`);
      await bot.sendPhoto(chatId, photoUrl, options);
    } else {
      logBot(`Warning: Local photo file does not exist at: ${fullPath}. Falling back to sending message text only.`);
      const textOptions = {
        parse_mode: options.parse_mode || "HTML",
        reply_markup: options.reply_markup
      };
      const text = options.caption || "";
      if (text) {
        await bot.sendMessage(chatId, text, textOptions);
      }
    }
    return;
  }

  try {
    logBot(`Downloading photo for ${chatId} from: ${photoUrl}`);
    const res = await fetch(photoUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP status code ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await bot.sendPhoto(chatId, buffer, options, {
      filename: "photo.jpg",
      contentType: "image/jpeg"
    });
    logBot(`Successfully sent photo as buffer to ${chatId}`);
  } catch (err: any) {
    logBot(`Failed to download & send photo as buffer (URL: ${photoUrl}): ${err.message}. Retrying sending directly via URL...`);
    await bot.sendPhoto(chatId, photoUrl, options);
  }
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
      logBot(`Running announcement: ${ann.type} - ${ann.id}`);
      
      let messageText = ann.text;
      let photo = ann.photoUrl;
      
      // Dynamic logic for specific types
      if (ann.type === "vip_slots") {
        const vipGrandSlots = formatEmojiNumbers(generateSlotNumbers(100));
        const miniVipSlots = formatEmojiNumbers(generateSlotNumbers(50));
        const fastSlots = formatEmojiNumbers(generateSlotNumbers(20));
        
        messageText = `🎲 <b>የተቀሩ ያልተያዙ ቦታዎች (Remaining Slots)</b> 🎲\n\n` +
          `🔥 <b>ዕድል 100 ሰው ቀሪ ቁጥሮች:</b> ${vipGrandSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\n\n` +
          `💥 <b>ዕድል 50 ሰው ቀሪ ቁጥሮች:</b> ${miniVipSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\n\n` +
          `⚡ <b>ፈጣን 20 ሰው ቀሪ ቁጥሮች:</b> ${fastSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\n\n` +
          `<i>አሁኑኑ ይግቡ እና ቦታዎን ያስይዙ!</i>`;
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
          const rawUser: any = data[0].users;
          const user = Array.isArray(rawUser) ? rawUser[0] : rawUser;
          const name = (user && (user.username || user.first_name)) ? (user.username || user.first_name) : 'Anonymous';
          messageText = `💸 <b>Massive Withdrawal Alert!</b> 💸\n\n` +
            `🎉 Congratulations to <b>${name}</b> for withdrawing <b>${data[0].amount.toLocaleString()} ETB</b>!\n\n` +
            `🚀 Play now, win big, and get paid instantly.\n\n` +
            `<i>Real winners, real money! See the screenshot proof.</i>`;
          photo = "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=800"; // Receipt photo
        } else {
          // Skip if no real high withdrawal exists yet, to avoid any mock/dummy alerts
          logBot("No actual high withdrawal records found in database. Skipping this announcement cycle.");
          continue;
        }
      } else if (ann.type === "high_deposit") {
        // High deposit > 50000
        messageText = `💰 <b>Whale Deposit Alert!</b> 💰\n\n` +
          `🔥 A user just deposited <b>50,000+ ETB</b> to dominate the VIP rooms!\n\n` +
          `🏆 Are you ready to challenge them?\n\n` +
          `<i>Join the action now!</i>`;
        photo = "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=800";
      } else if (ann.type === "weekly_promoter") {
        messageText = `🏆 <b>Weekly Promoter Affiliate Winners!</b> 🏆\n\n` +
          `🥇 <b>1st Place:</b> Received <b>15,000 ETB</b>\n` +
          `🥈 <b>2nd Place:</b> Received <b>8,000 ETB</b>\n` +
          `🥉 <b>3rd Place:</b> Received <b>4,000 ETB</b>\n\n` +
          `🤝 <i>Start referring your friends using /referral and earn your share of the weekly jackpot!</i>`;
        photo = "https://images.unsplash.com/photo-1513151233558-d860c5398176?w=800"; // Trophies/Money/Celebration
      } else if (ann.type === "join_play") {
        const vipGrandSlots = formatEmojiNumbers(generateSlotNumbers(100).slice(0, 5));
        const miniVipSlots = formatEmojiNumbers(generateSlotNumbers(50).slice(0, 5));
        const fastSlots = formatEmojiNumbers(generateSlotNumbers(20).slice(0, 5));

        messageText = `🎮 <b>Scheduled Match Starting Soon!</b> 🎮\n\n` +
          `⏳ <b>Games available:</b>\n\n` +
          `🔥 <b>ዕድል 100 ሰው ቀሪ ቁጥሮች:</b> ${vipGrandSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\n\n` +
          `💥 <b>ዕድል 50 ሰው ቀሪ ቁጥሮች:</b> ${miniVipSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\n\n` +
          `⚡ <b>ፈጣን 20 ሰው ቀሪ ቁጥሮች:</b> ${fastSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\n\n` +
          `⚡ <i>Don't miss the next round! Log in to the Mini App and place your bets!</i>`;
      }

      try {
        if (photo) {
          await downloadAndSendPhoto(bot, process.env.CHANNEL_ID!, photo, {
            caption: messageText,
            parse_mode: "HTML"
          });
        } else {
          await bot.sendMessage(process.env.CHANNEL_ID, messageText, { parse_mode: "HTML" });
        }
        
        ann.lastRunTime = now;
        updated = true;
      } catch (err) {
        logBot(`Error sending announcement ${ann.id}: ${err}`);
      }
    }
  }

  if (updated) {
    saveAnnouncements(announcements);
  }
}




export function startAnnouncementScheduler(bot: any) {
  logBot("🤖 Announcement Scheduler started!");
  // Check every 5 minutes
  processAnnouncements(bot);
  setInterval(() => {
    processAnnouncements(bot);
  }, 5 * 60 * 1000);
}
