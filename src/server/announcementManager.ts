import * as fs from "fs";
import * as path from "path";
import { logBot } from "./logger.js";
import { getChannelId, postToChannel, getBotUsername } from "./telegramBot.js";
import { supabase } from "./supabase.js";
import { getRemainingSlots, getGridRooms, syncFromSupabase } from "./gridState.js";

const ANNOUNCEMENT_FILE = path.join(process.cwd(), "announcements.json");

export interface Announcement {
  id: string;
  type: "static" | "promotion" | "join_play" | "event" | "guide" | "vip_slots" | "weekly_promoter" | "high_withdrawal" | "high_deposit" | "vip_slots_100" | "vip_slots_50" | "vip_slots_20" | "scheduled_match";
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
    saveAnnouncementsToSupabase(announcements).catch(e => logBot(`[ERROR] Supabase announcement sync failed: ${e}`));
  } catch (e) {
    logBot(`Failed to save announcements: ${e}`);
  }
}

async function saveAnnouncementsToSupabase(announcements: Announcement[]) {
  try {
    const jsonStr = JSON.stringify(announcements);
    await supabase.from("bot_config").upsert({ key: "announcements_v3", value: jsonStr });
    logBot("[SUPABASE] Announcements persisted to database (announcements_v3).");
  } catch (err) {
    logBot(`[SUPABASE] Failed to save announcements_v3: ${err}`);
  }
}

export async function syncAnnouncementsFromSupabase() {
  try {
    logBot("[SUPABASE] Syncing announcements from database (announcements_v3)...");
    const { data } = await supabase.from("bot_config").select("value").eq("key", "announcements_v3").maybeSingle();
    if (data?.value) {
      const anns = JSON.parse(data.value);
      fs.writeFileSync(ANNOUNCEMENT_FILE, JSON.stringify(anns, null, 2), "utf-8");
      logBot("[SUPABASE] Announcements synced and cached to disk.");
    } else {
      logBot("[SUPABASE] No announcements_v3 found in database, using local defaults.");
    }
  } catch (err) {
    logBot(`[SUPABASE] Error syncing announcements: ${err}`);
  }
}

export async function generateSlotNumbers(max: number): Promise<number[]> {
  logBot(`[generateSlotNumbers] CALLED: max=${max}`);
  
  // Ensure the latest grid state is pulled from Supabase before formatting remaining numbers list
  await syncFromSupabase();

  let roomName = "mini";
  if (max === 100) roomName = "grand";
  else if (max === 50) roomName = "mini";
  else if (max === 20) roomName = "1-20";
  else if (max === 10) roomName = "1-10";

  // Use a fresh reference to gridRooms from globalThis to ensure latest data
  const gridRooms = getGridRooms();
  const remaining = await getRemainingSlots(roomName, max, gridRooms);
  logBot(`[generateSlotNumbers] Max=${max} -> Room="${roomName}". Found ${remaining.length} slots.`);
  return remaining;
}

export function formatEmojiNumbers(nums: number[] | undefined | null, maxSlots: number): string {
  if (!nums || !Array.isArray(nums) || nums.length === 0) return "<i>ሁሉም ተይዘዋል (None available)</i>";
  
  const emojiMap: Record<string, string> = {
    "0": "0️⃣",
    "1": "1️⃣",
    "2": "2️⃣",
    "3": "3️⃣",
    "4": "4️⃣",
    "5": "5️⃣",
    "6": "6️⃣",
    "7": "7️⃣",
    "8": "8️⃣",
    "9": "9️⃣"
  };

  const formatted = nums
    .map(n => n.toString().split('').map(digit => emojiMap[digit] || digit).join(''))
    .join(', ');

  logBot(`[FormatEmoji] Formatted ${nums.length} numbers to emojis.`);
  return formatted;
}

export async function downloadAndSendPhoto(bot: any, chatId: string | number, photoUrl: string, options: any) {
  if (!photoUrl) {
    return;
  }

  const captionText = options.caption || "";
  const isCaptionTooLong = captionText.length > 1000;

  // If caption is too long, we send photo without caption and send the text message separately.
  const activeOptions = isCaptionTooLong ? { ...options, caption: "" } : options;

  const sendTextMessageIfTooLong = async () => {
    if (isCaptionTooLong) {
      logBot(`Caption too long (${captionText.length} chars). Sending message text separately.`);
      const textChunks = captionText.length > 4000 ? captionText.slice(0, 4000) + "..." : captionText;
      await bot.sendMessage(chatId, textChunks, {
        parse_mode: options.parse_mode || "HTML",
        reply_markup: options.reply_markup
      });
    }
  };

  if (!photoUrl.startsWith("http")) {
    const fullPath = path.isAbsolute(photoUrl) ? photoUrl : path.join(process.cwd(), photoUrl);
    if (fs.existsSync(fullPath)) {
      logBot(`Sending local photo file: ${fullPath} to ${chatId}`);
      try {
        await bot.sendPhoto(chatId, fs.createReadStream(fullPath), activeOptions);
        await sendTextMessageIfTooLong();
      } catch (err: any) {
        if (err.message && err.message.includes("caption is too long") && !isCaptionTooLong) {
          logBot(`Fallback: Caption too long error received. Retrying with separate text.`);
          await bot.sendPhoto(chatId, fs.createReadStream(fullPath), { ...options, caption: "" });
          await bot.sendMessage(chatId, captionText, {
            parse_mode: options.parse_mode || "HTML",
            reply_markup: options.reply_markup
          });
        } else {
          throw err;
        }
      }
    } else {
      // If it's not a URL and doesn't exist on disk, it's likely a Telegram fileId.
      // We try sending it directly to Telegram.
      logBot(`Local file not found at ${fullPath}. Attempting to send as Telegram fileId: ${photoUrl.substring(0, 20)}...`);
      try {
        await bot.sendPhoto(chatId, photoUrl, activeOptions);
        await sendTextMessageIfTooLong();
      } catch (err: any) {
        logBot(`Failed to send as fileId: ${err.message}. Falling back to sending message text only.`);
        const textOptions = {
          parse_mode: options.parse_mode || "HTML",
          reply_markup: options.reply_markup
        };
        if (captionText) {
          await bot.sendMessage(chatId, captionText, textOptions);
        }
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

    try {
      await bot.sendPhoto(chatId, buffer, activeOptions, {
        filename: "photo.jpg",
        contentType: "image/jpeg"
      });
      logBot(`Successfully sent photo as buffer to ${chatId}`);
      await sendTextMessageIfTooLong();
    } catch (err: any) {
      if (err.message && err.message.includes("caption is too long") && !isCaptionTooLong) {
        logBot(`Fallback: Caption too long error received for buffer. Retrying with separate text.`);
        await bot.sendPhoto(chatId, buffer, { ...options, caption: "" }, {
          filename: "photo.jpg",
          contentType: "image/jpeg"
        });
        await bot.sendMessage(chatId, captionText, {
          parse_mode: options.parse_mode || "HTML",
          reply_markup: options.reply_markup
        });
      } else {
        throw err;
      }
    }
  } catch (err: any) {
    logBot(`Failed to download & send photo as buffer (URL: ${photoUrl}): ${err.message}. Retrying sending directly via URL...`);
    try {
      await bot.sendPhoto(chatId, photoUrl, activeOptions);
      await sendTextMessageIfTooLong();
    } catch (directErr: any) {
      if (directErr.message && directErr.message.includes("caption is too long") && !isCaptionTooLong) {
        logBot(`Fallback: Caption too long error received for direct URL. Retrying with separate text.`);
        await bot.sendPhoto(chatId, photoUrl, { ...options, caption: "" });
        await bot.sendMessage(chatId, captionText, {
          parse_mode: options.parse_mode || "HTML",
          reply_markup: options.reply_markup
        });
      } else {
        logBot(`[downloadAndSendPhoto] ❌ ALL photo send attempts failed for ${chatId}. Sending text only as last resort.`);
        await bot.sendMessage(chatId, captionText, {
          parse_mode: options.parse_mode || "HTML",
          reply_markup: options.reply_markup
        });
      }
    }
  }
}

export function processAnnouncementText(ann: Announcement, slotsInfo: { grand: string, mini: string, fast: string }): string {
  let text = ann.text;
  
  if (ann.type === "vip_slots" || ann.type === "scheduled_match") {
    // If text is still default/placeholder or we want to force the specific format the user asked for
    if (text === "Scheduled Match placeholder" || !text.includes("{slots}")) {
      return `🎮 <b>Scheduled Match Starting Soon!</b> 🎮\n\n` +
        `⏳ <b>Games available:</b>\n\n` +
        `🔥 <b>ዕድል 100 ሰው ቀሪ ቁጥሮች:</b> ${slotsInfo.grand} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\n\n` +
        `💥 <b>ዕድል 50 ሰው ቀሪ ቁጥሮች:</b> ${slotsInfo.mini} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\n\n` +
        `⚡ <b>ፈጣን 20 ሰው ቀሪ ቁጥሮች:</b> ${slotsInfo.fast} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\n\n` +
        `⚡ <i>Don't miss the next round! Log in to the Mini App and place your bets!</i>`;
    }
    // Otherwise replace placeholders
    text = text.replace("{slots_grand}", slotsInfo.grand)
               .replace("{slots_mini}", slotsInfo.mini)
               .replace("{slots_fast}", slotsInfo.fast);
    return text;
  }

  if (ann.type === "vip_slots_100") {
    return text.replace("{slots}", slotsInfo.grand).replace("{slots_grand}", slotsInfo.grand);
  }
  if (ann.type === "vip_slots_50") {
    return text.replace("{slots}", slotsInfo.mini).replace("{slots_mini}", slotsInfo.mini);
  }
  if (ann.type === "vip_slots_20") {
    return text.replace("{slots}", slotsInfo.fast).replace("{slots_fast}", slotsInfo.fast);
  }

  return text;
}

export async function processAnnouncements(bot: any) {
  logBot(`[ProcessAnnouncements] CALLED`);
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
      
      const slotsInfo = {
        grand: formatEmojiNumbers(await generateSlotNumbers(100), 100),
        mini: formatEmojiNumbers(await generateSlotNumbers(50), 50),
        fast: formatEmojiNumbers(await generateSlotNumbers(20), 20)
      };
      
      logBot(`[ProcessAnnouncements] Generated slotsInfo for ${ann.id}: Grand=${slotsInfo.grand.substring(0, 50)}..., Mini=${slotsInfo.mini.substring(0, 50)}..., Fast=${slotsInfo.fast.substring(0, 50)}...`);

      messageText = processAnnouncementText(ann, slotsInfo);

      if (ann.type === "high_withdrawal") {
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
          
          // Use user's text if provided, otherwise default
          if (!ann.text || ann.text === "High Withdrawal placeholder") {
            messageText = `💸 <b>Massive Withdrawal Alert!</b> 💸\n\n` +
              `🎉 Congratulations to <b>${name}</b> for withdrawing <b>${data[0].amount.toLocaleString()} ETB</b>!\n\n` +
              `🚀 Play now, win big, and get paid instantly.\n\n` +
              `<i>Real winners, real money! See the screenshot proof.</i>`;
          } else {
            messageText = ann.text.replace("{name}", name).replace("{amount}", data[0].amount.toLocaleString());
          }
          
          // Use user's photo if provided, otherwise default
          if (!ann.photoUrl) {
            photo = "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=800"; // Receipt photo
          }
        } else {
          // Skip if no real high withdrawal exists yet, to avoid any mock/dummy alerts
          logBot("No actual high withdrawal records found in database. Skipping this announcement cycle.");
          continue;
        }
      } else if (ann.type === "high_deposit") {
        // High deposit > 50000
        if (!ann.text || ann.text === "High Deposit placeholder") {
          messageText = `💰 <b>Whale Deposit Alert!</b> 💰\n\n` +
            `🔥 A user just deposited <b>50,000+ ETB</b> to dominate the VIP rooms!\n\n` +
            `🏆 Are you ready to challenge them?\n\n` +
            `<i>Join the action now!</i>`;
        }
        if (!ann.photoUrl) {
          photo = "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=800";
        }
      } else if (ann.type === "weekly_promoter") {
        if (!ann.text || ann.text === "Weekly Promoter placeholder") {
          messageText = `🏆 <b>Weekly Promoter Affiliate Winners!</b> 🏆\n\n` +
            `🥇 <b>1st Place:</b> Received <b>15,000 ETB</b>\n` +
            `🥈 <b>2nd Place:</b> Received <b>8,000 ETB</b>\n` +
            `🥉 <b>3rd Place:</b> Received <b>4,000 ETB</b>\n\n` +
            `🤝 <i>Start referring your friends using /referral and earn your share of the weekly jackpot!</i>`;
        }
        if (!ann.photoUrl) {
          photo = "https://images.unsplash.com/photo-1513151233558-d860c5398176?w=800"; // Trophies/Money/Celebration
        }
      } else if (ann.type === "join_play") {
        const vipGrandSlots = formatEmojiNumbers(await generateSlotNumbers(100), 100);
        const miniVipSlots = formatEmojiNumbers(await generateSlotNumbers(50), 50);
        const fastSlots = formatEmojiNumbers(await generateSlotNumbers(20), 20);

        messageText = `🎮 <b>Scheduled Match Starting Soon!</b> 🎮\n\n` +
          `⏳ <b>Games available:</b>\n\n` +
          `🔥 <b>ዕድል 100 ሰው ቀሪ ቁጥሮች:</b> ${vipGrandSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\n\n` +
          `💥 <b>ዕድል 50 ሰው ቀሪ ቁጥሮች:</b> ${miniVipSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\n\n` +
          `⚡ <b>ፈጣን 20 ሰው ቀሪ ቁጥሮች:</b> ${fastSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\n\n` +
          `⚡ <i>Don't miss the next round! Log in to the Mini App and place your bets!</i>`;
        
        logBot(`[Scheduler] Prepared join_play message. Fast slots count: ${fastSlots.split(',').length}`);
      }

      try {
        const channelId = getChannelId();
        if (!channelId) {
          logBot(`[Scheduler] ⚠️ Skipping announcement ${ann.id}: CHANNEL_ID is not set in Environment Secrets.`);
          continue;
        }

        logBot(`[Scheduler] Sending announcement ${ann.id} to channelId: "${channelId}"`);

        const botUsername = getBotUsername() || "Wheelgames_bot";
        const messageOptions: any = { parse_mode: "HTML" };
        messageOptions.reply_markup = {
          inline_keyboard: [
            [{ text: "🎮  ቁጥር ለመያዝ ይጫኑኝ  🚀", url: `https://t.me/${botUsername}?start=play` }]
          ]
        };

        if (photo) {
          await downloadAndSendPhoto(bot, channelId, photo, {
            caption: messageText,
            parse_mode: "HTML",
            reply_markup: messageOptions.reply_markup
          });
        } else {
          await bot.sendMessage(channelId, messageText, messageOptions);
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
  
  if (process.env.NODE_ENV === "production") {
    logBot("[Scheduler] Initial processAnnouncements call");
    processAnnouncements(bot);
  } else {
    logBot("[Scheduler] Skipping initial processAnnouncements call in development to prevent channel spam");
  }

  // Check every 5 minutes
  setInterval(() => {
    processAnnouncements(bot);
  }, 5 * 60 * 1000);
}
