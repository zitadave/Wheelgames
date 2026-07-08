import { registerCommandHandlers } from "./bot/commands.js";
import TelegramBot from "node-telegram-bot-api";
import { supabase } from "./supabase.js";
import { getAnalysisSummary } from "./analysis.js";
import { Server } from "socket.io";
import { fetchLeaderboardData, getStartOfWeekUTC } from "./leaderboardHelper.js";
import { startAnnouncementScheduler, loadAnnouncements, saveAnnouncements, Announcement, processAnnouncements, generateSlotNumbers, formatEmojiNumbers, downloadAndSendPhoto } from "./announcementManager.js";
import * as fs from "fs";
import * as path from "path";
import { handleSupportChat } from "./aiSupport.js";

let botInfo: any = null;
let botInstance: any = null;
let globalAppUrl = "https://wheelgames1.onrender.com";

const botLogs: string[] = [];
export function logBot(msg: string) {
  const timestamp = new Date().toISOString();
  const formatted = `[${timestamp}] ${msg}`;
  console.log(formatted);
  botLogs.push(formatted);
  if (botLogs.length > 200) {
    botLogs.shift();
  }
}

export function getBotLogs() {
  return botLogs;
}

async function downloadTelegramPhotoLocally(fileId: string, annId: string): Promise<string> {
  if (!botInstance) {
    throw new Error("Telegram bot is not initialized.");
  }
  logBot(`Downloading Telegram photo for ${annId} with fileId: ${fileId}`);
  
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const fileInfo = await botInstance.getFile(fileId);
  const originalExt = fileInfo.file_path ? path.extname(fileInfo.file_path) : ".jpg";
  
  const downloadedPath = await botInstance.downloadFile(fileId, uploadsDir);
  const newFilename = `${annId}_${Date.now()}${originalExt}`;
  const destPath = path.join(uploadsDir, newFilename);
  
  fs.renameSync(downloadedPath, destPath);
  logBot(`Photo saved locally to ${destPath}`);
  return `uploads/${newFilename}`;
}

export async function postToChannel(message: string, options?: any) {
  const channelId = process.env.CHANNEL_ID;
  if (!channelId || !botInstance) {
    console.warn("CHANNEL_ID or Bot Instance not found. Cannot post to channel.");
    return;
  }
  try {
    await botInstance.sendMessage(channelId, message, {
      parse_mode: "HTML",
      ...options,
    });
  } catch (err) {
    console.error("Failed to post to channel:", err);
  }
}

function escapeHTML(str: string) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// In-memory user states
interface UserState {
  step: string;
  amount?: number;
  bank?: string;
  editingKey?: string;
  row?: number;
  col?: number;
  new_label?: string;
  cmd_name?: string;
  cmd_desc?: string;
  field?: string;
  editingPromptId?: string;
  isSupportAI?: boolean;
  aiHistory?: any;
}

const userStates = new Map<string, UserState>();
const userLanguages = new Map<number, string>();

let startDepositFlowRef: ((chatId: number, userId: string) => void) | null = null;
let startWithdrawalFlowRef: ((chatId: number, userId: string) => Promise<void>) | null = null;

function t(key: string, lang: string = 'en', params?: Record<string, string>): string {
  const translations: Record<string, Record<string, string>> = {
    'welcome_desc': {
      'en': `🎮 <b>Welcome to ETB Game Hub!</b> 🚀\n\nExperience the ultimate Telegram gaming destination! Test your prediction skills with 🟢 <b>Even/Odd</b>, enter the 🏆 <b>Jackpot Arena</b>, or spin the 🎡 <b>Wheel of Chance</b> to win incredible rewards.\n\n💎 <i>Play instantly, win with real-time multipliers, and withdraw directly to your favorite wallet!</i>`,
      'am': `🎮 <b>እንኳን ወደ ETB ጌም ሃብ በደህና መጡ!</b> 🚀\n\nበቴሌግራም ላይ ምርጥ የሆነውን የጌም ማዕከል ይለማመዱ! በ🟢 <b>Even/Odd</b> ችሎታዎን ይሞክሩ፣ ወደ 🏆 <b>Jackpot Arena</b> ይግቡ፣ ወይም 🎡 <b>Wheel of Chance</b> በማሽከርከር ትልቅ ሽልማት ያሸንፉ።\n\n💎 <i>አሁኑኑ ይጫወቱ፣ ያሸንፉ እና በቀጥታ ወደ አካውንትዎ ያውጡ!</i>`
    },
    'btn_start_play': {
      'en': "🎮 Start Play 🚀",
      'am': "🎮 ለመጫወት ጀምር 🚀"
    }
  };
  
  let text = translations[key]?.[lang] || translations[key]?.['en'] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}

interface SetAdminState {
  action: 'idle' | 'awaiting_add_userid' | 'awaiting_add_password' | 'awaiting_del_password' | 'change_pw_old_auth' | 'change_pw_new_input' | 'change_pw_confirm';
  targetUserId?: number;
  deleteTargetId?: number;
  proposedNewPassword?: string;
}
const setAdminStates = new Map<number, SetAdminState>();

interface BroadcastComposer {
  step: 'choose_target' | 'choose_template' | 'choose_type' | 'awaiting_text' | 'awaiting_photo' | 'awaiting_caption' | 'review' | 'awaiting_custom_header' | 'awaiting_custom_footer' | 'awaiting_btn_text' | 'awaiting_btn_url';
  type?: 'text' | 'photo' | 'photo_button' | 'webapp';
  target?: 'all' | 'active' | 'whales' | 'test';
  template?: 'none' | 'promo' | 'reward' | 'maintenance' | 'invite';
  customHeader?: string;
  customFooter?: string;
  textMessage?: string;
  photoFileId?: string;
  buttons?: { text: string; url: string }[];
  tempButtonText?: string;
}
const broadcastStates = new Map<number, BroadcastComposer>();

interface CampaignMessage {
  chat_id: string | number;
  message_id: number;
}

interface Campaign {
  id: string;
  timestamp: number;
  type: string;
  target: string;
  template: string;
  textSnippet: string;
  sent_messages: CampaignMessage[];
}

const CAMPAIGNS_FILE = path.join(process.cwd(), "broadcast_campaigns.json");

function loadCampaigns(): Campaign[] {
  try {
    if (fs.existsSync(CAMPAIGNS_FILE)) {
      const data = fs.readFileSync(CAMPAIGNS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    logBot(`Failed to load campaigns file: ${e}`);
  }
  return [];
}

function saveCampaign(campaign: Campaign) {
  try {
    const campaigns = loadCampaigns();
    campaigns.unshift(campaign); // Add newest at start
    if (campaigns.length > 15) {
      campaigns.pop();
    }
    fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(campaigns, null, 2), "utf-8");
  } catch (e) {
    logBot(`Failed to save campaigns file: ${e}`);
  }
}

function updateCampaignsFile(campaigns: Campaign[]) {
  try {
    fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(campaigns, null, 2), "utf-8");
  } catch (e) {
    logBot(`Failed to rewrite campaigns file: ${e}`);
  }
}

function formatMessageWithTemplate(text: string, templateType?: string, customHeader?: string, customFooter?: string): string {
  let header = "";
  let footer = "";

  if (customHeader) {
    header = `${customHeader}\n───────────────────\n\n`;
  } else if (templateType && templateType !== 'none') {
    if (templateType === 'promo') {
      header = `🔥 <b>SPECIAL PROMOTION</b> 🔥\n───────────────────\n\n`;
    } else if (templateType === 'reward') {
      header = `🎁 <b>DAILY BONUS & REWARDS</b> 🎁\n───────────────────\n\n`;
    } else if (templateType === 'maintenance') {
      header = `⚡ <b>SYSTEM UPDATE & MAINTENANCE</b> ⚡\n───────────────────\n\n`;
    } else if (templateType === 'invite') {
      header = `🎮 <b>CHALLENGE INVITATION</b> 🎮\n───────────────────\n\n`;
    }
  }

  if (customFooter) {
    footer = `\n───────────────────\n${customFooter}`;
  } else if (templateType && templateType !== 'none') {
    if (templateType === 'promo') {
      footer = `\n───────────────────\n⚡ <i>Don't miss out, join the action now!</i>`;
    } else if (templateType === 'reward') {
      footer = `\n───────────────────\n👉 <i>Claim your rewards in the app before they expire!</i>`;
    } else if (templateType === 'maintenance') {
      footer = `\n───────────────────\n🔧 <i>We're keeping things running at peak performance!</i>`;
    } else if (templateType === 'invite') {
      footer = `\n───────────────────\n🏆 <i>Show off your skills! Play and win real ETB now!</i>`;
    }
  }

  return `${header}${text}${footer}`;
}

interface RegistrationState {
  payload?: string;
}
const pendingRegistrations = new Map<string, RegistrationState>();

const PASSWORD_FILE_PATH = path.join(process.cwd(), "admin_password.json");

function getStoredPassword(): string {
  try {
    if (fs.existsSync(PASSWORD_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(PASSWORD_FILE_PATH, "utf8"));
      if (data && typeof data.password === "string" && data.password.trim() !== "") {
        return data.password;
      }
    }
  } catch (err: any) {
    logBot(`Error reading password file: ${err.message}`);
  }
  // Default fallback
  return process.env.ADMIN_PASSWORD || "AdminSecurePass777";
}

function setStoredPassword(newPassword: string) {
  try {
    fs.writeFileSync(PASSWORD_FILE_PATH, JSON.stringify({ password: newPassword }, null, 2), "utf8");
    logBot("Owner password updated in JSON storage.");
  } catch (err: any) {
    logBot(`Error writing password file: ${err.message}`);
  }
}

interface CustomButton {
  text: string;
  type: 'webapp' | 'url' | 'callback';
  value: string;
}

interface CustomCommand {
  command: string;
  description: string;
  text: string;
  photo?: string;
  buttons: CustomButton[][];
}

interface BankConfig {
  name: string;
  account: string;
  owner_name: string;
}

interface PromptsConfig {
  deposit_start_msg: string;
  deposit_success_msg: string;
  deposit_approved_msg: string;
  deposit_declined_msg: string;
  support_text: string;

  withdraw_start_msg: string;
  withdraw_telebirr_prompt: string;
  withdraw_other_bank_prompt: string;
  withdraw_success_msg: string;
  withdraw_approved_msg: string;
  withdraw_declined_msg: string;

  start_msg: string;
  balance_msg: string;
  affiliate_msg: string;

  welcome_msg: string;
  welcome_image?: string;
  welcome_guest_msg: string;
  welcome_guest_image?: string;
  support_card_msg: string;

  welcome_buttons: CustomButton[][];
  referral_msg: string;
  referral_image?: string;
  referral_share_text: string;
  referral_share_image?: string;
  referral_buttons: CustomButton[][];
  custom_commands?: {
    [cmd: string]: CustomCommand;
  };

  banks: {
    [bankId: string]: BankConfig;
  };
}

const DEFAULT_PROMPTS_CONFIG: PromptsConfig = {
  deposit_start_msg: "💰 *ማስገባት የሚፈልጉትን መጠን ከ10 ብር ጀምሮ ያስገቡ።*\n\n_(Please type the amount of ETB you want to deposit, minimum 10 ETB):_",
  deposit_success_msg: "✅ *Your deposit Request have been sent to admins please wait 1 min.*",
  deposit_approved_msg: "✅ *Your deposit of {amount} ETB is confirmed.*\n🧾 *Ref:* `{ref}`",
  deposit_declined_msg: "❌ *Your deposit of {amount} ETB is Declined.*",
  support_text: "ሚያጋጥማቹ የክፍያ ችግር:\n@wheelgamessupport\n@wheelgamesupport1 ላይ ፃፉልን።",

  withdraw_start_msg: "💰 *ማውጣት የሚፈልጉትን የገንዘብ መጠን ያስገቡ ?*\n\n💳 *የእርስዎ ባላንስ:* `{balance} ETB`\n\n_(Please type the amount you want to withdraw):_",
  withdraw_telebirr_prompt: "📱 *እባክዎን ስልክ ቁጥርን ያስገቡ:*",
  withdraw_other_bank_prompt: "🏦 *እባክዎን አካውንት ቁጥርን ያስገቡ:*",
  withdraw_success_msg: "✅ *Your withdrawal Request of {amount} ETB have been sent to admins please wait 1 min.*",
  withdraw_approved_msg: "✅ *Your withdrawal of {amount} ETB is confirmed.*\n🧾 *Ref:* `{ref}`",
  withdraw_declined_msg: "❌ *Withdrawal Declined*\n\nYour withdrawal of *{amount} Birr* was declined and refunded.",

  start_msg: "👋 *Welcome to ETB Game Hub!* 🎮\n\n_(This is the default start message, edit it in /control)_",
  balance_msg: "💳 *Your current balance:* `{balance} ETB`",
  affiliate_msg: "🤝 *Join our Affiliate Program!*\n\nInvite friends and earn commissions.",

  welcome_msg: "👋 *Welcome to ETB Game Hub, {name}!* 🎮\n\nExperience the thrill of real-time multiplayer gaming right here in Telegram!\n\n💰 *Your current balance:* `{balance}`\n\n🚀 *Available Games:*\n• 🟢 *Even/Odd* - High-octane multipliers and double-ups\n• 🏆 *Jackpot Arena* - Secure spots and sweep the pool prize\n• 🎡 *Wheel of Chance* - High stakes wheel of fortune\n\n👇 Click the button below to launch the Mini App and start playing immediately!",
  welcome_image: "",
  welcome_guest_msg: "🎮 <b>Welcome to ETB Game Hub!</b> 🚀\n\nExperience the ultimate Telegram gaming destination! Test your prediction skills with 🟢 <b>Even/Odd</b>, enter the 🏆 <b>Jackpot Arena</b>, or spin the 🎡 <b>Wheel of Chance</b> to win incredible rewards.\n\n💎 <i>Play instantly, win with real-time multipliers, and withdraw directly to your favorite wallet!</i>",
  welcome_guest_image: "",
  support_card_msg: "📞 *Contact Support*\n\n📱 *Phone:* `+251-931-50-35-59`\n📧 *Email:* `support@wheelgame.et`\n💬 *Telegram:* @scofiled1\n\n⏰ *Support Hours:*\nMonday - Sunday: 9 AM - 9 PM\n\nWe're here to help!",

  welcome_buttons: [
    [
      { text: "🎮 Play Game Hub 🚀", type: "webapp", value: "appUrl" }
    ],
    [
      { text: "💸 Deposit / ማስገቢያ", type: "callback", value: "menu_deposit" },
      { text: "🏦 Withdraw / ማውጫ", type: "callback", value: "menu_withdraw" }
    ],
    [
      { text: "📞 Contact Support", type: "callback", value: "menu_support" }
    ]
  ],
  referral_msg: "🤝 <b>Invite your friends and families!</b>\n\nShare your unique referral link and earn rewards when they join and play in the ETB Game Hub.\n\n🚀 <i>Let's grow the community together!</i>",
  referral_image: "",
  referral_share_text: "Join me on ETB Game Hub and win big!",
  referral_share_image: "",
  referral_buttons: [
    [
      { text: "📢 Share to Friends", type: "url", value: "https://t.me/share/url?url=https://t.me/{bot_username}?start=ref_{user_id}&text={referral_share_text}" }
    ]
  ],
  custom_commands: {},

  banks: {
    "Telebirr": {
      name: "📱 Telebirr",
      account: "0931503559",
      owner_name: "Tadese"
    },
    "CBE": {
      name: "🏦 CBE (የኢትዮጵያ ንግድ ባንክ)",
      account: "1000123456789",
      owner_name: "Tadese"
    },
    "Abyssinia": {
      name: "🏦 Abyssinia Bank",
      account: "987654321",
      owner_name: "Tadese"
    },
    "Dashen": {
      name: "🏦 Dashen Bank",
      account: "555444332",
      owner_name: "Tadese"
    }
  }
};

const PROMPTS_CONFIG_FILE_PATH = path.join(process.cwd(), "prompts_config.json");
let promptsConfig: PromptsConfig = { ...DEFAULT_PROMPTS_CONFIG };

function loadPromptsConfig(): PromptsConfig {
  try {
    if (fs.existsSync(PROMPTS_CONFIG_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(PROMPTS_CONFIG_FILE_PATH, "utf8"));
      return {
        ...DEFAULT_PROMPTS_CONFIG,
        ...data,
        banks: {
          ...DEFAULT_PROMPTS_CONFIG.banks,
          ...(data.banks || {})
        },
        custom_commands: {
          ...DEFAULT_PROMPTS_CONFIG.custom_commands,
          ...(data.custom_commands || {})
        }
      };
    }
  } catch (err: any) {
    logBot(`Error reading prompts config file: ${err.message}`);
  }
  return { ...DEFAULT_PROMPTS_CONFIG };
}

function savePromptsConfig(config: PromptsConfig) {
  try {
    fs.writeFileSync(PROMPTS_CONFIG_FILE_PATH, JSON.stringify(config, null, 2), "utf8");
    promptsConfig = config;
    logBot("Prompts configuration saved successfully.");
  } catch (err: any) {
    logBot(`Error writing prompts config file: ${err.message}`);
  }
}

// Load dynamic prompts config
promptsConfig = loadPromptsConfig();

// In-memory pending requests store
interface PendingRequest {
  id: string;
  type: 'deposit' | 'withdraw';
  userId: string;
  username: string;
  fullName: string;
  amount: number;
  bank?: string;
  account?: string;
  receiptText?: string;
  chatId: number;
}

const pendingRequests = new Map<string, PendingRequest>();

// Dynamic Owner configurations to prevent Access Denied for testers
const OWNER_IDS = new Set<number>([336997351]);

function isOwner(userId: number | undefined): boolean {
  if (!userId) return false;
  return OWNER_IDS.has(userId);
}

function isStartingAdmin(userId: number | undefined): boolean {
  if (!userId) return false;
  return userId === getPrimaryOwnerId();
}

function getPrimaryOwnerId(): number {
  return 336997351; // Restricted Starting Admin ID
}

// Admin Chat IDs (Initialized with all owners/starting admins)
const adminChatIds = new Set<number>(OWNER_IDS);

// Initialize Admin IDs from environment variables if present
const adminEnv = process.env.TELEGRAM_ADMIN_IDS;
if (adminEnv) {
  adminEnv.split(',').forEach(id => {
    const trimmed = id.trim();
    if (trimmed) {
      const parsed = parseInt(trimmed, 10);
      if (!isNaN(parsed) && parsed > 0) {
        adminChatIds.add(parsed);
      }
    }
  });
}

// Function to sync admins with Supabase
async function syncAdminsFromDB() {
  try {
    const { data: adminUsers, error } = await supabase
      .from('users')
      .select('id')
      .eq('is_admin', true);
    
    if (error) {
      if (!error.message.includes('schema cache')) {
        logBot(`Error fetching admins from DB: ${error.message}`);
      }
      return;
    }

    if (adminUsers) {
      adminUsers.forEach(u => {
        const id = parseInt(u.id, 10);
        if (!isNaN(id)) adminChatIds.add(id);
      });
    }

    // Ensure all in-memory admins are synced back to DB
    for (const adminId of adminChatIds) {
      await supabase.from('users').update({ is_admin: true }).eq('id', adminId.toString()).then(({ error }) => {
        if (error && !error.message.includes('schema cache')) logBot(`Error syncing admin ${adminId}: ${error.message}`);
      });
    }
  } catch (err: any) {
    logBot(`syncAdminsFromDB error: ${err.message}`);
  }
}

// Generate unique Ref Codes (e.g., C8OM3PUXUX, OTY2A7PFR2)
function generateRef(length = 10): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function initTelegramBot(io: Server): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not found. Telegram bot is disabled.");
    return null;
  }

  if (botInstance) {
    console.log("Telegram Bot already initialized. Returning existing instance.");
    return botInfo?.username || null;
  }

  globalAppUrl = "https://wheelgames1.onrender.com";
  // Make sure we strip any trailing slash
  globalAppUrl = globalAppUrl.replace(/\/$/, "");
  const appUrl = globalAppUrl;
  
  logBot(`Bot initializing with APP_URL: ${globalAppUrl}`);
  
  const TelegramBotClass = typeof TelegramBot === "function" 
    ? TelegramBot 
    : ((TelegramBot as any).default || TelegramBot);
  
  const bot = new (TelegramBotClass as any)(token, { 
    polling: {
      interval: 300,
      autoStart: true,
      params: {
        timeout: 10
      }
    }
  });
  botInstance = bot;

  bot.on("polling_error", (error: any) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
      console.warn("Polling conflict detected. Another instance is likely running.");
    } else if (error.code === 'EFATAL' || error.message?.includes('fetch failed')) {
      // These are often transient network issues, log as warning to reduce noise
      console.warn("Telegram Polling: Transient fetch failure (EFATAL). Retrying...");
    } else {
      console.error("Polling error:", error.message || error);
    }
  });

  bot.on("error", (error: any) => {
    console.error("General Bot Error:", error.message || error);
  });

  try {
    botInfo = await bot.getMe();
    logBot(`Telegram Bot @${botInfo.username} initialized.`);
  } catch (err: any) {
    logBot(`Failed to fetch Bot details: ${err.message || err}`);
  }

  syncAdminsFromDB().catch(err => {
    logBot(`Error in syncAdminsFromDB background execution: ${err.message || err}`);
  });

  // --- TELEGRAM SEO & DISCOVERY OPTIMIZATIONS (Asynchronous/Non-blocking) ---
  Promise.resolve().then(async () => {
      try {
        // 1. Set Bot Name containing Amharic and English high-volume search keywords
        try {
          await (bot as any).setMyName({ name: "ዲጂታል ዕጣ | Digital Eta Game Hub" });
          logBot("SEO: Bot display name optimized for Search.");
        } catch (e: any) {
          logBot(`Could not set bot name via setMyName wrapper, trying request method: ${e.message}`);
          try {
            await (bot as any)._request('setMyName', { name: "ዲጂታል ዕጣ | Digital Eta Game Hub" });
          } catch (innerE) {}
        }

        // 2. Set Bot Description (Max 512 chars) with localized keywords (Amharic & English)
        const seoDescription = 
          "እንኳን ወደ ዲጂታል ዕጣ (Digital Eta Game Hub) በደህና መጡ! 🎰 የኢትዮጵያ ቀዳሚ የቴሌግራም መጫወቻ ፕላትፎርም በቴሌብር። በቅጽበት ይጫወቱ፣ ያሸንፉ እና ገንዘብዎን ያውጡ።\n\n" +
          "Welcome to Digital Eta Game Hub! 🎰 Ethiopia's premier Telegram gaming platform with Telebirr. Play, win, and cash out instantly. Enjoy Even/Odd, Jackpot, and Wheel games!";
        try {
          await (bot as any).setMyDescription({ description: seoDescription });
          logBot("SEO: Bot description optimized for Search.");
        } catch (e: any) {
          logBot(`Could not set bot description, trying request method: ${e.message}`);
          try {
            await (bot as any)._request('setMyDescription', { description: seoDescription });
          } catch (innerE) {}
        }

        // 3. Set Bot Short Description (Max 120 chars)
        const seoShortDescription = "ዲጂታል ዕጣ (Digital Eta) - ምርጥ የኢትዮጵያ የቴሌግራም መጫወቻ ፕላትፎርም በቴሌብር (Telebirr)።";
        try {
          await (bot as any).setMyShortDescription({ short_description: seoShortDescription });
          logBot("SEO: Bot short description optimized.");
        } catch (e: any) {
          logBot(`Could not set bot short description, trying request method: ${e.message}`);
          try {
            await (bot as any)._request('setMyShortDescription', { short_description: seoShortDescription });
          } catch (innerE) {}
        }

        // 4. Set Channel Title & Description (if CHANNEL_ID is configured and bot is admin)
        const channelId = process.env.CHANNEL_ID;
        if (channelId) {
          try {
            await bot.setChatTitle(channelId, "ዲጂታል ዕጣ | Digital Eta - Official Channel");
            logBot("SEO: Channel title optimized.");
          } catch (e: any) {
            logBot(`Could not set channel title programmatically: ${e.message}`);
          }

          try {
            const channelSeoDesc = 
              "እንኳን ወደ ዲጂታል ዕጣ (Digital Eta) ይፋዊ ቻናል በደህና መጡ! 🎰 የኢትዮጵያ ቀዳሚ የቴሌግራም መጫወቻ ፕላትፎርም በቴሌብር። በቅጽበት ይጫወቱ፣ ያሸንፉ እና ተሸላሚ ይሁኑ! @scofiled1\n\n" +
              "Welcome to Digital Eta Official Channel! 🎰 Ethiopia's premier Telegram gaming platform with Telebirr. Play, win, and cash out instantly. Join Even/Odd, Jackpot, and Wheel of Chance!";
            await bot.setChatDescription(channelId, channelSeoDesc);
            logBot("SEO: Channel description optimized.");
          } catch (e: any) {
            logBot(`Could not set channel description programmatically: ${e.message}`);
          }
        }
      } catch (seoErr: any) {
        logBot(`Couldn't apply Telegram SEO settings: ${seoErr.message || seoErr}`);
      }

      // Set bot commands including custom dynamic ones
      const systemCommands = [
        { command: "start", description: "Launch the game hub and display menu" },
        { command: "play", description: "Launch the Web App immediately" },
        { command: "balance", description: "Check your current wallet balance" },
        { command: "deposit", description: "Deposit ETB into your balance" },
        { command: "withdraw", description: "Withdraw ETB from your balance" },
        { command: "referral", description: "Invite friends and earn rewards" },
        { command: "affiliate", description: "View your affiliate dashboard and earnings" },
        { command: "promoter_leaderboard", description: "View Weekly Promoter Leaderboard" },
        { command: "support", description: "Show contact support details" },
        { command: "language", description: "Change bot language" },
        { command: "cancel", description: "Cancel current operation or active flows" }
      ];

      const customCommandsList = Object.entries(promptsConfig.custom_commands || {}).map(([cmd, cfg]) => ({
        command: cmd,
        description: cfg.description || "Custom command"
      }));

      try {
        await bot.setMyCommands([...systemCommands, ...customCommandsList]);
        logBot("Bot commands updated successfully.");
      } catch (cmdErr: any) {
        logBot(`Error setting bot commands: ${cmdErr.message}`);
      }

      // Update main bot menu button to open the Web App
      try {
        await (bot as any).setChatMenuButton({
          menu_button: {
            type: "web_app",
            text: "Play Game 🎮",
            web_app: { url: appUrl }
          }
        });
        logBot("Telegram Bot menu button configured.");
      } catch (btnErr: any) {
        logBot(`Couldn't set Telegram WebApp menu button: ${btnErr.message || btnErr}`);
      }
    }).catch((err: any) => {
      logBot(`Failed to fetch Bot details or setup commands in background: ${err.message || err}`);
    });

  // --- HELPERS FOR FLOW START ---
  const handleSupabaseError = (chatId: number, error: any): boolean => {
    if (!error) return false;
    const errMsg = error.message || String(error);
    if (errMsg.includes("Could not find the table") || errMsg.includes("relation \"users\" does not exist") || errMsg.includes("relation \"public.users\" does not exist")) {
      const errorMsg = `⚠️ *Database Setup Required* ⚠️\n\n` +
        `Your Supabase project is connected, but the required database tables have not been created yet!\n\n` +
        `👉 *How to fix this in 30 seconds:*\n` +
        `1️⃣ In your AI Studio Code Editor, open the file named *supabase-schema.sql* (located in the root folder).\n` +
        `2️⃣ Copy the entire content (the SQL statements) of that file.\n` +
        `3️⃣ Open your *Supabase Dashboard*.\n` +
        `4️⃣ Navigate to the *SQL Editor* tab on the left sidebar.\n` +
        `5️⃣ Click *New Query*, paste the SQL code, and click *Run*.\n\n` +
        `Once executed, your game and bot will instantly work with full database persistence! 🚀`;
      bot.sendMessage(chatId, errorMsg, { parse_mode: "Markdown" });
      return true;
    }
    return false;
  };

  const getOrCreateUser = async (userId: string, username: string, firstName?: string, lastName?: string): Promise<{ balance: number } | null> => {
    try {
      const { data, error } = await supabase.from('users').select('balance').eq('id', userId);
      if (error) {
        logBot(`supabase error fetching user ID=${userId}: ${error.message}`);
        return null;
      }
      if (data && data.length > 0) {
        return { balance: Number(data[0].balance) };
      }

      logBot(`User ID=${userId} not found. Creating user in database...`);
      const { data: insertedData, error: insertError } = await supabase
        .from('users')
        .insert({
          id: userId,
          username: username || null,
          first_name: firstName || null,
          last_name: lastName || null,
          balance: 100000
        })
        .select('balance')
        .single();

      if (insertError) {
        logBot(`Error inserting user ID=${userId}: ${insertError.message}`);
        return { balance: 100000 };
      }
      return { balance: insertedData ? Number(insertedData.balance) : 100000 };
    } catch (e: any) {
      logBot(`Unexpected error in getOrCreateUser for ID=${userId}: ${e?.message || e}`);
      return { balance: 100000 };
    }
  };

  const startDepositFlow = (chatId: number, userId: string) => {
    logBot(`startDepositFlow triggered for userId=${userId}, chatId=${chatId}`);
    try {
      userStates.set(userId, { step: 'deposit_amount' });
      bot.sendMessage(chatId, promptsConfig.deposit_start_msg, { parse_mode: "Markdown" });
      logBot(`startDepositFlow message sent successfully to chatId=${chatId}`);
    } catch (e: any) {
      logBot(`Error in startDepositFlow for userId=${userId}: ${e?.message || e}`);
    }
  };

  const startWithdrawalFlow = async (chatId: number, userId: string) => {
    logBot(`startWithdrawalFlow triggered for userId=${userId}, chatId=${chatId}`);
    try {
      // Fetch user's current balance safely using getOrCreateUser helper
      const user = await getOrCreateUser(userId, "");
      const currentBalance = user ? Number(user.balance) : 0;
      logBot(`userId=${userId} current balance is ${currentBalance}`);

      if (currentBalance < 100) {
        return bot.sendMessage(chatId, `❌ *ያለዎት ቀሪ ሂሳብ በቂ አይደለም!* ለመውጣት ቢያንስ 100 ብር ያስፈልጋል።\n\n💳 *የእርስዎ ባላንስ:* ${currentBalance.toLocaleString()} ETB\n_(Minimum withdrawal is 100 ETB)_`, { parse_mode: "Markdown" });
      }

      userStates.set(userId, { step: 'withdraw_amount' });
      const rawMsg = promptsConfig.withdraw_start_msg;
      const msgText = rawMsg.replace(/{balance}/g, currentBalance.toLocaleString());
      bot.sendMessage(chatId, msgText, { parse_mode: "Markdown" });
      logBot(`startWithdrawalFlow message sent successfully to chatId=${chatId}`);
    } catch (e: any) {
      logBot(`Error in startWithdrawalFlow for userId=${userId}: ${e?.message || e}`);
      bot.sendMessage(chatId, "⚠️ An error occurred preparing your withdrawal. Please try again.");
    }
  };

  startDepositFlowRef = startDepositFlow;
  startWithdrawalFlowRef = startWithdrawalFlow;

  const sendSupportCard = (chatId: number) => {
    logBot(`sendSupportCard triggered for chatId=${chatId}`);
    try {
      const supportCard = promptsConfig.support_card_msg || 
        `📞 <b>Contact Support</b>\n\n` +
        `📱 <b>Phone:</b> <code>+251-931-50-35-59</code>\n` +
        `📧 <b>Email:</b> <code>support@wheelgame.et</code>\n` +
        `💬 <b>Telegram:</b> @scofiled1\n\n` +
        `⏰ <b>Support Hours:</b>\n` +
        `Monday - Sunday: 9 AM - 9 PM\n\n` +
        `We're here to help!`;

      bot.sendMessage(chatId, supportCard, { parse_mode: "HTML" });
      logBot(`sendSupportCard message sent successfully to chatId=${chatId}`);
    } catch (e: any) {
      logBot(`Error in sendSupportCard: ${e?.message || e}`);
    }
  };

  const checkRegisteredAndHandle = async (msg: any, onRegistered: () => void | Promise<void>) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id?.toString();
    if (!userId) return;

    try {
      const { data, error } = await supabase.from('users').select('id').eq('id', userId);
      if (data && data.length > 0) {
        await onRegistered();
      } else {
        const lang = userLanguages.get(parseInt(userId)) || 'en';
        pendingRegistrations.set(userId, { payload: "" });
        const desc = t('welcome_desc', lang);

        bot.sendMessage(chatId, desc, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: t('btn_start_play', lang), callback_data: "register_start" }
              ]
            ]
          }
        });
      }
    } catch (e: any) {
      logBot(`Error checking registration: ${e.message}`);
      await onRegistered();
    }
  };

  registerCommandHandlers(bot, logBot, checkRegisteredAndHandle, sendSupportCard, userStates);

  // --- BOT COMMANDS HANDLERS ---
  
  // Start Command
  bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    const firstName = msg.from?.first_name || "Player";
    const payload = match ? match[1] : '';

    if (!userId) return;

    let isRegistered = false;
    try {
      const { data, error } = await supabase.from('users').select('id').eq('id', userId);
      if (data && data.length > 0) {
        isRegistered = true;
      }
    } catch (e) {
      logBot(`Error checking registration: ${e}`);
    }

    if (isRegistered) {
      if (payload === 'deposit') {
        return startDepositFlow(chatId, userId);
      } else if (payload === 'withdraw') {
        return startWithdrawalFlow(chatId, userId);
      }

      // Default main menu greeting
      let userBalanceStr = "100,000 ETB (Demo)";
      try {
        const { data } = await supabase.from('users').select('balance').eq('id', userId);
        if (data && data.length > 0) {
          userBalanceStr = `${Number(data[0].balance).toLocaleString()} ETB`;
        }
      } catch (e) {
        // Ignored
      }

      const welcomeMsgPattern = promptsConfig.welcome_msg || 
        `👋 *Welcome to ETB Game Hub, {name}!* 🎮\n\n` +
        `Experience the thrill of real-time multiplayer gaming right here in Telegram!\n\n` +
        `💰 *Your current balance:* \`{balance}\`\n\n` +
        `🚀 *Available Games:*\n` +
        `• 🟢 *Even/Odd* - High-octane multipliers and double-ups\n` +
        `• 🏆 *Jackpot Arena* - Secure spots and sweep the pool prize\n` +
        `• 🎡 *Wheel of Chance* - High stakes wheel of fortune\n\n` +
        `👇 Click the button below to launch the Mini App and start playing immediately!`;
        
      const welcomeMsg = welcomeMsgPattern
        .replace(/{name}/g, firstName)
        .replace(/{balance}/g, userBalanceStr);

      const welcomeButtonsRows = (promptsConfig.welcome_buttons || [
        [
          { text: "🎮 Play Game Hub 🚀", type: "webapp", value: "appUrl" }
        ],
        [
          { text: "💸 Deposit / ማስገቢያ", type: "callback", value: "menu_deposit" },
          { text: "🏦 Withdraw / ማውጫ", type: "callback", value: "menu_withdraw" }
        ],
        [
          { text: "📞 Contact Support", type: "callback", value: "menu_support" }
        ]
      ]).map(row => 
        row.map(btn => {
          const btnVal = btn.value === 'appUrl' ? appUrl : btn.value;
          if (btn.type === 'webapp') {
            return { text: btn.text, web_app: { url: btnVal } };
          } else if (btn.type === 'url') {
            return { text: btn.text, url: btnVal };
          } else {
            return { text: btn.text, callback_data: btnVal };
          }
        })
      );

      const options = {
        parse_mode: "Markdown" as const,
        reply_markup: {
          inline_keyboard: welcomeButtonsRows
        }
      };

      if (promptsConfig.welcome_image) {
        bot.sendPhoto(chatId, promptsConfig.welcome_image, {
          caption: welcomeMsg,
          parse_mode: "Markdown",
          reply_markup: options.reply_markup
        }).catch(() => bot.sendMessage(chatId, welcomeMsg, options));
      } else {
        bot.sendMessage(chatId, welcomeMsg, options);
      }
    } else {
      pendingRegistrations.set(userId, { payload });

      const desc = promptsConfig.welcome_guest_msg || `🎮 <b>Welcome to ETB Game Hub!</b> 🚀\n\n` +
        `Experience the ultimate Telegram gaming destination! Test your prediction skills with 🟢 <b>Even/Odd</b>, enter the 🏆 <b>Jackpot Arena</b>, or spin the 🎡 <b>Wheel of Chance</b> to win incredible rewards.\n\n` +
        `💎 <i>Play instantly, win with real-time multipliers, and withdraw directly to your favorite wallet!</i>`;

      const options = {
        parse_mode: "HTML" as const,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🎮 Start Play / ለመጫወት ጀምር 🚀", callback_data: "register_start" }
            ]
          ]
        }
      };

      if (promptsConfig.welcome_guest_image) {
        bot.sendPhoto(chatId, promptsConfig.welcome_guest_image, {
          caption: desc,
          parse_mode: "HTML",
          reply_markup: options.reply_markup
        }).catch(() => bot.sendMessage(chatId, desc, options));
      } else {
        bot.sendMessage(chatId, desc, options);
      }
    }
  });

  // Play Command
  bot.onText(/\/play/, async (msg) => {
    await checkRegisteredAndHandle(msg, () => {
      const chatId = msg.chat.id;
      bot.sendMessage(chatId, "🎮 *ETB Game Hub is ready!* Press the button below to launch the Mini App:", {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🚀 Launch Game",
                web_app: { url: appUrl }
              }
            ]
          ]
        }
      });
    });
  });

  // Quick Command triggers for Deposits and Withdrawals
  bot.onText(/\/deposit/, async (msg) => {
    await checkRegisteredAndHandle(msg, () => {
      if (msg.from?.id) startDepositFlow(msg.chat.id, msg.from.id.toString());
    });
  });

  bot.onText(/\/withdraw/, async (msg) => {
    await checkRegisteredAndHandle(msg, () => {
      if (msg.from?.id) startWithdrawalFlow(msg.chat.id, msg.from.id.toString());
    });
  });

  bot.onText(/\/referral/, async (msg) => {
    await checkRegisteredAndHandle(msg, () => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id.toString();
      if (!userId) return;

      const botUsername = botInfo?.username || "ETBGameHubBot";
      const referralShareText = encodeURIComponent(promptsConfig.referral_share_text || "Join me on ETB Game Hub and win big!");
      
      const referralMsg = (promptsConfig.referral_msg || "🤝 <b>Invite your friends and families!</b>")
        .replace(/{user_id}/g, userId)
        .replace(/{bot_username}/g, botUsername)
        .replace(/{referral_share_text}/g, promptsConfig.referral_share_text);

      const buttons = (promptsConfig.referral_buttons || []).map(row =>
        row.map(btn => {
          const btnVal = btn.value
            .replace(/{user_id}/g, userId)
            .replace(/{bot_username}/g, botUsername)
            .replace(/{referral_share_text}/g, referralShareText);
          return { text: btn.text, url: btnVal };
        })
      );

      const options = {
        parse_mode: "HTML" as const,
        reply_markup: {
          inline_keyboard: buttons
        }
      };

      if (promptsConfig.referral_image) {
        bot.sendPhoto(chatId, promptsConfig.referral_image, {
          caption: referralMsg,
          ...options
        }).catch(() => bot.sendMessage(chatId, referralMsg, options));
      } else {
        bot.sendMessage(chatId, referralMsg, options);
      }
    });
  });

  bot.onText(/\/affiliate/, async (msg) => {
    await checkRegisteredAndHandle(msg, async () => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id.toString();
      if (!userId) return;
      
      try {
        // Count total referrals
        const { data: refTx } = await supabase.from('transactions')
          .select('id')
          .eq('type', 'referral_link')
          .ilike('description', `Referred by ${userId}%`);
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

        const msgText = `💰 <b>Your Affiliate Dashboard</b>\n\n👥 <b>Total Referrals:</b> ${totalReferrals}\n💵 <b>Total Commission Earned:</b> ${totalEarned.toLocaleString()} ETB\n💰 <b>Available to Withdraw:</b> ${availableBalance.toLocaleString()} ETB\n\n<i>To request a payout or view detailed logs, open the Mini App!\n\nShare your referral link using /referral to earn 1% on all your friends' bets!</i>`;
        
        bot.sendMessage(chatId, msgText, { parse_mode: "HTML" });
      } catch (e: any) {
        logBot(`Error in affiliate stats: ${e.message}`);
        bot.sendMessage(chatId, `❌ <b>Error loading affiliate stats:</b> ${e.message}\n\n<i>Please make sure your database is fully set up and connected!</i>`, { parse_mode: "HTML" });
      }
    });
  });

  bot.onText(/\/balance/, async (msg) => {
    await checkRegisteredAndHandle(msg, async () => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id?.toString();
      if (!userId) return;

      try {
        const { data, error } = await supabase.from('users').select('balance').eq('id', userId).single();
        if (error) {
          bot.sendMessage(chatId, "⚠️ *Error retrieving balance.*", { parse_mode: "Markdown" });
          return;
        }

        const balanceVal = data ? Number(data.balance) : 0;
        const msgText = `💵 *Your Current Balance / የሂሳብዎ መጠን:*\n\n` +
          `💰 *${balanceVal.toLocaleString()} ETB*\n\n` +
          `🎮 _Play inside the web app and keep winning!_`;

        bot.sendMessage(chatId, msgText, { parse_mode: "Markdown" });
      } catch (err: any) {
        logBot(`Error in /balance handler: ${err.message}`);
        bot.sendMessage(chatId, "⚠️ *Error retrieving balance.*", { parse_mode: "Markdown" });
      }
    });
  });

  bot.onText(/\/promoter_leaderboard/, async (msg) => {
    await checkRegisteredAndHandle(msg, async () => {
      const chatId = msg.chat.id;
      try {
        const stats = await fetchLeaderboardData();
        const dateStr = new Date(stats.startOfWeek).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
        
        let text = `🏆 <b>Weekly Promoter Leaderboard</b>\n\n`;
        text += `📅 <b>Week of:</b> <code>${dateStr}</code> (Sunday UTC)\n`;
        text += `💰 <b>Weekly Promoter Jackpot:</b> <b>${stats.promoterJackpot.toLocaleString()} ETB</b>\n`;
        text += `<i>Funded by 10% of the platform's retained fees from Jackpot and Chance 1-20 rooms this week!</i>\n\n`;
        
        text += `👥 <b>Top 10 Active Promoters:</b>\n`;
        if (stats.leaderboard && stats.leaderboard.length > 0) {
            stats.leaderboard.forEach((entry, idx) => {
                const name = entry.first_name || entry.username || `User ${entry.referrer_id.slice(0, 6)}`;
                const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "•";
                
                // Estimate split for top 3
                let estText = "";
                if (idx === 0) estText = ` (Est: <b>${Math.floor(stats.promoterJackpot * 0.50).toLocaleString()} ETB</b>)`;
                if (idx === 1) estText = ` (Est: <b>${Math.floor(stats.promoterJackpot * 0.30).toLocaleString()} ETB</b>)`;
                if (idx === 2) estText = ` (Est: <b>${Math.floor(stats.promoterJackpot * 0.20).toLocaleString()} ETB</b>)`;
                
                text += `${medal} <b>${name}</b> | Vol: <code>${entry.volume.toLocaleString()} ETB</code>${estText}\n`;
            });
        } else {
            text += `<i>No referred playing volume yet for this week. Be the first to claim a spot!</i>\n`;
        }
        
        text += `\n📢 <i>Share your referral link using /referral to invite friends. The more they bet in ዕድል (Jackpot) and ፈጣን (1-20) rooms, the higher your volume and share of the weekly jackpot!</i>`;
        
        bot.sendMessage(chatId, text, { parse_mode: "HTML" });
      } catch (e: any) {
        logBot(`Error displaying promoter leaderboard: ${e.message}`);
        bot.sendMessage(chatId, `❌ Error loading leaderboard: ${e.message}`);
      }
    });
  });

  // Cancel flow command
  bot.onText(/\/cancel/, (msg) => {
    const userId = msg.from?.id;
    if (userId) {
      if (isStartingAdmin(userId)) {
        setAdminStates.delete(userId);
      }
      if (isStartingAdmin(userId)) {
        broadcastStates.delete(userId);
      }
      userStates.set(userId.toString(), { step: 'idle' });
      bot.sendMessage(msg.chat.id, "✅ <b>All active flows and setups have been canceled.</b>", { parse_mode: "HTML" });
    }
  });

  // Owner Admin Management control panel
  async function renderSetAdminMenu(bot: any, chatId: number) {
    bot.sendMessage(chatId, `👑 <b>Admin Control Panel</b>\n\nSelect an operation to manage administrator privileges:`, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "➕ Add Admin", callback_data: "setadmin_add_start" },
            { text: "➖ Delete Admin", callback_data: "setadmin_del_start" }
          ],
          [
            { text: "🔒 Change Password", callback_data: "setadmin_change_pw_start" },
            { text: "❌ Cancel", callback_data: "setadmin_cancel" }
          ]
        ]
      }
    });
  }

  
  bot.onText(/\/list_of_recent_announcement/, (msg) => { bot.sendMessage(msg.chat.id, "Please use /announcement instead."); });
  bot.onText(/\/list_of_recent_announcement/, (msg) => {
    const chatId = msg.chat.id;
    if (!isStartingAdmin(msg.from?.id)) {
      return bot.sendMessage(chatId, "❌ Access Denied.");
    }
    const anns = loadAnnouncements();
    if (anns.length === 0) {
      return bot.sendMessage(chatId, "📋 Recent Announcements:\n\nNo announcements found.");
    }
    let text = "📢 <b>Recent Announcements:</b>\n\n";
    anns.forEach(a => {
      text += "<b>ID:</b> <code>" + a.id + "</code>\n<b>Type:</b> " + a.type + "\n<b>Interval (hrs):</b> " + a.intervalHours + "\n<b>Enabled:</b> " + a.enabled + "\n\n";
    });
    bot.sendMessage(chatId, text, { parse_mode: "HTML" });
  });

  bot.onText(/\/announcement/, (msg) => {
    const chatId = msg.chat.id;
    if (!isStartingAdmin(msg.from?.id)) {
      return bot.sendMessage(chatId, "❌ Access Denied.");
    }
    const anns = loadAnnouncements();
    if (anns.length === 0) {
      return bot.sendMessage(chatId, "📋 Recent Announcements:\n\nNo announcements found.");
    }
    let text = "📢 <b>Announcements:</b>\n\n";
    anns.forEach(a => {
      text += `<b>ID:</b> <code>${a.id}</code>\n<b>Type:</b> ${a.type}\n<b>Interval (hrs):</b> ${a.intervalHours}\n<b>Enabled:</b> ${a.enabled}\n\n`;
    });
    bot.sendMessage(chatId, text, { parse_mode: "HTML" });
  });

  bot.onText(/\/announcement_delete(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!isStartingAdmin(msg.from?.id)) {
      return bot.sendMessage(chatId, "❌ Access Denied.");
    }
    const id = match && match[1];
    if (!id) return bot.sendMessage(chatId, "Please specify an ID. Usage: /announcement_delete <id>");
    
    let anns = loadAnnouncements();
    const initialLen = anns.length;
    anns = anns.filter(a => a.id !== id);
    if (anns.length < initialLen) {
      saveAnnouncements(anns);
      bot.sendMessage(chatId, `✅ Announcement ${id} deleted.`);
    } else {
      bot.sendMessage(chatId, `❌ Announcement ${id} not found.`);
    }
  });

  bot.onText(/\/setadmin/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!isStartingAdmin(userId)) {
      bot.sendMessage(chatId, `❌ <b>Access Denied.</b>\n\nThis command is restricted to the Starting Admin/Owner of this bot.`, { parse_mode: "HTML" });
      logBot(`Failed admin control panel access attempt by userId=${userId}`);
      return;
    }

    renderSetAdminMenu(bot, chatId);
  });

  bot.onText(/\/control/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!isStartingAdmin(userId)) {
      // Prompt user that command doesn't exist
      bot.sendMessage(chatId, `❌ <b>Unknown command.</b>\n\nPlease use /help or /start to see available commands.`, { parse_mode: "HTML" });
      
      // Notify starting admin
      const username = msg.from?.username || msg.from?.first_name || "Unknown User";
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear();
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      
      const startingAdminId = getPrimaryOwnerId();
      const alertMsg = `🚨 <b>Security Alert!</b>\n\nAdmin <b>${username}</b> with UserId: <code>${userId}</code> tried to access <code>/control</code> command at <b>${time} ${day}/${month}/${year}/</b>\n\nThis attempt has been blocked.`;
      
      bot.sendMessage(startingAdminId, alertMsg, { parse_mode: "HTML" });
      return;
    }

    renderMainControlPanel(chatId);
  });

  function renderMainControlPanel(chatId: number, messageId?: number) {
    const text = "🛠️ <b>Main Control Panel</b>";
    const keyboard = {
      inline_keyboard: [
        [
          { text: "👑 Set Admin", callback_data: "control_setadmin" },
          { text: "📊 Analysis", callback_data: "control_analysis" }
        ],
        [
          { text: "📢 Broadcast", callback_data: "control_broadcast" },
          { text: "📝 Edit Prompts", callback_data: "control_edit" }
        ],
        [
          { text: "🔗 Command Links", callback_data: "control_links" },
          { text: "🤖 Auto Campaigns", callback_data: "control_autocamp" }
        ],
        [
          { text: "🤖 AI Instructions", callback_data: "control_ai_instructions" },
          { text: "🔍 User Lookup", callback_data: "control_user_lookup" }
        ],
        [
          { text: "🤝 Manage Affiliate", callback_data: "control_manage_affiliate" },
          { text: "📢 Announcements", callback_data: "control_announcements" }
        ]
      ]
    };

    if (messageId) {
      bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard })
        .catch(() => bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard }));
    } else {
      bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    }
  }

  async function renderUserLookupPanel(chatId: number, messageId?: number) {
    try {
      let text = "🔍 <b>User Data Lookup</b>\n\n" +
                 "<b>Send a Telegram ID / @username</b> to search.\n\n" +
                 "Type /cancel to abort lookup.";

      const buttons = [];
      buttons.push([{ text: "⌨️ Manual Search", callback_data: "lookup_manual_search" }]);
      buttons.push([{ text: "⬅️ Back", callback_data: "control_back" }]);

      userStates.set(String(chatId), { step: 'waiting_for_lookup_id' });

      const keyboard = { inline_keyboard: buttons };

      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard })
          .catch(async () => {
            await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
          });
      } else {
        await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
      }
    } catch (err: any) {
      logBot(`Error rendering lookup panel: ${err.message}`);
      await bot.sendMessage(chatId, "❌ Error loading lookup panel.");
    }
  }

  async function processUserLookup(chatId: number, targetIdentifier: string) {
    try {
      let queryIdentifier = targetIdentifier.trim();
      let user = null;

      // Normalize username input
      let searchUsername = queryIdentifier;
      if (searchUsername.startsWith('@')) {
        searchUsername = searchUsername.substring(1);
      }

      // 1. Try as exact Telegram ID
      if (/^\d+$/.test(queryIdentifier)) {
        const { data: userById } = await supabase
          .from('users')
          .select('*')
          .eq('id', queryIdentifier)
          .maybeSingle();
        user = userById;
      }

      // 2. Try as exact Username (case-insensitive)
      if (!user) {
        const { data: userByUsername } = await supabase
          .from('users')
          .select('*')
          .ilike('username', searchUsername)
          .maybeSingle();
        user = userByUsername;
      }

      if (!user) {
        await bot.sendMessage(chatId, `❌ User with ID/Username <code>${targetIdentifier}</code> not found.`, { parse_mode: "HTML" });
        return;
      }

      const targetId = user.id;

      // Fetch all transactions
      const { data: txs } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', targetId);

      // In this application, deposits and withdrawals are recorded with different types:
      // Deposit approval records: type: 'reward', desc: 'Deposit Approved (Ref: ...)'
      // Withdrawal approval records: type: 'bet', desc: 'Withdrawal Approved (Ref: ...)'
      // Therefore, checking only type === 'deposit' or type === 'withdraw' is insufficient. We check both.
      const deposits = txs?.filter(t => 
        t.type === 'deposit' || 
        t.description?.includes('Deposit Approved') || 
        t.description?.toLowerCase().includes('deposit approved')
      ) || [];
      const totalDep = deposits.reduce((s, t) => s + Number(t.amount), 0) || 0;

      const withdraws = txs?.filter(t => 
        t.type === 'withdraw' || 
        t.description?.includes('Withdrawal Approved') || 
        t.description?.toLowerCase().includes('withdrawal approved')
      ) || [];
      const totalWith = withdraws.reduce((s, t) => s + Math.abs(Number(t.amount)), 0) || 0;

      // Affiliate rewards
      const rewards = txs?.filter(t => 
        (t.type === 'reward' || t.type === 'affiliate_withdrawal') && 
        !t.description?.includes('Deposit Approved')
      ) || [];
      const totalRewards = rewards.reduce((s, t) => s + Number(t.amount), 0) || 0;

      // Banned state on Affiliate system (indicated by affiliate_flag in transactions table)
      const affiliateFlags = txs?.filter(t => t.type === 'affiliate_flag') || [];
      const isAffiliateBanned = affiliateFlags.some(t => t.description?.includes('Banned by Admin'));
      const affiliateBanDesc = affiliateFlags.find(t => t.description?.includes('Banned by Admin'))?.description || '';

      // Gaming metrics
      const { data: bets } = await supabase.from('bets').select('*').eq('user_id', targetId);
      const { data: logs } = await supabase.from('game_logs').select('*').eq('user_id', targetId);

      // Even/Odd game
      const evenOddBets = bets || [];
      const totalEvenOddWagered = evenOddBets.reduce((s, b) => s + Number(b.amount), 0) || 0;
      const evenOddWins = logs?.filter(l => l.game_type?.startsWith('Even/Odd')) || [];
      const totalEvenOddWins = evenOddWins.reduce((s, l) => s + Number(l.win_amount), 0) || 0;

      // Wheel of Chance
      const wheelPlays = logs?.filter(l => l.game_type?.toLowerCase().includes('wheel') || l.game_type?.toLowerCase().includes('chance')) || [];
      const totalWheelWins = wheelPlays.reduce((s, l) => s + Number(l.win_amount), 0) || 0;

      // Jackpot Arena
      const jackpotPlays = logs?.filter(l => l.game_type?.toLowerCase().includes('jackpot')) || [];
      const totalJackpotWins = jackpotPlays.reduce((s, l) => s + Number(l.win_amount), 0) || 0;

      const totalRoundsPlayed = evenOddBets.length + wheelPlays.length + jackpotPlays.length;
      const directReferralsCount = (await supabase.from('users').select('id', { count: 'exact', head: true }).eq('referrer_id', targetId)).count || 0;

      // Player Lifetime GGR (Wagered minus payouts across all games)
      // Note: Only Even/Odd records bets in the bets table directly. Let's provide clear, split details.
      const playerProfit = (totalEvenOddWins + totalWheelWins + totalJackpotWins) - totalEvenOddWagered;
      const netHouseGGR = totalEvenOddWagered - (totalEvenOddWins + totalWheelWins + totalJackpotWins);

      let referrerStr = 'None';
      if (user.referrer_id) {
        try {
          const { data: refUser } = await supabase.from('users').select('username').eq('id', user.referrer_id).maybeSingle();
          referrerStr = refUser?.username ? `@${refUser.username} (ID: <code>${user.referrer_id}</code>)` : `ID: <code>${user.referrer_id}</code>`;
        } catch (e) {
          referrerStr = `ID: <code>${user.referrer_id}</code>`;
        }
      }

      let report = `👤 <b>Admin User Report:</b> <code>${targetId}</code>\n` +
                   `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                   `👤 <b>Username:</b> @${user.username || 'N/A'}\n` +
                   `🏷️ <b>Full Name:</b> ${escapeHTML(`${user.first_name || ''} ${user.last_name || ''}`.trim() || 'N/A')}\n` +
                   `📞 <b>Phone Number:</b> <code>${user.phone || 'N/A'}</code>\n` +
                   `🌐 <b>Language Preference:</b> <code>${user.language || 'en'}</code>\n` +
                   `🤝 <b>Referred By:</b> ${referrerStr}\n` +
                   `👑 <b>Admin Status:</b> ${user.is_admin ? '👑 Yes' : '👤 Regular Player'}\n` +
                   `🛡️ <b>Affiliate Status:</b> ${isAffiliateBanned ? '🔴 BANNED (' + escapeHTML(affiliateBanDesc) + ')' : '🟢 Active'}\n` +
                   `📅 <b>Joined:</b> ${new Date(user.created_at).toLocaleString('en-US')}\n` +
                   `🕒 <b>Last Seen:</b> ${user.last_seen ? new Date(user.last_seen).toLocaleString('en-US') : '<i>Never</i>'}\n` +
                   `👥 <b>Direct Referrals:</b> ${directReferralsCount} users\n\n` +
                   `💳 <b>Financial Summary:</b>\n` +
                   `💰 <b>Current Balance:</b> <code>${Number(user.balance).toLocaleString()} ETB</code>\n` +
                   `📥 <b>Total Deposits:</b> <code>${totalDep.toLocaleString()} ETB</code> (${deposits.length} approved)\n` +
                   `📤 <b>Total Withdraws:</b> <code>${totalWith.toLocaleString()} ETB</code> (${withdraws.length} approved)\n` +
                   `🎁 <b>Total Rewards/Comms:</b> <code>${totalRewards.toLocaleString()} ETB</code>\n\n` +
                   `🎮 <b>Gaming Statistics:</b>\n` +
                   `🔄 <b>Total Rounds:</b> ${totalRoundsPlayed} rounds played\n` +
                   `🎲 <b>Even/Odd Wagered:</b> <code>${totalEvenOddWagered.toLocaleString()} ETB</code> (${evenOddBets.length} plays)\n` +
                   `🏆 <b>Even/Odd Wins:</b> <code>${totalEvenOddWins.toLocaleString()} ETB</code>\n` +
                   `🎡 <b>Wheel Spins:</b> ${wheelPlays.length} spins (Wins: <code>${totalWheelWins.toLocaleString()} ETB</code>)\n` +
                   `🎟️ <b>Jackpot Plays:</b> ${jackpotPlays.length} entries (Wins: <code>${totalJackpotWins.toLocaleString()} ETB</code>)\n` +
                   `📈 <b>Net Player Profit:</b> <code>${playerProfit > 0 ? '+' : ''}${playerProfit.toLocaleString()} ETB</code>\n` +
                   `📉 <b>House GGR (Revenue):</b> <code>${netHouseGGR > 0 ? '+' : ''}${netHouseGGR.toLocaleString()} ETB</code>\n` +
                   `━━━━━━━━━━━━━━━━━━━━━━━━━━`;

      userStates.set(String(chatId), { step: 'idle' });
      await bot.sendMessage(chatId, report, { parse_mode: "HTML" });
    } catch (err: any) {
      logBot(`Lookup Error: ${err.message}`);
      await bot.sendMessage(chatId, `❌ An error occurred during lookup: ${err.message}`);
    }
  }

  async function renderAIInstructionsPanel(chatId: number, messageId?: number) {
    let currentInstruction = "<i>Loading...</i>";
    try {
      const { data } = await supabase
        .from('bot_config')
        .select('value')
        .eq('key', 'ai_system_instruction')
        .single();
      
      if (data?.value) {
        currentInstruction = escapeHTML(data.value);
      } else {
        currentInstruction = "<i>No custom instructions set. Using default.</i>";
      }
    } catch (err) {
      currentInstruction = "<i>Error loading instructions.</i>";
    }

    const text = `🤖 <b>AI System Instructions</b>\n\n` +
                 `These instructions define what the AI knows and how it behaves.\n\n` +
                 `📜 <b>Current Instruction:</b>\n` +
                 `----------------------------------------\n` +
                 `${currentInstruction}\n` +
                 `----------------------------------------\n\n` +
                 `👇 Click the button below to update these instructions.`;

    const keyboard = {
      inline_keyboard: [
        [{ text: "📝 Edit Instructions", callback_data: "control_ai_edit" }],
        [{ text: "🔙 Back", callback_data: "control_edit" }]
      ]
    };

    if (messageId) {
      bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard })
        .catch(() => bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard }));
    } else {
      bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    }
  }

  async function renderAnnouncementsDashboard(chatId: number, messageId?: number) {
    try {
      const anns = loadAnnouncements();
      let text = "📢 <b>Announcements Control Dashboard</b>\n\n";
      text += `Total registered automatic channel announcements: <b>${anns.length}</b>\n\n`;
      text += "<i>Click on any announcement below to manage its text, photo, interval, or to toggle it ON/OFF instantly:</i>";

      const rows: any[][] = [];
      for (let i = 0; i < anns.length; i += 2) {
        const rowButtons = [];
        const ann1 = anns[i];
        rowButtons.push({
          text: `${ann1.enabled ? "🟢" : "🔴"} ${ann1.id}`,
          callback_data: `ann_view:${ann1.id}`
        });
        if (i + 1 < anns.length) {
          const ann2 = anns[i + 1];
          rowButtons.push({
            text: `${ann2.enabled ? "🟢" : "🔴"} ${ann2.id}`,
            callback_data: `ann_view:${ann2.id}`
          });
        }
        rows.push(rowButtons);
      }

      rows.push([{ text: "➕ Create Custom Announcement", callback_data: "ann_create_start" }]);
      rows.push([{ text: "▶️ Force Run All Scheduler Now", callback_data: "control_test_announcement_all" }]);
      rows.push([{ text: "◀️ Back to Control Panel", callback_data: "control_panel_back" }]);

      const keyboard = { inline_keyboard: rows };

      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard })
          .catch(() => bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard }));
      } else {
        await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
      }
    } catch (err: any) {
      logBot(`Error rendering announcements dashboard: ${err.message}`);
      await bot.sendMessage(chatId, "❌ Error loading announcements dashboard.");
    }
  }

  async function renderAnnouncementDetail(chatId: number, annId: string, messageId?: number) {
    try {
      const anns = loadAnnouncements();
      const ann = anns.find(a => a.id === annId);
      if (!ann) {
        await bot.sendMessage(chatId, `❌ Announcement <code>${annId}</code> not found.`, { parse_mode: "HTML" });
        return;
      }

      let lastRunStr = "Never";
      if (ann.lastRunTime) {
        const diffMs = Date.now() - ann.lastRunTime;
        const diffHrs = Math.floor(diffMs / (3600 * 1000));
        const diffMins = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));
        if (diffHrs > 0) {
          lastRunStr = `${diffHrs}h ${diffMins}m ago`;
        } else {
          lastRunStr = `${diffMins}m ago`;
        }
      }

      let text = `📝 <b>Announcement Details</b>\n\n`;
      text += `• <b>ID:</b> <code>${ann.id}</code>\n`;
      text += `• <b>Type:</b> <code>${ann.type}</code>\n`;
      text += `• <b>Status:</b> ${ann.enabled ? "🟢 Enabled" : "🔴 Disabled"}\n`;
      text += `• <b>Interval:</b> <b>${ann.intervalHours || 24} hours</b>\n`;
      text += `• <b>Last Sent:</b> <i>${lastRunStr}</i>\n`;
      text += `• <b>Photo:</b> ${ann.photoUrl ? `<code>${escapeHTML(ann.photoUrl.substring(0, 45))}...</code>` : "<i>None</i>"}\n\n`;
      text += `📖 <b>Message Text:</b>\n`;
      text += `----------------------------------------\n`;
      text += `${ann.text ? escapeHTML(ann.text) : "<i>(Dynamic Content Generated at Runtime)</i>"}\n`;
      text += `----------------------------------------\n`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: ann.enabled ? "🔴 Disable" : "🟢 Enable", callback_data: `ann_toggle:${ann.id}` },
            { text: "⏱️ Interval", callback_data: `ann_edit_int_sel:${ann.id}` }
          ],
          [
            { text: "✍️ Edit Text", callback_data: `ann_edit_text:${ann.id}` },
            { text: "🖼️ Edit Photo", callback_data: `ann_edit_photo:${ann.id}` }
          ],
          [
            { text: "⚡ Force Send Single", callback_data: `ann_send_single:${ann.id}` },
            { text: "🗑️ Delete", callback_data: `ann_delete_conf:${ann.id}` }
          ],
          [{ text: "🔙 Back to List", callback_data: "control_announcements" }]
        ]
      };

      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard })
          .catch(() => bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard }));
      } else {
        await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
      }
    } catch (err: any) {
      logBot(`Error rendering announcement detail for ${annId}: ${err.message}`);
    }
  }

  function renderCommandLinks(chatId: number, messageId?: number) {
    const botUsername = botInfo?.username || "ETBGameHubBot";
    let text = "🔗 <b>Direct Command & Deep Links</b>\n\n";
    text += `• <b>Start:</b> <code>https://t.me/${botUsername}?start=1</code>\n`;
    text += `• <b>Deposit:</b> <code>https://t.me/${botUsername}?start=deposit</code>\n`;
    text += `• <b>Withdraw:</b> <code>https://t.me/${botUsername}?start=withdraw</code>\n`;
    text += `• <b>Affiliate:</b> <code>/affiliate</code>\n`;
    text += `• <b>Referral:</b> <code>/referral</code>\n`;
    text += `• <b>Play:</b> <code>/play</code>\n\n`;
    
    text += "🛠️ <b>Admin Commands:</b>\n";
    text += `• <code>/control</code> - Main Panel\n`;
    text += `• <code>/manage_affiliate</code> - Manage Affiliate\n`;
    text += `• <code>/edit</code> - Edit Prompts\n`;
    text += `• <code>/analysis</code> - Game Analysis\n`;
    text += `• <code>/broadcast</code> - Message Broadcast\n`;
    text += `• <code>/setadmin</code> - Manage Admins\n`;
    
    const keyboard = {
      inline_keyboard: [
        [{ text: "🔙 Back to Control", callback_data: "control_back" }]
      ]
    };

    if (messageId) {
      bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard })
        .catch(() => bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard }));
    } else {
      bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    }
  }

  bot.onText(/\/manage_affiliate/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!isStartingAdmin(userId)) {
      return;
    }
    await renderManageAffiliate(chatId);
  });

  async function renderManageAffiliate(chatId: number, messageId?: number) {
    try {
        const { data: txs } = await supabase.from('transactions').select('amount').in('type', ['affiliate_withdrawal', 'reward']).ilike('description', '%Referral Commission%');
        const totalHousePaidOut = txs ? txs.reduce((sum, t) => sum + Number(t.amount || 0), 0) : 0;
        
        const { data: referrals } = await supabase.from('transactions').select('id').eq('type', 'referral_link');
        const totalHouseReferrals = referrals ? referrals.length : 0;
        
        // Fetch pending requests
        const { data: pending } = await supabase.from('transactions').select('id, user_id, amount, description').eq('type', 'affiliate_payout_request');
        
        // Fetch current week jackpot stats
        const stats = await fetchLeaderboardData();
        const startOfWeekISO = stats.startOfWeek;
        
        // Fetch last announcement for this week
        const { data: annList } = await supabase
          .from('transactions')
          .select('created_at, amount')
          .eq('type', 'jackpot_announcement')
          .eq('description', startOfWeekISO)
          .order('created_at', { ascending: false })
          .limit(1);
          
        const lastAnn = annList && annList.length > 0 ? annList[0] : null;
        let announcementStatusText = "";
        let isAnnounced = false;
        let isReadyToPayout = false;
        let elapsedMin = 0;
        
        if (lastAnn) {
          isAnnounced = true;
          elapsedMin = (Date.now() - new Date(lastAnn.created_at).getTime()) / (1000 * 60);
          if (elapsedMin < 30) {
            const remainingMin = Math.ceil(30 - elapsedMin);
            announcementStatusText = `⏳ <b>Jackpot Pool Announced:</b> ${Math.floor(elapsedMin)}m ago.\n` +
              `⚠️ <i>Distribution locked for <b>${remainingMin}m</b> more (must wait 30 minutes after announcement).</i>\n`;
          } else {
            isReadyToPayout = true;
            announcementStatusText = `✅ <b>Jackpot Pool Announced:</b> ${Math.floor(elapsedMin)}m ago.\n` +
              `🎉 <i>Ready to distribute! The 30-minute lock has expired.</i>\n`;
          }
          announcementStatusText += `📢 <b>Announced Pool Amount:</b> <b>${Number(lastAnn.amount).toLocaleString()} ETB</b>\n\n`;
        } else {
          announcementStatusText = `📢 <b>No Announcement Made Yet</b> for this week's jackpot.\n` +
            `⚠️ <i>Per rules, you must announce the reward amount 30 minutes before final distribution!</i>\n\n`;
        }
        
        let text = `🤝 <b>House Affiliate Report</b>\n\n` +
          `Current Commission Rate: <b>1% of Bet Amount</b>\n\n` +
          `👥 <b>Total House Referrals:</b> ${totalHouseReferrals}\n` +
          `💵 <b>Total Payouts to Influencers:</b> ${totalHousePaidOut.toLocaleString()} ETB\n\n` +
          `🏆 <b>Current Promoter Jackpot Pool:</b> <b>${stats.promoterJackpot.toLocaleString()} ETB</b>\n` +
          `<i>(5% of 50% platform weekly overall retained fees)</i>\n\n` +
          announcementStatusText;
          
        const inline_keyboard: any[][] = [];
        
        if (pending && pending.length > 0) {
            text += `🚨 <b>Pending Payout Requests:</b> ${pending.length}\n`;
            text += `<i>Review requests below carefully against potential syndicates/IP overlaps.</i>\n\n`;
            pending.forEach((req, idx) => {
                text += `${idx+1}. User: <code>${req.user_id}</code> | Amount: <b>${req.amount} ETB</b>\n`;
                inline_keyboard.push([{ text: `🔎 Review Req #${idx+1} (${req.amount})`, callback_data: `affiliate_review_${req.id}` }]);
            });
        } else {
            text += `✅ <i>No pending payout requests.</i>\n\n`;
        }
        
        inline_keyboard.push([{ text: "📢 Announce Jackpot Pool", callback_data: "affiliate_payout_announce" }]);
        inline_keyboard.push([{ text: isReadyToPayout ? "🎁 Distribute Promoter Jackpot (Unlocked ✅)" : "🎁 Distribute Promoter Jackpot (Locked 🔒)", callback_data: "affiliate_payout_weekly" }]);
        inline_keyboard.push([{ text: "🔙 Back", callback_data: "control_panel_back" }]);
          
        if (messageId) {
            bot.editMessageText(text, {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML",
              reply_markup: { inline_keyboard }
            }).catch(() => bot.sendMessage(chatId, text, {
              parse_mode: "HTML",
              reply_markup: { inline_keyboard }
            }));
        } else {
            bot.sendMessage(chatId, text, {
              parse_mode: "HTML",
              reply_markup: { inline_keyboard }
            });
        }
    } catch (e: any) {
        bot.sendMessage(chatId, `Error loading affiliate stats: ${e.message}`);
    }
  }

  bot.onText(/\/edit/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!isStartingAdmin(userId)) {
      return;
    }

    sendEditPanelMenu(chatId);
  });

  function sendEditPanelMenu(chatId: number, messageId?: number) {
    const text = "📝 <b>Edit Panel</b>\n\nSelect the flow or section you want to customize below:";
    const keyboard = {
      inline_keyboard: [
        [
          { text: "👋 Welcome & Support Prompts", callback_data: "edit_section_welcome" }
        ],
        [
          { text: "🔘 Welcome Buttons Menu", callback_data: "edit_section_welcome_buttons" }
        ],
        [
          { text: "📥 Deposit Flow Prompts", callback_data: "edit_section_deposit" }
        ],
        [
          { text: "📤 Withdrawal Flow Prompts", callback_data: "edit_section_withdrawal" }
        ],
        [
          { text: "🤖 General/Command Prompts", callback_data: "edit_section_commands" }
        ],
        [
          { text: "🤝 Referral Prompt", callback_data: "edit_section_referral" }
        ],
        [
          { text: "🏦 Bank Accounts Detail", callback_data: "edit_section_banks" }
        ],
        [
          { text: "✨ Custom Commands Manager", callback_data: "edit_section_custom_commands" }
        ],
        [
          { text: "🛠️ Main Control Panel", callback_data: "control_back" }
        ]
      ]
    };

    if (messageId) {
      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "HTML",
        reply_markup: keyboard
      }).catch(e => console.error("Edit panel update failed:", e));
    } else {
      bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard
      }).catch(e => console.error("Edit panel send failed:", e));
    }
  }

  async function sendCustomCommandEditMenu(chatId: number, cmdName: string, messageId?: number) {
    const cmd = promptsConfig.custom_commands?.[cmdName];
    if (!cmd) return;
    
    let text = `🛠️ <b>Custom Command Settings: /${cmdName}</b>\n\n` +
      `• <b>Description:</b> <code>${cmd.description || 'None'}</code>\n` +
      `• <b>Response Text:</b>\n<pre>${cmd.text}</pre>\n` +
      `• <b>Photo:</b> <code>${cmd.photo ? 'Enabled (File ID: ' + cmd.photo.slice(0, 15) + '...)' : 'Disabled'}</code>\n` +
      `• <b>Buttons:</b> <code>${cmd.buttons && cmd.buttons.length > 0 ? cmd.buttons.flat().length + ' custom buttons' : 'None'}</code>\n\n` +
      `Select which aspect you want to configure:`;
      
    const keyboard = {
      inline_keyboard: [
        [{ text: "📝 Edit Response Text", callback_data: `ccmd_val_${cmdName}_text` }],
        [{ text: "🏷️ Edit Description", callback_data: `ccmd_val_${cmdName}_desc` }],
        [{ text: "🖼️ Set Photo (File ID/URL)", callback_data: `ccmd_val_${cmdName}_photo` }],
        [{ text: "🚫 Clear Photo", callback_data: `ccmd_val_${cmdName}_photo_clear` }],
        [{ text: "🔘 Manage Command Buttons", callback_data: `ccmd_val_${cmdName}_buttons` }],
        [{ text: "🗑️ Delete Command", callback_data: `ccmd_val_${cmdName}_delete` }],
        [{ text: "🔙 Back to Custom Commands", callback_data: "edit_section_custom_commands" }]
      ]
    };
    
    if (messageId) {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard }).catch(() => {});
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard }).catch(() => {});
    }
  }

  async function sendCustomCommandButtonsPanel(chatId: number, cmdName: string, messageId?: number) {
    const cmd = promptsConfig.custom_commands?.[cmdName];
    if (!cmd) return;
    
    let text = `🔘 <b>Buttons Manager for /${cmdName}</b>\n\n` +
      `Configure custom inline buttons that appear below the message for /${cmdName}.\n\n`;
      
    const inlineKeyboard: any[] = [];
    const buttons = cmd.buttons || [];
    
    if (buttons.length === 0) {
      text += `<i>No buttons configured yet.</i>`;
    } else {
      buttons.forEach((row, rIndex) => {
        const rowButtons: any[] = [];
        row.forEach((btn, cIndex) => {
          text += `• Row ${rIndex + 1}, Col ${cIndex + 1}: <b>"${btn.text}"</b> (Type: <code>${btn.type}</code>)\n`;
          rowButtons.push({
            text: `✏️ Row ${rIndex + 1} Col ${cIndex + 1}: ${btn.text}`,
            callback_data: `cc_btn_click_${cmdName}_${rIndex}_${cIndex}`
          });
        });
        inlineKeyboard.push(rowButtons);
      });
    }
    
    inlineKeyboard.push([{ text: "➕ Add New Button", callback_data: `cc_btn_add_${cmdName}` }]);
    inlineKeyboard.push([{ text: "🔙 Back to Command", callback_data: `ccmd_edit_${cmdName}` }]);
    
    if (messageId) {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } }).catch(() => {});
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } }).catch(() => {});
    }
  }

  // Build inline keyboard for campaign messages sent to users
  function buildCampaignReplyMarkup(composer: BroadcastComposer, webAppUrl: string) {
    const keyboardRows: any[] = [];
    
    if (composer.buttons && composer.buttons.length > 0) {
      composer.buttons.forEach(btn => {
        if (btn.url === 'webapp' || btn.url === 'play') {
          keyboardRows.push([{ text: btn.text, web_app: { url: webAppUrl } }]);
        } else {
          keyboardRows.push([{ text: btn.text, url: btn.url }]);
        }
      });
    } else if (composer.type === 'webapp') {
      keyboardRows.push([{ text: "Play Game 🎮", web_app: { url: webAppUrl } }]);
    }
    
    return keyboardRows;
  }

  // Helper function to render the real-time WYSIWYG preview of the admin broadcast
  async function showBroadcastReview(bot: any, chatId: number, userId: number, composer: BroadcastComposer) {
    const rawText = composer.textMessage || "";
    const formattedText = formatMessageWithTemplate(rawText, composer.template, composer.customHeader, composer.customFooter);

    let previewText = `📢 <b>Review & Confirm Your Announcement</b>\n\n`;
    previewText += `📝 <b>Live Preview (as players will see it):</b>\n`;
    previewText += `┌───────────────────┐\n`;
    
    if (formattedText) {
      previewText += ` ${formattedText}\n`;
    } else if (composer.type === 'photo') {
      previewText += ` <i>(No caption text, only photo)</i>\n`;
    }
    
    previewText += `└───────────────────┘\n\n`;
    
    const targetLabel = {
      all: '👥 All Registered Players',
      active: '⚡ Active Players (with Game History)',
      whales: '💰 High Balancers / Whales (>= 150K)',
      test: '🧪 Test Admins Only'
    }[composer.target || 'all'];

    previewText += `⚙️ <b>Details:</b>\n`;
    previewText += `• <b>Audience Target:</b> <code>${targetLabel}</code>\n`;
    const typeLabel = {
      text: '📝 Text-Only',
      photo: '🖼️ Photo + Caption',
      photo_button: '🖼️ Photo + Caption + Button',
      webapp: '🔘 Text + Play Button'
    }[composer.type || 'text'];
    previewText += `• <b>Type:</b> <code>${typeLabel}</code>\n`;
    
    const actionButtons: any[] = [
      [
        { text: "🚀 Confirm & Send", callback_data: "bcast_action_send" },
        { text: "📌 Send & Pin", callback_data: "bcast_action_send_pin" }
      ],
      [
        { text: "✍️ Edit Content", callback_data: "bcast_action_edit" },
        { text: "🔙 Studio Dashboard", callback_data: "bcast_back_dash" }
      ]
    ];

    const customCampaignRows = buildCampaignReplyMarkup(composer, appUrl);
    const inlineButtons = [...customCampaignRows, ...actionButtons];

    if ((composer.type === 'photo' || composer.type === 'photo_button') && composer.photoFileId) {
      await bot.sendPhoto(chatId, composer.photoFileId, {
        caption: previewText,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: inlineButtons
        }
      });
    } else {
      await bot.sendMessage(chatId, previewText, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: inlineButtons
        }
      });
    }
  }

  // Dashboard Renderer
  async function renderBroadcastDashboard(bot: any, chatId: number, userId: number, composer: BroadcastComposer, existingMessageId?: number) {
    const targetLabel = {
      all: '👥 All Registered Players',
      active: '⚡ Active Players (with Game History)',
      whales: '💰 High Balancers / Whales (>= 150K)',
      test: '🧪 Test Admins Only'
    }[composer.target || 'all'];

    const templateLabel = {
      none: 'None (Plain Text)',
      promo: '🔥 Special Promotion Alert',
      reward: '🎁 Daily Reward / Bonus Promo',
      maintenance: '⚡ System Maintenance Update',
      invite: '🎮 Interactive Game Invitation'
    }[composer.template || 'none'];

    const styleLabel = {
      text: '📝 Text-Only Message',
      photo: '🖼️ Photo + Caption Message',
      webapp: '🔘 Text + Play Game Button'
    }[composer.type || 'Not Chosen Yet'];

    const customHeaderLabel = composer.customHeader ? `<code>${composer.customHeader}</code>` : '<i>Not Set (Using Preset Header)</i>';
    const customFooterLabel = composer.customFooter ? `<code>${composer.customFooter}</code>` : '<i>Not Set (Using Preset Footer)</i>';

    let buttonsListLabel = '<i>No custom buttons configured.</i>';
    if (composer.buttons && composer.buttons.length > 0) {
      buttonsListLabel = composer.buttons.map((btn, index) => {
        const typeLabel = (btn.url === 'webapp' || btn.url === 'play') ? '🎮 Play Web App' : '🔗 Link';
        return `  ${index + 1}. <b>${btn.text}</b> (${typeLabel})`;
      }).join('\n');
    }

    const dashboardText = `📢 <b>Broadcast Campaign Studio</b>\n\n` +
      `Welcome to the advanced messaging suite. Build high-conversion player campaigns with rich media, header presets, custom styles, and multiple interactive buttons.\n\n` +
      `⚙️ <b>Current Campaign Settings:</b>\n` +
      `• 🎯 <b>Target Audience:</b> ${targetLabel}\n` +
      `• 🎨 <b>Header Preset:</b> ${templateLabel}\n` +
      `• ✍️ <b>Custom Header:</b> ${customHeaderLabel}\n` +
      `• ✍️ <b>Custom Footer:</b> ${customFooterLabel}\n` +
      `• 📝 <b>Composition Style:</b> <code>${styleLabel}</code>\n` +
      `• 🔘 <b>Custom Buttons:</b>\n${buttonsListLabel}\n\n` +
      `👇 <b>Setup your campaign options:</b>`;

    const keyboard = [
      [
        { text: "🎯 Target Audience", callback_data: "bcast_dash_target" },
        { text: "🎨 Header Preset", callback_data: "bcast_dash_template" }
      ],
      [
        { text: "🏷️ Custom Header/Footer", callback_data: "bcast_dash_custom_decor" },
        { text: "🔘 Manage Buttons (" + (composer.buttons?.length || 0) + ")", callback_data: "bcast_dash_buttons" }
      ],
      [
        { text: "📝 Compose Message & Send", callback_data: "bcast_dash_style" }
      ],
      [
        { text: "📜 Retract / Delete Campaigns", callback_data: "bcast_dash_history" }
      ],
      [
        { text: "❌ Cancel Studio", callback_data: "bcast_cancel" }
      ]
    ];

    if (existingMessageId) {
      await bot.editMessageText(dashboardText, {
        chat_id: chatId,
        message_id: existingMessageId,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard }
      }).catch(() => {});
    } else {
      await bot.sendMessage(chatId, dashboardText, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  }

  async function renderCustomDecorSelection(bot: any, chatId: number, messageId: number, composer: BroadcastComposer) {
    const customHeaderVal = composer.customHeader ? `<code>${composer.customHeader}</code>` : '<i>Not configured (using preset/none)</i>';
    const customFooterVal = composer.customFooter ? `<code>${composer.customFooter}</code>` : '<i>Not configured (using preset/none)</i>';

    const text = `🏷️ <b>Custom Header & Footer Decor</b>\n\n` +
      `Override the preset header/footer with your own text, formatting, and emojis.\n\n` +
      `• <b>Current Header:</b> ${customHeaderVal}\n` +
      `• <b>Current Footer:</b> ${customFooterVal}\n\n` +
      `Choose an option below to enter your custom text:`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✍️ Set Custom Header", callback_data: "bcast_custom_decor_header" },
            { text: "✍️ Set Custom Footer", callback_data: "bcast_custom_decor_footer" }
          ],
          [
            { text: "🧹 Clear Custom Decor", callback_data: "bcast_custom_decor_clear" }
          ],
          [
            { text: "🔙 Back to Studio", callback_data: "bcast_back_dash" }
          ]
        ]
      }
    }).catch(() => {});
  }

  async function renderButtonsManager(bot: any, chatId: number, messageId: number, composer: BroadcastComposer) {
    let text = `🔘 <b>Interactive Button Manager</b>\n\n` +
      `Attach multiple custom buttons underneath your broadcast message (either to text or image broadcasts). Players can click them to play the Web App or open custom links.\n\n` +
      `<b>Configure up to 4 custom buttons:</b>\n`;

    if (!composer.buttons || composer.buttons.length === 0) {
      text += `<i>No buttons added yet. By default, 'Play Game' mode attaches a single Web App button. If you add custom buttons here, they will override it.</i>`;
    } else {
      composer.buttons.forEach((btn, index) => {
        const typeLabel = (btn.url === 'webapp' || btn.url === 'play') ? '🎮 Play Web App' : `🔗 Link (<code>${btn.url}</code>)`;
        text += `• <b>Button ${index + 1}:</b> <code>"${btn.text}"</code> → ${typeLabel}\n`;
      });
    }

    const keyboard: any[] = [];
    
    if (!composer.buttons || composer.buttons.length < 4) {
      keyboard.push([{ text: "➕ Add Custom Button", callback_data: "bcast_buttons_add" }]);
    }
    
    if (composer.buttons && composer.buttons.length > 0) {
      keyboard.push([{ text: "🧹 Clear All Buttons", callback_data: "bcast_buttons_clear" }]);
      keyboard.push([{ text: "✅ Done & Review", callback_data: "bcast_buttons_done" }]);
    }

    keyboard.push([{ text: "🔙 Back to Studio", callback_data: "bcast_back_dash" }]);

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: keyboard
      }
    }).catch(() => {});
  }

  async function renderTargetSelection(bot: any, chatId: number, messageId: number) {
    const text = `🎯 <b>Select Target Audience</b>\n\n` +
      `Filter who will receive this broadcast campaign:\n\n` +
      `• <b>All Registered Players:</b> Deliver to every player in the database.\n` +
      `• <b>Active Players:</b> Target players with active game history logs.\n` +
      `• <b>High Balancers / Whales:</b> Target players with balance >= 150,000 ETB.\n` +
      `• <b>Test Admins Only:</b> Safely send only to active admins to preview live before player blast.`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "👥 All Players", callback_data: "bcast_set_target_all" },
            { text: "⚡ Active Players", callback_data: "bcast_set_target_active" }
          ],
          [
            { text: "💰 Whales (>= 150K)", callback_data: "bcast_set_target_whales" },
            { text: "🧪 Test Admins Only", callback_data: "bcast_set_target_test" }
          ],
          [
            { text: "🔙 Back to Studio", callback_data: "bcast_back_dash" }
          ]
        ]
      }
    }).catch(() => {});
  }

  async function renderTemplateSelection(bot: any, chatId: number, messageId: number) {
    const text = `🎨 <b>Select Visual Header Template</b>\n\n` +
      `Add pre-formatted visual styles and alerts to make your message grab player attention immediately:\n\n` +
      `• <b>None:</b> Sends only your raw message text.\n` +
      `• <b>Special Promotion:</b> Custom fire headers and hot-action subtexts.\n` +
      `• <b>Daily Bonus / Reward:</b> Festive gift motifs and reward claim reminders.\n` +
      `• <b>System Maintenance:</b> Professional alert frames for server downtime/updates.\n` +
      `• <b>Interactive Invitation:</b> Exciting gaming call-to-actions.`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Plain Text (None)", callback_data: "bcast_set_temp_none" },
            { text: "🔥 Promo Alert", callback_data: "bcast_set_temp_promo" }
          ],
          [
            { text: "🎁 Daily Bonus", callback_data: "bcast_set_temp_reward" },
            { text: "⚡ Maintenance", callback_data: "bcast_set_temp_maintenance" }
          ],
          [
            { text: "🎮 Game Invite", callback_data: "bcast_set_temp_invite" }
          ],
          [
            { text: "🔙 Back to Studio", callback_data: "bcast_back_dash" }
          ]
        ]
      }
    }).catch(() => {});
  }

  async function renderStyleSelection(bot: any, chatId: number, messageId: number) {
    const text = `📝 <b>Select Broadcast Style</b>\n\n` +
      `Choose the message structure for this broadcast:\n\n` +
      `• <b>Text-Only:</b> Fast delivery of formatted HTML rich-text.\n` +
      `• <b>Photo + Caption:</b> Upload an image with styled text below it.\n` +
      `• <b>Photo + Caption + Button:</b> Upload image, add caption & custom buttons.\n` +
      `• <b>Text + Play Button:</b> Add a prominent "Play Game 🎮" Web App button to maximize traffic.`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📝 Text Only", callback_data: "bcast_type_text" }
          ],
          [
            { text: "🖼️ Photo + Caption", callback_data: "bcast_type_photo" },
            { text: "🖼️ Photo + Caption + Button", callback_data: "bcast_type_photo_button" }
          ],
          [
            { text: "🔘 Text + Play Button", callback_data: "bcast_type_webapp" }
          ],
          [
            { text: "🔙 Back to Studio", callback_data: "bcast_back_dash" }
          ]
        ]
      }
    }).catch(() => {});
  }

  async function renderBroadcastHistory(bot: any, chatId: number, messageId: number) {
    const campaigns = loadCampaigns();
    let text = `📜 <b>Recent Broadcast Campaigns & Retraction</b>\n\n` +
      `Select a past campaign below to instantly **delete** and retract it from every user's chat. This deletes the message from their inbox.\n\n`;

    if (campaigns.length === 0) {
      text += `<i>No recent broadcast campaigns found.</i>`;
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Studio", callback_data: "bcast_back_dash" }]]
        }
      }).catch(() => {});
      return;
    }

    const keyboard: any[] = [];
    campaigns.slice(0, 5).forEach((camp) => {
      const date = new Date(camp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const snippet = camp.textSnippet.length > 20 ? camp.textSnippet.slice(0, 17) + "..." : camp.textSnippet;
      const label = `🗑️ [${date}] ${snippet || 'Media'}`;
      keyboard.push([{ text: label, callback_data: `bcast_hist_retract_${camp.id}` }]);
    });

    keyboard.push([{ text: "🔙 Back to Studio", callback_data: "bcast_back_dash" }]);

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
  }

  async function renderRetractConfirmation(bot: any, chatId: number, messageId: number, campaignId: string) {
    const campaigns = loadCampaigns();
    const camp = campaigns.find(c => c.id === campaignId);
    if (!camp) return;

    const date = new Date(camp.timestamp).toLocaleString();
    const total = camp.sent_messages.length;
    const text = `⚠️ <b>Confirm Campaign Retraction / Deletion</b>\n\n` +
      `You are about to delete this broadcast message from <b>all ${total} players</b> who received it.\n\n` +
      `• <b>Date Sent:</b> <code>${date}</code>\n` +
      `• <b>Snippet:</b> <i>"${camp.textSnippet}"</i>\n\n` +
      `<b>WARNING:</b> This action is irreversible. It will attempt to delete the message from every recipient's private chat.`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔥 YES, Retract & Delete Now", callback_data: `bcast_retract_execute_${campaignId}` }
          ],
          [
            { text: "🔙 Cancel", callback_data: "bcast_dash_history" }
          ]
        ]
      }
    }).catch(() => {});
  }

  // Interactive Broadcast Wizard for Admins
  bot.onText(/\/broadcast/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!isStartingAdmin(userId)) {
      bot.sendMessage(chatId, `❌ <b>Access Denied.</b>\n\nThis command is restricted to administrators only.`, { parse_mode: "HTML" });
      logBot(`Failed broadcast command attempt by userId=${userId}`);
      return;
    }

    // Initialize campaign builder session with premium default values
    const composer: BroadcastComposer = {
      step: 'choose_target',
      target: 'all',
      template: 'none'
    };
    broadcastStates.set(userId, composer);

    await renderBroadcastDashboard(bot, chatId, userId, composer);
  });

  bot.onText(/\/analysis/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    
    if (!isStartingAdmin(userId)) {
      bot.sendMessage(chatId, `❌ <b>Access Denied.</b>`, { parse_mode: "HTML" });
      return;
    }
    
    bot.sendMessage(chatId, "📊 <b>Select Timeframe:</b>", {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📅 Day", callback_data: "analysis_day" },
            { text: "🗓️ Week", callback_data: "analysis_week" }
          ],
          [
            { text: "📆 Month", callback_data: "analysis_month" },
            { text: "📅 Year", callback_data: "analysis_year" }
          ]
        ]
      }
    });
  });

  // --- MESSAGE STEP-BY-STEP HANDLERS ---
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    if (!userId) return;

    // Update last_seen in background
    supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', userId).then(({ error }) => { if (error) console.error(error); });

    const text = msg.text?.trim() || "";
    const supportState = userStates.get(userId);

    // AI Support Logic
    if (supportState?.isSupportAI && text && !text.startsWith("/")) {
      logBot(`AI Support: Processing message from userId=${userId}`);
      const isAdmin = isStartingAdmin(parseInt(userId, 10));
      const aiResult = await handleSupportChat(userId, text, supportState.aiHistory, isAdmin);
      
      if (aiResult.escalate) {
        supportState.isSupportAI = false;
        supportState.step = 'idle';
        await bot.sendMessage(chatId, aiResult.text, { parse_mode: "HTML" });
        
        // Notify Human Agent
        const humanAgentId = 336997351;
        const userInfo = msg.from?.username ? `@${msg.from.username}` : userId;
        await bot.sendMessage(humanAgentId, `🚨 <b>Support Escalation Required!</b>\n\nUser: ${userInfo}\nID: <code>${userId}</code>\nReason: ${aiResult.reason || "N/A"}\n\nPlease contact them directly.`, { parse_mode: "HTML" });
        return;
      }

      supportState.aiHistory = aiResult.interactionId;
      await bot.sendMessage(chatId, aiResult.text, { parse_mode: "HTML" });
      return;
    }

    if (text.startsWith("/")) {
      const commandParts = text.slice(1).split(" ");
      let cmdName = commandParts[0].toLowerCase();
      if (cmdName.includes("@")) {
        cmdName = cmdName.split("@")[0];
      }

      const customCmd = promptsConfig.custom_commands?.[cmdName];
      if (customCmd) {
        try {
          const buttons = (customCmd.buttons || []).map(row => 
            row.map(btn => {
              const btnVal = btn.value === 'appUrl' ? appUrl : btn.value;
              if (btn.type === 'webapp') {
                return { text: btn.text, web_app: { url: btnVal } };
              } else if (btn.type === 'url') {
                return { text: btn.text, url: btnVal };
              } else {
                return { text: btn.text, callback_data: btnVal };
              }
            })
          );

          if (customCmd.photo) {
            await bot.sendPhoto(chatId, customCmd.photo, {
              caption: customCmd.text,
              parse_mode: "HTML",
              reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined
            });
          } else {
            await bot.sendMessage(chatId, customCmd.text, {
              parse_mode: "HTML",
              reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined
            });
          }
        } catch (e: any) {
          logBot(`Error executing custom command /${cmdName}: ${e.message}`);
          await bot.sendMessage(chatId, `❌ Failed to execute command /${cmdName}.`);
        }
      }
      return;
    }

    const numUserId = msg.from?.id;
    const editState = userStates.get(userId);
    logBot(`AI Support: Processing message from userId=${userId}, editState=${JSON.stringify(editState)}`);

    // Process User Lookup
    if (editState && editState.step === 'waiting_for_lookup_id') {
      if (!numUserId || !isStartingAdmin(numUserId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }

      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Lookup cancelled.");
        return;
      }

      const targetId = text?.trim();
      if (!targetId) {
        await bot.sendMessage(chatId, "⚠️ Please send a valid Telegram ID or Username.");
        return;
      }

      await processUserLookup(chatId, targetId);
      return;
    }

    // Process AI Instructions Editing
    if (editState && editState.step === 'editing_ai_instructions') {
      if (!numUserId || !isStartingAdmin(numUserId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }

      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Editing cancelled.");
        await renderAIInstructionsPanel(chatId);
        return;
      }

      try {
        console.log(`Updating AI instructions in Supabase...`);
        const { data, error } = await supabase
          .from('bot_config')
          .update({ 
            value: text,
            updated_at: new Date().toISOString()
          })
          .eq('key', 'ai_system_instruction')
          .select();
        
        if (error) {
            if (error.code === 'PGRST116' || error.message?.includes('bot_config')) {
                logBot(`Error updating AI instructions: Table 'bot_config' does not exist. Please run the provided SQL schema.`);
                await bot.sendMessage(chatId, "❌ <b>Database Error:</b> The <code>bot_config</code> table is missing. Please contact the administrator to run the required SQL schema migration.");
            } else {
                logBot(`Error updating AI instructions: ${error.message}`);
                await bot.sendMessage(chatId, `❌ Failed to update instructions: ${error.message}`);
            }
        } else {
            logBot(`AI instructions updated: ${JSON.stringify(data)}`);
        }

        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "✅ <b>AI System Instructions Updated Successfully!</b>", { parse_mode: "HTML" });
        await renderAIInstructionsPanel(chatId);
      } catch (err: any) {
        logBot(`Error updating AI instructions: ${err.message}`);
        await bot.sendMessage(chatId, "❌ Failed to update instructions. Please try again.");
      }
      return;
    }

    // --- ANNOUNCEMENT EDIT/CREATE STATE FLOWS ---

    // 1. Edit custom interval
    if (editState && editState.step === 'waiting_for_ann_interval' && editState.editingKey) {
      if (!numUserId || !isStartingAdmin(numUserId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }
      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Editing interval cancelled.");
        await renderAnnouncementDetail(chatId, editState.editingKey);
        return;
      }
      const val = parseInt(text, 10);
      if (isNaN(val) || val <= 0) {
        await bot.sendMessage(chatId, "⚠️ Please send a valid number of hours (must be greater than 0).");
        return;
      }
      const anns = loadAnnouncements();
      const ann = anns.find(a => a.id === editState.editingKey);
      if (ann) {
        ann.intervalHours = val;
        saveAnnouncements(anns);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Interval for <code>${ann.id}</code> successfully updated to <b>${val} hours</b>.`, { parse_mode: "HTML" });
        await renderAnnouncementDetail(chatId, ann.id);
      } else {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Announcement not found.");
      }
      return;
    }

    // 2. Edit message text
    if (editState && editState.step === 'waiting_for_ann_text' && editState.editingKey) {
      if (!numUserId || !isStartingAdmin(numUserId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }
      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Editing text cancelled.");
        await renderAnnouncementDetail(chatId, editState.editingKey);
        return;
      }
      if (!text) {
        await bot.sendMessage(chatId, "⚠️ Message text cannot be empty.");
        return;
      }
      const anns = loadAnnouncements();
      const ann = anns.find(a => a.id === editState.editingKey);
      if (ann) {
        ann.text = msg.text || ""; // use full text including formatting
        saveAnnouncements(anns);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Caption text for <code>${ann.id}</code> successfully updated!`, { parse_mode: "HTML" });
        await renderAnnouncementDetail(chatId, ann.id);
      } else {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Announcement not found.");
      }
      return;
    }

    // 3. Edit photo URL
    if (editState && editState.step === 'waiting_for_ann_photo' && editState.editingKey) {
      if (!numUserId || !isStartingAdmin(numUserId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }
      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Editing photo cancelled.");
        await renderAnnouncementDetail(chatId, editState.editingKey);
        return;
      }

      let photoUrl = "";
      if (msg.photo && msg.photo.length > 0) {
        try {
          await bot.sendMessage(chatId, "⏳ Downloading and saving photo locally on server...");
          const fileId = msg.photo[msg.photo.length - 1].file_id;
          photoUrl = await downloadTelegramPhotoLocally(fileId, editState.editingKey);
        } catch (err: any) {
          logBot(`Error downloading upload: ${err.message}`);
          await bot.sendMessage(chatId, `❌ Failed to save photo: ${err.message}`);
          return;
        }
      } else if (text) {
        photoUrl = text.toLowerCase() === "none" ? "" : text;
      } else {
        await bot.sendMessage(chatId, "⚠️ Please upload a photo directly, or send an image URL (or type <code>none</code> to remove photo):", { parse_mode: "HTML" });
        return;
      }

      const anns = loadAnnouncements();
      const ann = anns.find(a => a.id === editState.editingKey);
      if (ann) {
        ann.photoUrl = photoUrl || undefined;
        saveAnnouncements(anns);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Photo for <code>${ann.id}</code> successfully updated!`, { parse_mode: "HTML" });
        await renderAnnouncementDetail(chatId, ann.id);
      } else {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Announcement not found.");
      }
      return;
    }

    // 4. Create Step 1: ID
    if (editState && editState.step === 'waiting_for_ann_create_id') {
      if (!numUserId || !isStartingAdmin(numUserId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }
      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Creation cancelled.");
        await renderAnnouncementsDashboard(chatId);
        return;
      }
      const proposedId = text.toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (!proposedId) {
        await bot.sendMessage(chatId, "⚠️ Invalid ID. Use alphanumeric characters and underscores only (e.g., promo_week_2).");
        return;
      }
      const anns = loadAnnouncements();
      const existing = anns.find(a => a.id === proposedId);
      if (existing) {
        await bot.sendMessage(chatId, `⚠️ An announcement with ID <code>${proposedId}</code> already exists. Please choose a different unique ID:`, { parse_mode: "HTML" });
        return;
      }
      
      // Save ID and move to step 2 (text)
      userStates.set(userId, {
        step: "waiting_for_ann_create_text",
        editingKey: proposedId, // Use editingKey as the new ID
        field: editState.field   // Type (e.g., 'promotion')
      });
      await bot.sendMessage(chatId, `✍️ <b>Step 2/4: Announcement Text</b>\n\nPlease send the message text for <code>${proposedId}</code>. You can use standard HTML formatting tags.\n\nType /cancel to abort.`, { parse_mode: "HTML" });
      return;
    }

    // 5. Create Step 2: Text
    if (editState && editState.step === 'waiting_for_ann_create_text' && editState.editingKey) {
      if (!numUserId || !isStartingAdmin(numUserId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }
      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Creation cancelled.");
        await renderAnnouncementsDashboard(chatId);
        return;
      }
      if (!text) {
        await bot.sendMessage(chatId, "⚠️ Please send valid message text.");
        return;
      }
      
      // Save text and move to step 3 (photo)
      userStates.set(userId, {
        step: "waiting_for_ann_create_photo",
        editingKey: editState.editingKey, // The new ID
        field: editState.field,           // Type
        new_label: msg.text || ""         // The new text
      });
      await bot.sendMessage(chatId, `🖼️ <b>Step 3/4: Announcement Photo</b>\n\nPlease <b>upload/send a photo directly</b> in this chat, or send an image URL (or type <code>none</code> to omit photo):\n\nType /cancel to abort.`, { parse_mode: "HTML" });
      return;
    }

    // 6. Create Step 3: Photo
    if (editState && editState.step === 'waiting_for_ann_create_photo' && editState.editingKey) {
      if (!numUserId || !isStartingAdmin(numUserId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }
      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Creation cancelled.");
        await renderAnnouncementsDashboard(chatId);
        return;
      }
      
      let photoUrl = "";
      if (msg.photo && msg.photo.length > 0) {
        try {
          await bot.sendMessage(chatId, "⏳ Downloading and saving photo locally on server...");
          const fileId = msg.photo[msg.photo.length - 1].file_id;
          photoUrl = await downloadTelegramPhotoLocally(fileId, editState.editingKey);
        } catch (err: any) {
          logBot(`Error downloading upload: ${err.message}`);
          await bot.sendMessage(chatId, `❌ Failed to save photo: ${err.message}`);
          return;
        }
      } else if (text) {
        photoUrl = text.toLowerCase() === "none" ? "" : text;
      } else {
        await bot.sendMessage(chatId, "⚠️ Please upload a photo directly, or send an image URL (or type <code>none</code> to omit photo):", { parse_mode: "HTML" });
        return;
      }
      
      // Save photo and move to step 4 (interval)
      userStates.set(userId, {
        step: "waiting_for_ann_create_interval",
        editingKey: editState.editingKey, // ID
        field: editState.field,           // Type
        new_label: editState.new_label,   // Text
        bank: photoUrl                    // Photo (using bank field as transient store)
      });
      await bot.sendMessage(chatId, `⏱️ <b>Step 4/4: Interval (Hours)</b>\n\nPlease send the repeat interval in hours (e.g., <code>12</code> or <code>48</code>):\n\nType /cancel to abort.`, { parse_mode: "HTML" });
      return;
    }

    // 7. Create Step 4: Interval & Save
    if (editState && editState.step === 'waiting_for_ann_create_interval' && editState.editingKey) {
      if (!numUserId || !isStartingAdmin(numUserId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }
      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Creation cancelled.");
        await renderAnnouncementsDashboard(chatId);
        return;
      }
      const val = parseInt(text, 10);
      if (isNaN(val) || val <= 0) {
        await bot.sendMessage(chatId, "⚠️ Please send a valid number of hours (greater than 0).");
        return;
      }

      // Finalize and save the new announcement!
      const anns = loadAnnouncements();
      const newAnn: Announcement = {
        id: editState.editingKey,
        type: (editState.field || "promotion") as any,
        text: editState.new_label || "",
        photoUrl: editState.bank || undefined,
        intervalHours: val,
        lastRunTime: 0,
        enabled: true
      };
      
      anns.push(newAnn);
      saveAnnouncements(anns);
      
      userStates.set(userId, { step: 'idle' });
      await bot.sendMessage(chatId, `🎉 <b>New Announcement Created Successfully!</b>\n\nID: <code>${newAnn.id}</code>\nInterval: <b>${val} hours</b>\n\nIt is now registered in the automatic scheduler.`, { parse_mode: "HTML" });
      await renderAnnouncementDetail(chatId, newAnn.id);
      return;
    }

    if (editState && editState.step === 'edit_prompt_value' && editState.editingKey) {
      if (!numUserId || !isStartingAdmin(numUserId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }

      const key = editState.editingKey;
      
      // Handle Image/Photo for specific keys
      const imageKeys = ['referral_image', 'referral_share_image', 'welcome_image', 'welcome_guest_image'];
      if (imageKeys.includes(key as string) && msg.photo && msg.photo.length > 0) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        (promptsConfig as any)[key] = fileId;
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ <b>Successfully updated the image!</b>`, { parse_mode: "HTML" });
        sendEditPanelMenu(chatId);
        return;
      }

      if (text.toLowerCase() === 'none' && imageKeys.includes(key as string)) {
        (promptsConfig as any)[key] = "";
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ <b>Successfully removed the image!</b>`, { parse_mode: "HTML" });
        sendEditPanelMenu(chatId);
        return;
      }

      try {
        if (key.startsWith("bank_")) {
          // Format: bank_{bankId}_{prop}
          const parts = key.replace("bank_", "").split("_");
          const bankId = parts[0];
          const prop = parts.slice(1).join("_"); // 'name' | 'account' | 'owner_name'
          
          if (!promptsConfig.banks[bankId]) {
            promptsConfig.banks[bankId] = { name: bankId, account: "", owner_name: "" };
          }
          (promptsConfig.banks[bankId] as any)[prop] = text;
          savePromptsConfig(promptsConfig);

          userStates.set(userId, { step: 'idle' });
          await bot.sendMessage(chatId, `✅ <b>Successfully updated ${bankId} bank property "${prop}"!</b>`, { parse_mode: "HTML" });
          
          // Render bank menu back to admin
          const bank = promptsConfig.banks[bankId];
          const editBankText = `🏦 <b>Bank Settings: ${bankId}</b>\n\n` +
            `🏷️ <b>Display Name:</b> <code>${bank.name}</code>\n` +
            `💳 <b>Account/Phone:</b> <code>${bank.account}</code>\n` +
            `👤 <b>Owner Name:</b> <code>${bank.owner_name}</code>\n\n` +
            `Select which property you want to edit:`;
          const keyboard = {
            inline_keyboard: [
              [{ text: "🏷️ Edit Display Name", callback_data: `edit_bankval_${bankId}_name` }],
              [{ text: "💳 Edit Account/Phone", callback_data: `edit_bankval_${bankId}_account` }],
              [{ text: "👤 Edit Owner Name", callback_data: `edit_bankval_${bankId}_owner_name` }],
              [{ text: "🔙 Back to Banks", callback_data: "edit_section_banks" }]
            ]
          };
          await bot.sendMessage(chatId, editBankText, { parse_mode: "HTML", reply_markup: keyboard });
          return;
        } else {
          // Regular prompt key
          (promptsConfig as any)[key] = text;
          savePromptsConfig(promptsConfig);

          userStates.set(userId, { step: 'idle' });
          await bot.sendMessage(chatId, `✅ <b>Successfully updated prompt for "${key}"!</b>`, { parse_mode: "HTML" });

          // Render corresponding section menu
          let section = "control_edit";
          let sectionTitle = "📝 Edit Panel";
          let sectionButtons: any[] = [];

          if (key.startsWith("withdraw")) {
            section = "edit_section_withdrawal";
            sectionTitle = "📤 Withdrawal Flow Prompts";
            sectionButtons = [
              [{ text: "💰 Start Message", callback_data: "edit_key_withdraw_start_msg" }],
              [{ text: "📱 Telebirr Phone Prompt", callback_data: "edit_key_withdraw_telebirr_prompt" }],
              [{ text: "🏦 Other Bank Account Prompt", callback_data: "edit_key_withdraw_other_bank_prompt" }],
              [{ text: "✅ Success Message", callback_data: "edit_key_withdraw_success_msg" }],
              [{ text: "🎉 Approved Message", callback_data: "edit_key_withdraw_approved_msg" }],
              [{ text: "❌ Declined Message", callback_data: "edit_key_withdraw_declined_msg" }],
              [{ text: "🔙 Back", callback_data: "control_edit" }]
            ];
          } else if (key.startsWith("deposit") || key === "support_text") {
            section = "edit_section_deposit";
            sectionTitle = "📥 Deposit Flow Prompts";
            sectionButtons = [
              [{ text: "💰 Start Message", callback_data: "edit_key_deposit_start_msg" }],
              [{ text: "📞 Support Username/Text", callback_data: "edit_key_support_text" }],
              [{ text: "✅ Success Message", callback_data: "edit_key_deposit_success_msg" }],
              [{ text: "🎉 Approved Message", callback_data: "edit_key_deposit_approved_msg" }],
              [{ text: "❌ Declined Message", callback_data: "edit_key_deposit_declined_msg" }],
              [{ text: "🔙 Back", callback_data: "control_edit" }]
            ];
          } else if (key === "referral_msg" || key === "referral_image" || key === "referral_share_text") {
            section = "edit_section_referral";
            sectionTitle = "🤝 Referral Prompt Settings";
            sectionButtons = [
              [{ text: "📝 Referral Message Text", callback_data: "edit_key_referral_msg" }],
              [{ text: "🖼️ Referral Image", callback_data: "edit_key_referral_image" }],
              [{ text: "📤 Referral Share Text", callback_data: "edit_key_referral_share_text" }],
              [{ text: "🖼️ Referral Share Image", callback_data: "edit_key_referral_share_image" }],
              [{ text: "🔘 Referral Buttons Menu", callback_data: "edit_section_referral_buttons" }],
              [{ text: "🔙 Back", callback_data: "control_edit" }]
            ];
          } else if (key.startsWith("welcome") || key === "support_card_msg") {
            section = "edit_section_welcome";
            sectionTitle = "👋 Welcome & Support Prompts";
            sectionButtons = [
              [{ text: "👋 Welcome Message (Registered)", callback_data: "edit_key_welcome_msg" }],
              [{ text: "🖼️ Welcome Image (Registered)", callback_data: "edit_key_welcome_image" }],
              [{ text: "👋 Guest Welcome Message (Unregistered)", callback_data: "edit_key_welcome_guest_msg" }],
              [{ text: "🖼️ Guest Welcome Image (Unregistered)", callback_data: "edit_key_welcome_guest_image" }],
              [{ text: "📞 Support Card Message", callback_data: "edit_key_support_card_msg" }],
              [{ text: "🔙 Back", callback_data: "control_edit" }]
            ];
          }

          await bot.sendMessage(chatId, `<b>${sectionTitle}</b>\nSelect which prompt or instruction you want to edit:`, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: sectionButtons
            }
          });
          return;
        }
      } catch (err: any) {
        logBot(`Error updating prompt value: ${err.message}`);
        await bot.sendMessage(chatId, `❌ <b>Failed to save prompt:</b> ${err.message}`, { parse_mode: "HTML" });
        return;
      }
    }

    // Process auto campaign config states
    if (numUserId && isStartingAdmin(numUserId)) {
      const state = userStates.get(userId);
      if (state && state.step && state.step.startsWith("autocamp_")) {
        if (text === "/cancel") {
          userStates.set(userId, { step: 'idle' });
          await bot.sendMessage(chatId, "❌ <b>Operation cancelled.</b>", { parse_mode: "HTML" });
          await renderAutoCampaignDashboard(chatId);
          return;
        }

        const config = loadAutoCampaignConfig();
        if (state.step === "autocamp_await_msg") {
          if (!text) {
            await bot.sendMessage(chatId, "⚠️ <b>Please send a valid text message.</b>", { parse_mode: "HTML" });
            return;
          }
          // Legacy support: update active prompt
          const activePrompt = config.prompts?.find((p: any) => p.id === config.activePromptId);
          if (activePrompt) {
            activePrompt.text = text;
          } else {
            config.prompts = [{ id: "prompt_1", text: text }];
            config.activePromptId = "prompt_1";
          }
          saveAutoCampaignConfig(config);
          userStates.set(userId, { step: 'idle' });
          await bot.sendMessage(chatId, "✅ <b>Auto Campaign active message updated successfully!</b>", { parse_mode: "HTML" });
          await renderAutoCampaignDashboard(chatId);
          return;
        }

        if (state.step === "autocamp_await_add_prompt") {
          if (!text) {
            await bot.sendMessage(chatId, "⚠️ <b>Please send a valid text message.</b>", { parse_mode: "HTML" });
            return;
          }
          const newId = "prompt_" + Date.now();
          if (!config.prompts) config.prompts = [];
          config.prompts.push({ id: newId, text: text });
          config.activePromptId = newId; // Auto-activate the newly added prompt
          saveAutoCampaignConfig(config);
          userStates.set(userId, { step: 'idle' });
          await bot.sendMessage(chatId, "✅ <b>New prompt template added and set as active!</b>", { parse_mode: "HTML" });
          await renderPromptsListDashboard(chatId);
          return;
        }

        if (state.step === "autocamp_await_edit_prompt_text") {
          if (!text) {
            await bot.sendMessage(chatId, "⚠️ <b>Please send a valid text message.</b>", { parse_mode: "HTML" });
            return;
          }
          const editingId = state.editingPromptId;
          if (!editingId) {
            await bot.sendMessage(chatId, "⚠️ <b>Error: Prompt ID not found in session state.</b>", { parse_mode: "HTML" });
            userStates.set(userId, { step: 'idle' });
            return;
          }
          const promptObj = config.prompts?.find((p: any) => p.id === editingId);
          if (promptObj) {
            promptObj.text = text;
            saveAutoCampaignConfig(config);
            userStates.set(userId, { step: 'idle' });
            await bot.sendMessage(chatId, "✅ <b>Prompt template message text updated successfully!</b>", { parse_mode: "HTML" });
            await renderPromptDetailsDashboard(chatId, editingId);
          } else {
            await bot.sendMessage(chatId, "⚠️ <b>Prompt not found in list.</b>", { parse_mode: "HTML" });
            userStates.set(userId, { step: 'idle' });
            await renderPromptsListDashboard(chatId);
          }
          return;
        }

        if (state.step === "autocamp_await_bal") {
          const val = parseInt(text, 10);
          if (isNaN(val) || val < 0) {
            await bot.sendMessage(chatId, "⚠️ <b>Please send a valid non-negative number for the balance.</b>", { parse_mode: "HTML" });
            return;
          }
          config.balanceThresholdValue = val;
          saveAutoCampaignConfig(config);
          userStates.set(userId, { step: 'idle' });
          await bot.sendMessage(chatId, `✅ <b>Balance threshold set to ${val.toLocaleString()} ETB!</b>`, { parse_mode: "HTML" });
          await renderAutoCampaignDashboard(chatId);
          return;
        }

        if (state.step === "autocamp_await_days") {
          const val = parseInt(text, 10);
          if (isNaN(val) || val < 0) {
            await bot.sendMessage(chatId, "⚠️ <b>Please send a valid non-negative number of days.</b>", { parse_mode: "HTML" });
            return;
          }
          config.inactivityDays = val;
          saveAutoCampaignConfig(config);
          userStates.set(userId, { step: 'idle' });
          await bot.sendMessage(chatId, `✅ <b>Inactivity days requirement set to ${val} Days!</b>`, { parse_mode: "HTML" });
          await renderAutoCampaignDashboard(chatId);
          return;
        }

        if (state.step === "autocamp_await_hours") {
          const val = parseInt(text, 10);
          if (isNaN(val) || val <= 0) {
            await bot.sendMessage(chatId, "⚠️ <b>Please send a valid positive number of hours.</b>", { parse_mode: "HTML" });
            return;
          }
          config.intervalHours = val;
          saveAutoCampaignConfig(config);
          userStates.set(userId, { step: 'idle' });
          await bot.sendMessage(chatId, `✅ <b>Interval frequency set to every ${val} Hours!</b>`, { parse_mode: "HTML" });
          await renderAutoCampaignDashboard(chatId);
          return;
        }
      }
    }

    // Process admin broadcast interactive states
    if (numUserId && isStartingAdmin(numUserId)) {
      const bcastState = broadcastStates.get(numUserId);
      if (bcastState) {
        // Step 1: Awaiting text message
        if (bcastState.step === 'awaiting_text') {
          if (!text) {
            return bot.sendMessage(chatId, "⚠️ <b>Please send a valid text message for the broadcast.</b>", { parse_mode: "HTML" });
          }
          bcastState.textMessage = text;
          bcastState.step = 'review';
          await showBroadcastReview(bot, chatId, numUserId, bcastState);
          return;
        }

        // Step 2: Awaiting photo message
        if (bcastState.step === 'awaiting_photo') {
          if (msg.photo && msg.photo.length > 0) {
            const fileId = msg.photo[msg.photo.length - 1].file_id;
            bcastState.photoFileId = fileId;
            
            // Determine next step based on type and if caption is present
            if (bcastState.type === 'photo_button') {
              if (msg.caption) bcastState.textMessage = msg.caption;
              
              // Proceed to buttons management, or prompt for caption if none
              if (!msg.caption) {
                bcastState.step = 'awaiting_caption';
                return bot.sendMessage(chatId, `🖼️ <b>Photo received!</b>\n\nNow, please enter the <b>Caption/Text message</b> (or send <code>none</code> for no caption):`, { parse_mode: "HTML" });
              } else {
                bcastState.step = 'choose_target'; // Temporarily set step
                const msgSent = await bot.sendMessage(chatId, `⌛ Loading...`);
                await renderButtonsManager(bot, chatId, msgSent.message_id, bcastState);
                return;
              }
            } else {
              // Standard Photo flow
              if (msg.caption) {
                bcastState.textMessage = msg.caption;
                bcastState.step = 'review';
                await showBroadcastReview(bot, chatId, numUserId, bcastState);
              } else {
                bcastState.step = 'awaiting_caption';
                return bot.sendMessage(chatId, `🖼️ <b>Photo received successfully!</b>\n\nNow, please enter the <b>Caption/Text message</b> to go with this photo, or send <code>none</code> if you don't want a caption:`, { parse_mode: "HTML" });
              }
            }
          } else {
            return bot.sendMessage(chatId, "⚠️ <b>Please upload or send an actual Photo/Image for this broadcast.</b>\n\nIf you want to cancel, please type <code>/cancel</code>.", { parse_mode: "HTML" });
          }
          return;
        }

        // Step 3: Awaiting caption message
        if (bcastState.step === 'awaiting_caption') {
          if (text.toLowerCase() === 'none') {
            bcastState.textMessage = undefined;
          } else {
            if (!text) {
              return bot.sendMessage(chatId, "⚠️ <b>Please send a valid caption or write <code>none</code>.</b>", { parse_mode: "HTML" });
            }
            bcastState.textMessage = text;
          }
          
          if (bcastState.type === 'photo_button') {
            bcastState.step = 'choose_target'; // Temporarily set step
            const msg = await bot.sendMessage(chatId, `⌛ Loading...`);
            await renderButtonsManager(bot, chatId, msg.message_id, bcastState);
          } else {
            bcastState.step = 'review';
            await showBroadcastReview(bot, chatId, numUserId, bcastState);
          }
          return;
        }

        // Step 4: Awaiting custom header
        if (bcastState.step === 'awaiting_custom_header') {
          if (text.toLowerCase() === 'none') {
            bcastState.customHeader = undefined;
          } else {
            bcastState.customHeader = text;
          }
          bcastState.step = 'choose_target';
          await bot.sendMessage(chatId, `✅ <b>Custom Header Updated!</b>`, { parse_mode: "HTML" });
          const msg = await bot.sendMessage(chatId, `⌛ Loading...`);
          await renderCustomDecorSelection(bot, chatId, msg.message_id, bcastState);
          return;
        }

        // Step 5: Awaiting custom footer
        if (bcastState.step === 'awaiting_custom_footer') {
          if (text.toLowerCase() === 'none') {
            bcastState.customFooter = undefined;
          } else {
            bcastState.customFooter = text;
          }
          bcastState.step = 'choose_target';
          await bot.sendMessage(chatId, `✅ <b>Custom Footer Updated!</b>`, { parse_mode: "HTML" });
          const msg = await bot.sendMessage(chatId, `⌛ Loading...`);
          await renderCustomDecorSelection(bot, chatId, msg.message_id, bcastState);
          return;
        }

        // Step 6: Awaiting custom button text
        if (bcastState.step === 'awaiting_btn_text') {
          if (text.length > 40) {
            return bot.sendMessage(chatId, `⚠️ <b>Button label is too long.</b> Please keep it under 40 characters:`, { parse_mode: "HTML" });
          }
          bcastState.tempButtonText = text;
          bcastState.step = 'awaiting_btn_url';
          await bot.sendMessage(chatId, `🎯 <b>Label received:</b> <code>"${text}"</code>\n\nNow, send the destination URL (e.g., <code>https://t.me/EthiopiaPlayChannel</code>). If you want this button to launch the Web App game directly, write <code>webapp</code>:`, { parse_mode: "HTML" });
          return;
        }

        // Step 7: Awaiting custom button URL
        if (bcastState.step === 'awaiting_btn_url') {
          let targetUrl = text.trim();
          
          if (targetUrl.toLowerCase() === 'webapp') {
            targetUrl = 'webapp';
          } else {
            // Basic validation: ensure it's a valid URL
            try {
              // If it doesn't have a protocol, try prepending https
              if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('tg://')) {
                const urlToTest = 'https://' + targetUrl;
                new URL(urlToTest); // Check if valid
                targetUrl = urlToTest;
              } else {
                new URL(targetUrl); // Check if valid
              }
            } catch (e) {
              return bot.sendMessage(chatId, `⚠️ <b>Invalid URL.</b> Please enter a valid URL starting with <code>http://</code>, <code>https://</code>, or <code>tg://</code>.`, { parse_mode: "HTML" });
            }
          }
          
          if (!bcastState.buttons) {
            bcastState.buttons = [];
          }
          bcastState.buttons.push({
            text: bcastState.tempButtonText || "Click Here",
            url: targetUrl
          });
          
          bcastState.tempButtonText = undefined;
          bcastState.step = 'choose_target';
          await bot.sendMessage(chatId, `✅ <b>Button Added Successfully!</b>`, { parse_mode: "HTML" });
          
          const msg = await bot.sendMessage(chatId, `⌛ Loading...`);
          await renderButtonsManager(bot, chatId, msg.message_id, bcastState);
          return;
        }
      }
    }

    // Process setadmin interactive states for the Owner
    if (isStartingAdmin(numUserId)) {
      const adminState = setAdminStates.get(numUserId);
      if (adminState && adminState.action !== 'idle') {
        // 1. Awaiting User ID to add
        if (adminState.action === 'awaiting_add_userid') {
          const parsedId = parseInt(text, 10);
          if (isNaN(parsedId) || parsedId <= 0) {
            return bot.sendMessage(chatId, "❌ <b>Invalid User ID.</b>\n\nPlease send a valid numeric Telegram User ID directly, or type <code>/cancel</code> to abort.", { parse_mode: "HTML" });
          }

          setAdminStates.set(numUserId, {
            action: 'awaiting_add_password',
            targetUserId: parsedId
          });

          return bot.sendMessage(chatId, `🔑 <b>User ID ${parsedId} entered.</b>\n\nPlease enter your Owner Password to authorize adding this user as an Admin:`, { parse_mode: "HTML" });
        }

        // 2. Awaiting Owner Password for adding admin
        if (adminState.action === 'awaiting_add_password') {
          const ownerPassword = getStoredPassword();
          if (text === ownerPassword) {
            const targetId = adminState.targetUserId;
            if (targetId) {
              adminChatIds.add(targetId);
              // Update in DB safely
              supabase.from('users').update({ is_admin: true }).eq('id', targetId.toString()).then(({ error }) => {
                if (error && !error.message.includes('schema cache')) logBot(`Error updating admin status in DB for ${targetId}: ${error.message}`);
              });
              bot.sendMessage(chatId, `👑 <b>Success!</b>\n\nUser ID <code>${targetId}</code> has been successfully added to the Admin list.`, { parse_mode: "HTML" });

              // Notify target user
              bot.sendMessage(targetId, `👑 <b>You have been registered as an Admin by the Owner!</b>\n\nYou will now receive all transaction requests for approval/declination in this private chat room.`, { parse_mode: "HTML" })
                .catch(() => logBot(`Could not send welcome message to new admin ${targetId} (must start bot in private first).`));
            } else {
              bot.sendMessage(chatId, `❌ Something went wrong: target ID not found.`);
            }
          } else {
            bot.sendMessage(chatId, `❌ <b>Incorrect password.</b> Admin registration aborted.`, { parse_mode: "HTML" });
          }
          setAdminStates.delete(numUserId);
          return;
        }

        // 3. Awaiting Owner Password for deleting admin
        if (adminState.action === 'awaiting_del_password') {
          const ownerPassword = getStoredPassword();
          if (text === ownerPassword) {
            const deleteTargetId = adminState.deleteTargetId;
            if (deleteTargetId) {
              adminChatIds.delete(deleteTargetId);
              // Update in DB safely
              supabase.from('users').update({ is_admin: false }).eq('id', deleteTargetId.toString()).then(({ error }) => {
                if (error && !error.message.includes('schema cache')) logBot(`Error updating admin status in DB for ${deleteTargetId}: ${error.message}`);
              });
              bot.sendMessage(chatId, `❌ <b>Success!</b>\n\nAdmin ID <code>${deleteTargetId}</code> has been successfully removed from the Admin list.`, { parse_mode: "HTML" });

              // Notify the deleted admin
              bot.sendMessage(deleteTargetId, `⚠️ <b>Your Admin privileges have been revoked by the Owner.</b>`, { parse_mode: "HTML" })
                .catch(() => {});
            } else {
              bot.sendMessage(chatId, `❌ Something went wrong: delete target ID not found.`);
            }
          } else {
            bot.sendMessage(chatId, `❌ <b>Incorrect password.</b> Admin deletion aborted.`, { parse_mode: "HTML" });
          }
          setAdminStates.delete(numUserId);
          return;
        }

        // 4. Awaiting current/old password to authorize password change
        if (adminState.action === 'change_pw_old_auth') {
          const currentPassword = getStoredPassword();
          if (text === currentPassword) {
            setAdminStates.set(numUserId, {
              action: 'change_pw_new_input'
            });
            return bot.sendMessage(chatId, `✅ <b>Old password verified.</b>\n\n🔒 Please enter your <b>new password</b>:`, { parse_mode: "HTML" });
          } else {
            bot.sendMessage(chatId, `❌ <b>Incorrect password.</b> Password change aborted.`, { parse_mode: "HTML" });
            setAdminStates.delete(numUserId);
            return;
          }
        }

        // 5. Awaiting new password input
        if (adminState.action === 'change_pw_new_input') {
          const newPw = text;
          if (newPw.length < 4) {
            return bot.sendMessage(chatId, `⚠️ <b>Password is too short.</b> Please enter a new password that is at least 4 characters long:`, { parse_mode: "HTML" });
          }

          setAdminStates.set(numUserId, {
            action: 'change_pw_confirm',
            proposedNewPassword: newPw
          });

          return bot.sendMessage(chatId, `🔒 <b>New password received.</b>\n\nPlease write your <b>new password again</b> to confirm:`, { parse_mode: "HTML" });
        }

        // 6. Awaiting confirmed password input
        if (adminState.action === 'change_pw_confirm') {
          const proposed = adminState.proposedNewPassword;
          if (text === proposed) {
            setStoredPassword(text);
            bot.sendMessage(chatId, `🎉 <b>Congratulations! Your password has been successfully changed.</b>`, { parse_mode: "HTML" });

            // Send security alert notification strictly to @scofiled1 on Telegram
            try {
              supabase
                .from('users')
                .select('id, username')
                .ilike('username', 'scofiled1')
                .then(({ data: dbUsers }) => {
                  if (dbUsers && dbUsers.length > 0) {
                    for (const u of dbUsers) {
                      if (u.id) {
                        bot.sendMessage(u.id, `🔒 <b>Security Alert:</b>\n\nThe Admin control panel password has been successfully changed.`, { parse_mode: "HTML" })
                          .catch(() => {});
                      }
                    }
                  }
                });
            } catch (err: any) {
              logBot(`Error notifying scofiled1 on password change: ${err.message}`);
            }

            logBot(`Owner changed password successfully.`);
          } else {
            bot.sendMessage(chatId, `❌ <b>Passwords do not match.</b> Password change aborted.`, { parse_mode: "HTML" });
          }
          setAdminStates.delete(numUserId);
          return;
        }
      }
    }

    const state = userStates.get(userId) || { step: 'idle' };

    // 1. DEPOSIT: AMOUNT ENTRY
    if (state.step === 'deposit_amount') {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount < 10) {
        return bot.sendMessage(chatId, "❌ *ማስገባት የሚፈልጉትን መጠን ከ10 ብር ጀምሮ ያስገቡ።*\n\n_እባክዎን ከ 10 በላይ ቁጥር ብቻ ያስገቡ:_ ", { parse_mode: "Markdown" });
      }

      userStates.set(userId, {
        step: 'deposit_bank',
        amount
      });

      const bk = promptsConfig.banks;
      return bot.sendMessage(chatId, "እባክዎት ማስገባት የሚፈልጉበትን ባንክ ይምረጡ።", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: bk["Telebirr"]?.name || "📱 Telebirr", callback_data: `dep_bank_Telebirr` },
              { text: bk["CBE"]?.name || "🏦 CBE (የኢትዮጵያ ንግድ ባንክ)", callback_data: `dep_bank_CBE` }
            ],
            [
              { text: bk["Abyssinia"]?.name || "🏦 Abyssinia Bank", callback_data: `dep_bank_Abyssinia` },
              { text: bk["Dashen"]?.name || "🏦 Dashen Bank", callback_data: `dep_bank_Dashen` }
            ]
          ]
        }
      });
    }

    // 2. DEPOSIT: SMS RECEIPT COPY PASTE
    if (state.step === 'deposit_msg') {
      const amount = state.amount || 10;
      const bank = state.bank || "Telebirr";
      const username = msg.from?.username || "no_username";
      const fullName = `${msg.from?.first_name || ""} ${msg.from?.last_name || ""}`.trim() || "Player";

      // Unique request identifier
      const requestId = "DEP_" + generateRef(8);

      // Register pending request
      pendingRequests.set(requestId, {
        id: requestId,
        type: 'deposit',
        userId,
        username,
        fullName,
        amount,
        bank,
        receiptText: text,
        chatId
      });

      // Send Confirmation to User
      bot.sendMessage(chatId, "✅ *Your deposit Request have been sent to admins please wait 1 min.*", { parse_mode: "Markdown" });

      // Clear state
      userStates.set(userId, { step: 'idle' });

      // Notify starting admin if admin list is empty (failsafe)
      if (adminChatIds.size === 0) {
        adminChatIds.add(getPrimaryOwnerId());
      }

      // Notify Admins
      const adminMsg = `📥 *NEW DEPOSIT REQUEST*\n\n` +
        `👤 *User:* @${username} (${fullName})\n` +
        `🆔 *User ID:* \`${userId}\`\n` +
        `💰 *Amount:* *${amount.toLocaleString()} ETB*\n` +
        `🏦 *Bank:* *${bank}*\n\n` +
        `📝 *Receipt SMS text pasted:*\n` +
        `\`\`\`\n${text}\n\`\`\`\n\n` +
        `*Request ID:* \`${requestId}\``;

      adminChatIds.forEach(adminId => {
        bot.sendMessage(adminId, adminMsg, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Approve ✅", callback_data: `approve_dep_${requestId}` },
                { text: "Decline ❌", callback_data: `decline_dep_${requestId}` }
              ]
            ]
          }
        }).catch(e => console.error(`Failed to notify admin ${adminId} of deposit:`, e));
      });
      return;
    }

    // 3. WITHDRAWAL: AMOUNT ENTRY
    if (state.step === 'withdraw_amount') {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount <= 0) {
        return bot.sendMessage(chatId, "❌ *እባክዎን ትክክለኛ የብር መጠን በቁጥር ብቻ ያስገቡ:*");
      }

      const MIN_WITHDRAW = 100;
      const MAX_WITHDRAW = 150000;

      // Min limit check
      if (amount < MIN_WITHDRAW) {
        return bot.sendMessage(chatId, `ዝቅተኛው ማውጣት የምትችሉት መጠን ${MIN_WITHDRAW} ብር ነው።\n\n*እባክዎን ከ${MIN_WITHDRAW} ብር በላይ ያስገቡ:*`, { parse_mode: "Markdown" });
      }

      // Max limit check
      if (amount > MAX_WITHDRAW) {
        return bot.sendMessage(chatId, `ከፍተኛው ማውጣት የምትችሉት መጠን ${MAX_WITHDRAW.toLocaleString()} ብር ነው።\n\n*እባክዎን ያነሰ መጠን ያስገቡ:*`, { parse_mode: "Markdown" });
      }

      // Balance check
      try {
        const user = await getOrCreateUser(userId, msg.from?.username || "", msg.from?.first_name, msg.from?.last_name);
        const currentBalance = user ? Number(user.balance) : 0;

        if (amount > currentBalance) {
          return bot.sendMessage(chatId, `❌ *በቂ ባላንስ የለዎትም!*\n\n💳 *የእርስዎ ባላንስ:* ${currentBalance.toLocaleString()} ብር\n💰 *የጠየቁት መጠን:* ${amount.toLocaleString()} ብር\n\n_እባክዎን ያነሰ መጠን ያስገቡ:_`, { parse_mode: "Markdown" });
        }

        userStates.set(userId, {
          step: 'withdraw_bank',
          amount
        });

        // Prompt bank selection
        const bk = promptsConfig.banks;
        return bot.sendMessage(chatId, "እባክዎን የሚያወጡበትን ባንክ ይምረጡ።", {
          reply_markup: {
            inline_keyboard: [
              [
                { text: bk["Telebirr"]?.name || "📱 Telebirr", callback_data: `wd_bank_Telebirr` },
                { text: bk["CBE"]?.name || "🏦 CBE (የኢትዮጵያ ንግድ ባንክ)", callback_data: `wd_bank_CBE` }
              ],
              [
                { text: bk["Abyssinia"]?.name || "🏦 Abyssinia Bank", callback_data: `wd_bank_Abyssinia` },
                { text: bk["Dashen"]?.name || "🏦 Dashen Bank", callback_data: `wd_bank_Dashen` }
              ]
            ]
          }
        });

      } catch (err) {
        console.error("Balance lookup failed:", err);
        return bot.sendMessage(chatId, "An error occurred lookup your balance. Try again.");
      }
    }

    // 4. WITHDRAWAL: ACCOUNT / PHONE ENTRY
    if (state.step === 'withdraw_account') {
      const amount = state.amount || 100;
      const bank = state.bank || "Telebirr";
      const username = msg.from?.username || "no_username";
      const fullName = `${msg.from?.first_name || ""} ${msg.from?.last_name || ""}`.trim() || "Player";

      try {
        // Prevent double spending by deducting balance IMMEDIATELY upon request
        const user = await getOrCreateUser(userId, msg.from?.username || "", msg.from?.first_name, msg.from?.last_name);
        const currentBalance = user ? Number(user.balance) : 0;

        if (currentBalance < amount) {
          userStates.set(userId, { step: 'idle' });
          return bot.sendMessage(chatId, "❌ *በቂ ባላንስ የለዎትም!* Withdrawal request cancelled.", { parse_mode: "Markdown" });
        }

        const newBalance = currentBalance - amount;
        await supabase.from('users').update({ balance: newBalance }).eq('id', userId);

        // Generate unique request code
        const requestId = "WD_" + generateRef(8);

        pendingRequests.set(requestId, {
          id: requestId,
          type: 'withdraw',
          userId,
          username,
          fullName,
          amount,
          bank,
          account: text,
          chatId
        });

        // Notify User
        const successMsgText = promptsConfig.withdraw_success_msg.replace(/{amount}/g, amount.toLocaleString());
        bot.sendMessage(chatId, successMsgText, { parse_mode: "Markdown" });

        // Push real-time balance update to socket clients instantly
        io.emit('balanceUpdated', { userId, balance: newBalance });

        // Clear user active state
        userStates.set(userId, { step: 'idle' });

        // Notify starting admin if admin list is empty (failsafe)
        if (adminChatIds.size === 0) {
          adminChatIds.add(getPrimaryOwnerId());
        }

        // Notify Admins
        const adminMsg = `📤 *NEW WITHDRAWAL REQUEST*\n\n` +
          `👤 *User:* @${username} (${fullName})\n` +
          `🆔 *User ID:* \`${userId}\`\n` +
          `💰 *Amount:* *${amount.toLocaleString()} ETB*\n` +
          `🏦 *Bank:* *${bank}*\n` +
          `💳 *Account/Phone:* \`${text}\`\n\n` +
          `*Request ID:* \`${requestId}\``;

        adminChatIds.forEach(adminId => {
          bot.sendMessage(adminId, adminMsg, {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "Approve ✅", callback_data: `approve_wd_${requestId}` },
                  { text: "Decline ❌", callback_data: `decline_wd_${requestId}` }
                ]
              ]
            }
          }).catch(e => console.error(`Failed to notify admin ${adminId} of withdrawal:`, e));
        });

      } catch (err) {
        console.error("Deducting balance for withdrawal request failed:", err);
        bot.sendMessage(chatId, "⚠️ Failed to submit withdrawal request. Please retry.");
      }
    }

    // 5. WELCOME BUTTON: EDIT LABEL
    if (state.step === 'awaiting_wbtn_label_change') {
      if (!numUserId || !isStartingAdmin(numUserId)) return;
      const rIndex = state.row;
      const cIndex = state.col;
      if (rIndex !== undefined && cIndex !== undefined && promptsConfig.welcome_buttons?.[rIndex]?.[cIndex]) {
        promptsConfig.welcome_buttons[rIndex][cIndex].text = text;
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ <b>Successfully updated welcome button label to: "${text}"</b>`, { parse_mode: "HTML" });
        
        // Return to welcome buttons panel
        const buttons = promptsConfig.welcome_buttons || [];
        let pText = "🔘 <b>Welcome Buttons Editor</b>\n\nThese are the buttons shown below your Welcome Message for players:\n\n";
        const inlineKeyboard: any[] = [];
        buttons.forEach((row, rIdx) => {
          const rowButtons: any[] = [];
          row.forEach((btn, cIdx) => {
            pText += `• Row ${rIdx + 1}, Col ${cIdx + 1}: <b>"${btn.text}"</b> (Type: <code>${btn.type}</code>)\n`;
            rowButtons.push({
              text: `✏️ Row ${rIdx + 1} Col ${cIdx + 1}: ${btn.text}`,
              callback_data: `edit_wbtn_click_${rIdx}_${cIdx}`
            });
          });
          inlineKeyboard.push(rowButtons);
        });
        inlineKeyboard.push([{ text: "➕ Add New Button", callback_data: "edit_wbtn_add" }]);
        inlineKeyboard.push([{ text: "🔙 Back", callback_data: "control_edit" }]);
        await bot.sendMessage(chatId, pText, { parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } });
      }
      return;
    }

    // 6. WELCOME BUTTON: EDIT URL
    if (state.step === 'awaiting_wbtn_url_change') {
      if (!numUserId || !isStartingAdmin(numUserId)) return;
      const rIndex = state.row;
      const cIndex = state.col;
      if (rIndex !== undefined && cIndex !== undefined && promptsConfig.welcome_buttons?.[rIndex]?.[cIndex]) {
        promptsConfig.welcome_buttons[rIndex][cIndex].type = 'url';
        promptsConfig.welcome_buttons[rIndex][cIndex].value = text;
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ <b>Successfully updated button link URL to: "${text}"</b>`, { parse_mode: "HTML" });
        
        // Return to welcome buttons panel
        const buttons = promptsConfig.welcome_buttons || [];
        let pText = "🔘 <b>Welcome Buttons Editor</b>\n\nThese are the buttons shown below your Welcome Message for players:\n\n";
        const inlineKeyboard: any[] = [];
        buttons.forEach((row, rIdx) => {
          const rowButtons: any[] = [];
          row.forEach((btn, cIdx) => {
            pText += `• Row ${rIdx + 1}, Col ${cIdx + 1}: <b>"${btn.text}"</b> (Type: <code>${btn.type}</code>)\n`;
            rowButtons.push({
              text: `✏️ Row ${rIdx + 1} Col ${cIdx + 1}: ${btn.text}`,
              callback_data: `edit_wbtn_click_${rIdx}_${cIdx}`
            });
          });
          inlineKeyboard.push(rowButtons);
        });
        inlineKeyboard.push([{ text: "➕ Add New Button", callback_data: "edit_wbtn_add" }]);
        inlineKeyboard.push([{ text: "🔙 Back", callback_data: "control_edit" }]);
        await bot.sendMessage(chatId, pText, { parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } });
      }
      return;
    }

    // 7. WELCOME BUTTON: ADD LABEL
    if (state.step === 'awaiting_wbtn_add_label') {
      if (!numUserId || !isStartingAdmin(numUserId)) return;
      userStates.set(userId, {
        step: 'idle',
        new_label: text
      });
      const choiceText = `🔧 <b>Select Button Type for "${text}":</b>\n\nChoose what this button should do when clicked:`;
      const keyboard = {
        inline_keyboard: [
          [{ text: "🎮 Play WebApp Game", callback_data: `add_wbtn_type_webapp` }],
          [{ text: "💳 Callback Deposit Flow", callback_data: `add_wbtn_type_cb_dep` }],
          [{ text: "🏦 Callback Withdraw Flow", callback_data: `add_wbtn_type_cb_wd` }],
          [{ text: "📞 Callback Support Flow", callback_data: `add_wbtn_type_cb_sup` }],
          [{ text: "🔗 Custom URL Link", callback_data: `add_wbtn_type_url` }],
          [{ text: "🔙 Cancel", callback_data: `edit_section_welcome_buttons` }]
        ]
      };
      await bot.sendMessage(chatId, choiceText, { parse_mode: "HTML", reply_markup: keyboard });
      return;
    }

    // 8. WELCOME BUTTON: ADD URL
    if (state.step === 'awaiting_wbtn_add_url') {
      if (!numUserId || !isStartingAdmin(numUserId)) return;
      const label = state.new_label || "New Button";
      if (!promptsConfig.welcome_buttons) promptsConfig.welcome_buttons = [];
      promptsConfig.welcome_buttons.push([{ text: label, type: 'url', value: text }]);
      savePromptsConfig(promptsConfig);
      userStates.set(userId, { step: 'idle' });
      await bot.sendMessage(chatId, `✅ <b>Successfully added new button with URL!</b>`, { parse_mode: "HTML" });
      
      // Return to welcome buttons panel
      const buttons = promptsConfig.welcome_buttons || [];
      let pText = "🔘 <b>Welcome Buttons Editor</b>\n\nThese are the buttons shown below your Welcome Message for players:\n\n";
      const inlineKeyboard: any[] = [];
      buttons.forEach((row, rIdx) => {
        const rowButtons: any[] = [];
        row.forEach((btn, cIdx) => {
          pText += `• Row ${rIdx + 1}, Col ${cIdx + 1}: <b>"${btn.text}"</b> (Type: <code>${btn.type}</code>)\n`;
          rowButtons.push({
            text: `✏️ Row ${rIdx + 1} Col ${cIdx + 1}: ${btn.text}`,
            callback_data: `edit_wbtn_click_${rIdx}_${cIdx}`
          });
        });
        inlineKeyboard.push(rowButtons);
      });
      inlineKeyboard.push([{ text: "➕ Add New Button", callback_data: "edit_wbtn_add" }]);
      inlineKeyboard.push([{ text: "🔙 Back", callback_data: "control_edit" }]);
      await bot.sendMessage(chatId, pText, { parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } });
      return;
    }

    // 9. CUSTOM COMMAND: REGISTER NAME
    if (state.step === 'awaiting_ccmd_name') {
      if (!numUserId || !isStartingAdmin(numUserId)) return;
      const cmdName = text.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!cmdName) {
        return bot.sendMessage(chatId, "❌ <b>Invalid command name.</b> Please send a single word with lowercase letters/numbers only:");
      }
      if (promptsConfig.custom_commands?.[cmdName] || ['start', 'play', 'balance', 'deposit', 'withdraw', 'referral', 'affiliate', 'promoter_leaderboard', 'support', 'language', 'cancel'].includes(cmdName)) {
        return bot.sendMessage(chatId, `❌ Command name <b>/${cmdName}</b> is already taken or reserved. Please enter a different command name:`, { parse_mode: "HTML" });
      }

      if (!promptsConfig.custom_commands) promptsConfig.custom_commands = {};
      promptsConfig.custom_commands[cmdName] = {
        command: cmdName,
        description: "Custom dynamic command",
        text: "Default response text. Please edit this message.",
        buttons: []
      };
      savePromptsConfig(promptsConfig);

      // Register with telegram bot commands menu
      try {
        const systemCommands = [
          { command: "start", description: "Launch the game hub and display menu" },
          { command: "play", description: "Launch the Web App immediately" },
          { command: "balance", description: "Check your current wallet balance" },
          { command: "deposit", description: "Deposit ETB into your balance" },
          { command: "withdraw", description: "Withdraw ETB from your balance" },
          { command: "referral", description: "Invite friends and earn rewards" },
          { command: "affiliate", description: "View your affiliate dashboard and earnings" },
          { command: "promoter_leaderboard", description: "View Weekly Promoter Leaderboard" },
          { command: "support", description: "Show contact support details" },
          { command: "language", description: "Change bot language" },
          { command: "cancel", description: "Cancel current operation or active flows" }
        ];

        const customCommandsList = Object.entries(promptsConfig.custom_commands || {}).map(([cmd, cfg]) => ({
          command: cmd,
          description: cfg.description || "Custom command"
        }));

        try {
          await bot.setMyCommands([...systemCommands, ...customCommandsList]);
          logBot("Bot commands updated successfully (new command).");
        } catch (err: any) {
          logBot(`Failed to set Telegram commands: ${err.message}`);
        }
      } catch (err: any) {
        logBot(`Error in outer re-sync registration: ${err.message}`);
      }

      userStates.set(userId, { step: 'idle' });
      await bot.sendMessage(chatId, `✅ Successfully registered command <b>/${cmdName}</b>!`, { parse_mode: "HTML" });
      await sendCustomCommandEditMenu(chatId, cmdName);
      return;
    }

    // 10. CUSTOM COMMAND: VAL CHANGE
    if (state.step === 'awaiting_ccmd_val_change') {
      if (!numUserId || !isStartingAdmin(numUserId)) return;
      const cmdName = state.cmd_name;
      const field = state.field;
      if (cmdName && field && promptsConfig.custom_commands?.[cmdName]) {
        if (field === 'text') {
          promptsConfig.custom_commands[cmdName].text = text;
        } else if (field === 'desc') {
          promptsConfig.custom_commands[cmdName].description = text;
          
          // Re-sync command menu so description is immediately updated
          try {
            const systemCommands = [
              { command: "start", description: "Launch the game hub and display menu" },
              { command: "play", description: "Launch the Web App immediately" },
              { command: "balance", description: "Check your current wallet balance" },
              { command: "deposit", description: "Deposit ETB into your balance" },
              { command: "withdraw", description: "Withdraw ETB from your balance" },
              { command: "referral", description: "Invite friends and earn rewards" },
              { command: "affiliate", description: "View your affiliate dashboard and earnings" },
              { command: "promoter_leaderboard", description: "View Weekly Promoter Leaderboard" },
              { command: "support", description: "Show contact support details" },
              { command: "language", description: "Change bot language" },
              { command: "cancel", description: "Cancel current operation or active flows" }
            ];

            const customCommandsList = Object.entries(promptsConfig.custom_commands || {}).map(([cmd, cfg]) => ({
              command: cmd,
              description: cfg.description || "Custom command"
            }));

            try {
              await bot.setMyCommands([...systemCommands, ...customCommandsList]);
              logBot("Bot commands updated successfully (desc update).");
            } catch (err: any) {
              logBot(`Failed to set Telegram commands: ${err.message}`);
            }
          } catch (err: any) {
            logBot(`Error in outer re-sync: ${err.message}`);
          }
        } else if (field === 'photo') {
          let photoVal = text;
          if (msg.photo && msg.photo.length > 0) {
            photoVal = msg.photo[msg.photo.length - 1].file_id;
          }
          promptsConfig.custom_commands[cmdName].photo = photoVal;
        }
        
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Updated <b>/${cmdName}</b> property <b>"${field}"</b>!`, { parse_mode: "HTML" });
        await sendCustomCommandEditMenu(chatId, cmdName);
      }
      return;
    }

    // 11. CUSTOM COMMAND BUTTON: EDIT LABEL
    if (state.step === 'awaiting_cc_btn_label_change') {
      if (!numUserId || !isStartingAdmin(numUserId)) return;
      const cmdName = state.cmd_name;
      const rIndex = state.row;
      const cIndex = state.col;
      if (cmdName && rIndex !== undefined && cIndex !== undefined && promptsConfig.custom_commands?.[cmdName]?.buttons?.[rIndex]?.[cIndex]) {
        promptsConfig.custom_commands[cmdName].buttons[rIndex][cIndex].text = text;
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully updated button label!`, { parse_mode: "HTML" });
        await sendCustomCommandButtonsPanel(chatId, cmdName);
      }
      return;
    }

    // 12. CUSTOM COMMAND BUTTON: ADD LABEL
    if (state.step === 'awaiting_cc_btn_add_label') {
      if (!numUserId || !isStartingAdmin(numUserId)) return;
      const cmdName = state.cmd_name;
      if (cmdName) {
        userStates.set(userId, {
          step: 'idle',
          cmd_name: cmdName,
          new_label: text
        });
        const choiceText = `🔧 <b>Select Button Type for "${text}":</b>\n\nChoose what this button should do when clicked:`;
        const keyboard = {
          inline_keyboard: [
            [{ text: "🎮 Play WebApp Game", callback_data: `cc_add_type_${cmdName}_webapp` }],
            [{ text: "💳 Callback Deposit Flow", callback_data: `cc_add_type_${cmdName}_cb_dep` }],
            [{ text: "🏦 Callback Withdraw Flow", callback_data: `cc_add_type_${cmdName}_cb_wd` }],
            [{ text: "📞 Callback Support Flow", callback_data: `cc_add_type_${cmdName}_cb_sup` }],
            [{ text: "🔗 Custom URL Link", callback_data: `cc_add_type_${cmdName}_url` }],
            [{ text: "🔙 Cancel", callback_data: `ccmd_val_${cmdName}_buttons` }]
          ]
        };
        await bot.sendMessage(chatId, choiceText, { parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    // 13. CUSTOM COMMAND BUTTON: ADD URL
    if (state.step === 'awaiting_cc_btn_add_url') {
      if (!numUserId || !isStartingAdmin(numUserId)) return;
      const cmdName = state.cmd_name;
      const label = state.new_label || "New Button";
      if (cmdName && promptsConfig.custom_commands?.[cmdName]) {
        if (!promptsConfig.custom_commands[cmdName].buttons) {
          promptsConfig.custom_commands[cmdName].buttons = [];
        }
        promptsConfig.custom_commands[cmdName].buttons.push([{ text: label, type: 'url', value: text }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}" with URL!`, { parse_mode: "HTML" });
        await sendCustomCommandButtonsPanel(chatId, cmdName);
      }
      return;
    }

    // 14. REFERRAL BUTTON: EDIT LABEL
    if (state.step === 'awaiting_refbtn_label_change') {
      if (!numUserId || !isStartingAdmin(numUserId)) return;
      const rIndex = state.row;
      const cIndex = state.col;
      if (rIndex !== undefined && cIndex !== undefined && promptsConfig.referral_buttons?.[rIndex]?.[cIndex]) {
        promptsConfig.referral_buttons[rIndex][cIndex].text = text;
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully updated referral button label to <b>"${text}"</b>!`, { parse_mode: "HTML" });
        await bot.sendMessage(chatId, "🤝 <b>Referral Buttons Editor</b>", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons Panel", callback_data: "edit_section_referral_buttons" }]]
          }
        });
      }
      return;
    }

    // 15. REFERRAL BUTTON: EDIT URL
    if (state.step === 'awaiting_refbtn_url_change') {
      if (!numUserId || !isStartingAdmin(numUserId)) return;
      const rIndex = state.row;
      const cIndex = state.col;
      if (rIndex !== undefined && cIndex !== undefined && promptsConfig.referral_buttons?.[rIndex]?.[cIndex]) {
        promptsConfig.referral_buttons[rIndex][cIndex].value = text;
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully updated referral button share URL to <code>${text}</code>!`, { parse_mode: "HTML" });
        await bot.sendMessage(chatId, "🤝 <b>Referral Buttons Editor</b>", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons Panel", callback_data: "edit_section_referral_buttons" }]]
          }
        });
      }
      return;
    }

    // 16. REFERRAL BUTTON: ADD LABEL
    if (state.step === 'awaiting_refbtn_add_label') {
      if (!numUserId || !isStartingAdmin(numUserId)) return;
      userStates.set(userId, {
        ...state,
        step: 'awaiting_refbtn_add_url',
        new_label: text
      });
      await bot.sendMessage(chatId, `✍️ <b>Now enter the share URL link for "${text}":</b>\n\nExample: <code>https://t.me/share/url?url=https://t.me/{bot_username}?start={user_id}&text=Join now!</code>`, { parse_mode: "HTML" });
      return;
    }

    // 17. REFERRAL BUTTON: ADD URL
    if (state.step === 'awaiting_refbtn_add_url') {
      if (!numUserId || !isStartingAdmin(numUserId)) return;
      const label = state.new_label || "New Button";
      if (!promptsConfig.referral_buttons) promptsConfig.referral_buttons = [];
      promptsConfig.referral_buttons.push([{ text: label, type: 'url', value: text }]);
      savePromptsConfig(promptsConfig);
      userStates.set(userId, { step: 'idle' });
      await bot.sendMessage(chatId, `✅ Successfully added new referral button <b>"${label}"</b>!`, { parse_mode: "HTML" });
      await bot.sendMessage(chatId, "🤝 <b>Referral Buttons Panel</b>", {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_referral_buttons" }]]
        }
      });
      return;
    }
  });

  // --- CONTACT REGISTER HANDLER ---
  bot.on("contact", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    const contact = msg.contact;

    if (!userId || !contact) return;

    // Validate that the shared contact is actually their own
    if (contact.user_id && contact.user_id.toString() !== userId) {
      return bot.sendMessage(chatId, "⚠️ <b>Validation Error:</b> Please share your own contact to register.", { parse_mode: "HTML" });
    }

    const username = msg.from?.username || "";
    const firstName = msg.from?.first_name || "";
    const lastName = msg.from?.last_name || "";
    const phoneNumber = contact.phone_number;

    // Fetch profile picture if available
    let photoUrl = "";
    try {
      const photosRes = await bot.getUserProfilePhotos(msg.from.id, { limit: 1 });
      if (photosRes && photosRes.total_count > 0 && photosRes.photos.length > 0) {
        const fileId = photosRes.photos[0][0].file_id;
        const file = await bot.getFile(fileId);
        if (file && file.file_path) {
          photoUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        }
      }
    } catch (photoErr: any) {
      logBot(`Failed to fetch profile photo for user ${msg.from.id}: ${photoErr.message}`);
    }

    try {
      // Create user record in Supabase
      const upsertData: any = {
        id: userId,
        username: username || null,
        first_name: firstName || null,
        last_name: lastName || null,
        phone: phoneNumber || null,
        photo_url: photoUrl || null,
        balance: 100000 // Starting balance
      };

      let { data: insertedUser, error: insertError } = await supabase
        .from('users')
        .upsert(upsertData, { onConflict: 'id' })
        .select()
        .single();

      // If the schema cache is missing the 'phone' column, retry without the 'phone' column
      if (insertError && (insertError.message.includes("phone") || insertError.message.includes("schema cache"))) {
        logBot(`User registration: database 'phone' column is not yet activated. Registering user without saving phone number.`);
        delete upsertData.phone;
        const retryRes = await supabase
          .from('users')
          .upsert(upsertData, { onConflict: 'id' })
          .select()
          .single();
        insertedUser = retryRes.data;
        insertError = retryRes.error;
      }

      if (insertError) {
        logBot(`Error inserting new user ${userId}: ${insertError.message}`);
        return bot.sendMessage(chatId, "❌ <b>Database error:</b> Could not complete registration. Please try again or contact support.", { parse_mode: "HTML" });
      }

      // Remove the custom contact keyboard
      await bot.sendMessage(chatId, "✅ <b>Contact verified successfully!</b>", {
        parse_mode: "HTML",
        reply_markup: {
          remove_keyboard: true
        }
      });

      // Show warm greeting and all commands with inline menu buttons
      const welcomeMsgPattern = promptsConfig.welcome_msg || 
        `👋 *Welcome to ETB Game Hub, {name}!* 🎮\n\n` +
        `Experience the thrill of real-time multiplayer gaming right here in Telegram!\n\n` +
        `💰 *Your current balance:* \`{balance}\`\n\n` +
        `🚀 *Available Games:*\n` +
        `• 🟢 *Even/Odd* - High-octane multipliers and double-ups\n` +
        `• 🏆 *Jackpot Arena* - Secure spots and sweep the pool prize\n` +
        `• 🎡 *Wheel of Chance* - High stakes wheel of fortune\n\n` +
        `👇 Click the button below to launch the Mini App and start playing immediately!`;
        
      const greetingMsg = welcomeMsgPattern
        .replace(/{name}/g, firstName)
        .replace(/{balance}/g, "100,000 ETB");

      const welcomeButtonsRows = (promptsConfig.welcome_buttons || [
        [
          { text: "🎮 Play Game Hub 🚀", type: "webapp", value: "appUrl" }
        ],
        [
          { text: "💸 Deposit / ማስገቢያ", type: "callback", value: "menu_deposit" },
          { text: "🏦 Withdraw / ማውጫ", type: "callback", value: "menu_withdraw" }
        ],
        [
          { text: "📞 Contact Support", type: "callback", value: "menu_support" }
        ]
      ]).map(row => 
        row.map(btn => {
          const btnVal = btn.value === 'appUrl' ? appUrl : btn.value;
          if (btn.type === 'webapp') {
            return { text: btn.text, web_app: { url: btnVal } };
          } else if (btn.type === 'url') {
            return { text: btn.text, url: btnVal };
          } else {
            return { text: btn.text, callback_data: btnVal };
          }
        })
      );

      await bot.sendMessage(chatId, greetingMsg, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: welcomeButtonsRows
        }
      });

      // Process pending deep link payload if any
      const pendingReg = pendingRegistrations.get(userId);
      if (pendingReg && pendingReg.payload) {
        if (pendingReg.payload === 'deposit') {
          startDepositFlow(chatId, userId);
        } else if (pendingReg.payload === 'withdraw') {
          startWithdrawalFlow(chatId, userId);
        } else if (pendingReg.payload.startsWith('ref_')) {
          const referrerId = pendingReg.payload.replace('ref_', '');
          if (referrerId !== userId) {
            await supabase.from('transactions').insert({
              user_id: userId,
              amount: 0,
              type: 'referral_link',
              description: `Referred by ${referrerId}`
            });
            bot.sendMessage(chatId, `🎉 <b>Welcome! You were invited by ID: ${referrerId}</b>`, { parse_mode: "HTML" });
            bot.sendMessage(referrerId, `🎉 <b>New Referral!</b>\n\nUser <code>${userId}</code> joined using your link! You will earn a 1% passive commission on their bets.`, { parse_mode: "HTML" }).catch(() => {});
          }
        }
      }
      pendingRegistrations.delete(userId);

    } catch (err: any) {
      logBot(`Unexpected error during user registration for ${userId}: ${err.message}`);
      bot.sendMessage(chatId, "❌ An unexpected error occurred. Please try again.", { parse_mode: "HTML" });
    }
  });

  // --- CALLBACK QUERY DISPATCHER ---
  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat.id || query.from.id;
    const messageId = query.message?.message_id;
    const userId = query.from.id.toString();
    const data = query.data;

    if (!data) {
      try {
        await bot.answerCallbackQuery(query.id);
      } catch (err) {
        console.error("Empty callback answer failed:", err);
      }
      return;
    }

    try {
      logBot(`[Callback Query] data=${data} user=${userId} chat=${chatId}`);

      // Update last_seen in background
      supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', userId).then(({ error }) => { if (error) console.error(error); });

    if (data?.startsWith("analysis_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner Only", show_alert: true });
        return;
      }
      const timeframe = data.split("_")[1] as 'day' | 'week' | 'month' | 'year';
      try {
        await bot.answerCallbackQuery(query.id);
        const summary = await getAnalysisSummary(timeframe);
        
        const gamesStats = Object.entries(summary.gamesCount)
          .map(([game, count]) => `• <b>${escapeHTML(game)}</b>: ${count}`)
          .join('\n');
          
        const text = `📊 <b>Financial Summary (${timeframe.toUpperCase()})</b>\n\n` +
          `💰 Total Deposits: <b>${summary.totalDeposits.toLocaleString()} ETB</b>\n` +
          `💸 Total Withdrawals: <b>${summary.totalWithdrawals.toLocaleString()} ETB</b>\n` +
          `💳 Cash Flow (D-W): <b>${summary.totalRevenue.toLocaleString()} ETB</b>\n\n` +
          `🎮 <b>Game Performance:</b>\n` +
          `🎰 Total Bets: <b>${summary.totalBets.toLocaleString()} ETB</b>\n` +
          `🏆 Total Wins: <b>${summary.totalWins.toLocaleString()} ETB</b>\n` +
          `📈 House GGR: <b>${summary.netProfit.toLocaleString()} ETB</b>\n\n` +
          `🕹️ <b>Game Activity:</b>\n${gamesStats || '<i>No games played</i>'}`;
        
        if (messageId) {
          await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "📅 Day", callback_data: "analysis_day" },
                  { text: "🗓️ Week", callback_data: "analysis_week" }
                ],
                [
                  { text: "📆 Month", callback_data: "analysis_month" },
                  { text: "📅 Year", callback_data: "analysis_year" }
                ],
                [
                  { text: "🔙 Back to Control", callback_data: "control_analysis" }
                ]
              ]
            }
          });
        }
      } catch (e: any) {
        console.error("Analysis callback error:", e);
        await bot.answerCallbackQuery(query.id, { text: "❌ Error fetching data: " + (e.message || "Unknown error"), show_alert: true });
      }
      return;
    }

    if (data === "control_setadmin") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner Only", show_alert: true });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      renderSetAdminMenu(bot, chatId);
      return;
    }
    if (data === "control_analysis") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner Only", show_alert: true });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const text = "📊 <b>Select Timeframe:</b>";
      const keyboard = {
        inline_keyboard: [
          [
            { text: "📅 Day", callback_data: "analysis_day" },
            { text: "🗓️ Week", callback_data: "analysis_week" }
          ],
          [
            { text: "📆 Month", callback_data: "analysis_month" },
            { text: "📅 Year", callback_data: "analysis_year" }
          ]
        ]
      };
      
      if (messageId) {
        try {
          await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
        } catch (e) {
          await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
        }
      } else {
        await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }
    if (data === "control_broadcast") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner Only", show_alert: true });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const composer = { step: 'choose_target' as const };
      await renderBroadcastDashboard(bot, chatId, userId, composer);
      return;
    }

    if (data === "control_autocamp") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      await renderAutoCampaignDashboard(chatId, messageId);
      return;
    }

    if (data === "control_ai_instructions") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      await renderAIInstructionsPanel(chatId, messageId);
      return;
    }

    if (data === "control_ai_edit") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      userStates.set(userId, { step: "editing_ai_instructions" });
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, "📝 <b>Edit AI System Instructions</b>\n\nPlease send the new system instructions for the AI Support Assistant.\n\n<i>This will define how the AI behaves, what it knows about the game, and its safety rules.</i>\n\nType /cancel to abort.", { parse_mode: "HTML" });
      return;
    }

    if (data === "control_user_lookup") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      await renderUserLookupPanel(chatId, messageId);
      return;
    }

    if (data?.startsWith("lookup_user:")) {
      if (!adminChatIds.has(parseInt(userId, 10))) return;
      const targetId = data.split(":")[1];
      await bot.answerCallbackQuery(query.id);
      await processUserLookup(chatId, targetId);
      return;
    }

    if (data === "lookup_manual_search") {
      if (!adminChatIds.has(parseInt(userId, 10))) return;
      userStates.set(userId, { step: "waiting_for_lookup_id" });
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, "🔍 <b>Manual Search</b>\n\nPlease send the <b>Telegram ID</b> or <b>@username</b> of the user you want to investigate.\n\nType /cancel to abort.", { parse_mode: "HTML" });
      return;
    }

    if (data === "autocamp_toggle") {
      if (!isStartingAdmin(parseInt(userId, 10))) return;
      const config = loadAutoCampaignConfig();
      config.isEnabled = !config.isEnabled;
      saveAutoCampaignConfig(config);
      await bot.answerCallbackQuery(query.id, { text: config.isEnabled ? "🟢 Activated!" : "🔴 Paused!" });
      await renderAutoCampaignDashboard(chatId, messageId);
      return;
    }

    if (data === "autocamp_prompts_list" || data === "autocamp_edit_msg") {
      if (!isStartingAdmin(parseInt(userId, 10))) return;
      await bot.answerCallbackQuery(query.id);
      await renderPromptsListDashboard(chatId, messageId);
      return;
    }

    if (data === "autocamp_p_add") {
      if (!isStartingAdmin(parseInt(userId, 10))) return;
      await bot.answerCallbackQuery(query.id);
      userStates.set(userId, { step: "autocamp_await_add_prompt" });
      await bot.sendMessage(chatId, "📝 <b>Please type and send your new campaign prompt:</b>\n\n<i>Use placeholders like {name} and {balance}.</i>\n\nType /cancel to abort.", { parse_mode: "HTML" });
      return;
    }

    if (data?.startsWith("autocamp_p_view_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) return;
      const pId = data.replace("autocamp_p_view_", "");
      await bot.answerCallbackQuery(query.id);
      await renderPromptDetailsDashboard(chatId, pId, messageId);
      return;
    }

    if (data?.startsWith("autocamp_p_activate_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) return;
      const pId = data.replace("autocamp_p_activate_", "");
      const config = loadAutoCampaignConfig();
      config.activePromptId = pId;
      saveAutoCampaignConfig(config);
      await bot.answerCallbackQuery(query.id, { text: "🎯 Activated template!" });
      await renderPromptDetailsDashboard(chatId, pId, messageId);
      return;
    }

    if (data?.startsWith("autocamp_p_edit_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) return;
      const pId = data.replace("autocamp_p_edit_", "");
      await bot.answerCallbackQuery(query.id);
      userStates.set(userId, { step: "autocamp_await_edit_prompt_text", editingPromptId: pId });
      await bot.sendMessage(chatId, "📝 <b>Type and send the updated text content for this prompt template:</b>\n\nType /cancel to abort.", { parse_mode: "HTML" });
      return;
    }

    if (data?.startsWith("autocamp_p_delete_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) return;
      const pId = data.replace("autocamp_p_delete_", "");
      const config = loadAutoCampaignConfig();
      const prompts = config.prompts || [];
      if (prompts.length <= 1) {
        await bot.answerCallbackQuery(query.id, { text: "⚠️ You must keep at least 1 prompt template!", show_alert: true });
        return;
      }
      config.prompts = prompts.filter((p: any) => p.id !== pId);
      if (config.activePromptId === pId) {
        config.activePromptId = config.prompts[0].id;
      }
      saveAutoCampaignConfig(config);
      await bot.answerCallbackQuery(query.id, { text: "🗑️ Prompt template deleted successfully!" });
      await renderPromptsListDashboard(chatId, messageId);
      return;
    }

    if (data === "autocamp_set_target") {
      if (!isStartingAdmin(parseInt(userId, 10))) return;
      await bot.answerCallbackQuery(query.id);
      const keyboard = {
        inline_keyboard: [
          [{ text: "👥 All Registered Players", callback_data: "autocamp_target_all" }],
          [{ text: "💰 High Balancers / Whales", callback_data: "autocamp_target_whales" }],
          [{ text: "⚡ Active Players (with history)", callback_data: "autocamp_target_active" }],
          [{ text: "🔙 Back to Scheduler", callback_data: "control_autocamp" }]
        ]
      };
      await bot.editMessageText("🎯 <b>Select target audience for automated campaign:</b>", { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      return;
    }

    if (data?.startsWith("autocamp_target_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) return;
      const target = data.replace("autocamp_target_", "");
      const config = loadAutoCampaignConfig();
      config.targetCategory = target;
      saveAutoCampaignConfig(config);
      await bot.answerCallbackQuery(query.id, { text: `Target set to: ${target}` });
      await renderAutoCampaignDashboard(chatId, messageId);
      return;
    }

    if (data === "autocamp_set_days") {
      if (!isStartingAdmin(parseInt(userId, 10))) return;
      await bot.answerCallbackQuery(query.id);
      userStates.set(userId, { step: "autocamp_await_days" });
      await bot.sendMessage(chatId, "💤 <b>Type and send the minimum number of inactive days:</b>\n\n<i>Example: type <code>3</code> to target players who haven't visited for 3+ days. (0 for no limit)</i>", { parse_mode: "HTML" });
      return;
    }

    if (data === "autocamp_set_bal") {
      if (!isStartingAdmin(parseInt(userId, 10))) return;
      await bot.answerCallbackQuery(query.id);
      const keyboard = {
        inline_keyboard: [
          [{ text: "📉 Balance is Less Than (<)", callback_data: "autocamp_balop_less" }],
          [{ text: "📈 Balance is Greater Than (>)", callback_data: "autocamp_balop_greater" }],
          [{ text: "❌ Disable Balance Filter (Any)", callback_data: "autocamp_balop_any" }],
          [{ text: "🔙 Back to Scheduler", callback_data: "control_autocamp" }]
        ]
      };
      await bot.editMessageText("🏦 <b>Select balance condition operator:</b>", { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      return;
    }

    if (data?.startsWith("autocamp_balop_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) return;
      const op = data.replace("autocamp_balop_", "");
      const config = loadAutoCampaignConfig();
      config.balanceThresholdOperator = op === 'any' ? 'any' : op === 'less' ? 'less_than' : 'greater_than';
      saveAutoCampaignConfig(config);
      await bot.answerCallbackQuery(query.id);
      if (op === 'any') {
        await renderAutoCampaignDashboard(chatId, messageId);
      } else {
        userStates.set(userId, { step: "autocamp_await_bal" });
        await bot.sendMessage(chatId, "💰 <b>Type and send the threshold balance amount (in ETB):</b>", { parse_mode: "HTML" });
      }
      return;
    }

    if (data === "autocamp_set_hours") {
      if (!isStartingAdmin(parseInt(userId, 10))) return;
      await bot.answerCallbackQuery(query.id);
      userStates.set(userId, { step: "autocamp_await_hours" });
      await bot.sendMessage(chatId, "⏱️ <b>Type and send the send interval frequency in Hours:</b>\n\n<i>Example: type <code>24</code> to check and send campaigns once every day.</i>", { parse_mode: "HTML" });
      return;
    }

    if (data === "autocamp_test") {
      if (!isStartingAdmin(parseInt(userId, 10))) return;
      const config = loadAutoCampaignConfig();
      const activePrompt = config.prompts?.find((p: any) => p.id === config.activePromptId) || config.prompts?.[0] || { text: "None configured." };
      try {
        const customizedText = activePrompt.text
          .replace(/{name}/g, escapeHTML(query.from.username || query.from.first_name || "Admin"))
          .replace(/{balance}/g, "150,000");
          
        await bot.sendMessage(chatId, `🧪 <b>TEST PREVIEW:</b>\n\n${customizedText}`, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🎮 Play Game Hub 🚀", web_app: { url: appUrl } }]
            ]
          }
        }).catch(async (e: any) => {
          // Fallback to plain text for test
          await bot.sendMessage(chatId, `🧪 <b>TEST PREVIEW (Plain Text Fallback):</b>\n\n${customizedText}`, {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🎮 Play Game Hub 🚀", web_app: { url: appUrl } }]
              ]
            }
          });
        });
        await bot.answerCallbackQuery(query.id, { text: "✅ Preview message sent!" });
      } catch (err: any) {
        await bot.answerCallbackQuery(query.id, { text: `❌ Failed: ${err.message}`, show_alert: true });
      }
      return;
    }

    if (data === "control_edit") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      sendEditPanelMenu(chatId, messageId);
      return;
    }

    if (data === "edit_section_commands") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const text = "🤖 <b>General/Command Prompts</b>\nSelect which prompt you want to edit:";
      const keyboard = {
        inline_keyboard: [
          [{ text: "🚀 Start Command Message", callback_data: "edit_key_start_msg" }],
          [{ text: "💳 Balance Command Message", callback_data: "edit_key_balance_msg" }],
          [{ text: "🤝 Affiliate Command Message", callback_data: "edit_key_affiliate_msg" }],
          [{ text: "🔙 Back", callback_data: "control_edit" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data === "edit_section_deposit") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const text = "📥 <b>Deposit Flow Prompts</b>\nSelect which prompt or instruction you want to edit:";
      const keyboard = {
        inline_keyboard: [
          [{ text: "💰 Start Message", callback_data: "edit_key_deposit_start_msg" }],
          [{ text: "📞 Support Username/Text", callback_data: "edit_key_support_text" }],
          [{ text: "✅ Success Message", callback_data: "edit_key_deposit_success_msg" }],
          [{ text: "🎉 Approved Message", callback_data: "edit_key_deposit_approved_msg" }],
          [{ text: "❌ Declined Message", callback_data: "edit_key_deposit_declined_msg" }],
          [{ text: "🔙 Back", callback_data: "control_edit" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data === "edit_section_withdrawal") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const text = "📤 <b>Withdrawal Flow Prompts</b>\nSelect which prompt or notification you want to edit:";
      const keyboard = {
        inline_keyboard: [
          [{ text: "💰 Start Message", callback_data: "edit_key_withdraw_start_msg" }],
          [{ text: "📱 Telebirr Phone Prompt", callback_data: "edit_key_withdraw_telebirr_prompt" }],
          [{ text: "🏦 Other Bank Account Prompt", callback_data: "edit_key_withdraw_other_bank_prompt" }],
          [{ text: "✅ Success Message", callback_data: "edit_key_withdraw_success_msg" }],
          [{ text: "🎉 Approved Message", callback_data: "edit_key_withdraw_approved_msg" }],
          [{ text: "❌ Declined Message", callback_data: "edit_key_withdraw_declined_msg" }],
          [{ text: "🔙 Back", callback_data: "control_edit" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data === "edit_section_banks") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const text = "🏦 <b>Bank Accounts Detail</b>\nSelect which bank's account details/display name you want to edit:";
      const bk = promptsConfig.banks;
      const keyboard = {
        inline_keyboard: [
          [{ text: bk["Telebirr"]?.name || "📱 Telebirr", callback_data: "edit_bank_Telebirr" }],
          [{ text: bk["CBE"]?.name || "🏦 CBE", callback_data: "edit_bank_CBE" }],
          [{ text: bk["Abyssinia"]?.name || "🏦 Abyssinia Bank", callback_data: "edit_bank_Abyssinia" }],
          [{ text: bk["Dashen"]?.name || "🏦 Dashen Bank", callback_data: "edit_bank_Dashen" }],
          [{ text: "🔙 Back", callback_data: "control_edit" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data === "edit_section_welcome") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const text = "👋 <b>Welcome & Support Prompts</b>\nSelect which welcome or support prompt you want to edit:";
      const keyboard = {
        inline_keyboard: [
          [{ text: "👋 Welcome Message (Registered)", callback_data: "edit_key_welcome_msg" }],
          [{ text: "🖼️ Welcome Image (Registered)", callback_data: "edit_key_welcome_image" }],
          [{ text: "👋 Guest Welcome Message (Unregistered)", callback_data: "edit_key_welcome_guest_msg" }],
          [{ text: "🖼️ Guest Welcome Image (Unregistered)", callback_data: "edit_key_welcome_guest_image" }],
          [{ text: "📞 Support Card Message", callback_data: "edit_key_support_card_msg" }],
          [{ text: "🔙 Back", callback_data: "control_edit" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data === "edit_section_welcome_buttons") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const buttons = promptsConfig.welcome_buttons || [];
      let text = "🔘 <b>Welcome Buttons Editor</b>\n\n" +
        "These are the buttons shown below your Welcome Message for players:\n\n";
      
      const inlineKeyboard: any[] = [];
      
      if (buttons.length === 0) {
        text += "<i>No welcome buttons configured currently. Players won't see any buttons.</i>";
      } else {
        buttons.forEach((row, rIndex) => {
          const rowButtons: any[] = [];
          row.forEach((btn, cIndex) => {
            text += `• Row ${rIndex + 1}, Col ${cIndex + 1}: <b>"${btn.text}"</b> (Type: <code>${btn.type}</code>)\n`;
            rowButtons.push({
              text: `✏️ Row ${rIndex + 1} Col ${cIndex + 1}: ${btn.text}`,
              callback_data: `edit_wbtn_click_${rIndex}_${cIndex}`
            });
          });
          inlineKeyboard.push(rowButtons);
        });
      }
      
      inlineKeyboard.push([{ text: "➕ Add New Button", callback_data: "edit_wbtn_add" }]);
      inlineKeyboard.push([{ text: "🔙 Back", callback_data: "control_edit" }]);
      
      if (messageId) {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      }
      return;
    }

    if (data === "edit_section_referral") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const text = "🤝 <b>Referral Prompt Settings</b>\nSelect which aspect you want to customize:";
      const keyboard = {
        inline_keyboard: [
          [{ text: "📝 Referral Message Text", callback_data: "edit_key_referral_msg" }],
          [{ text: "🖼️ Referral Image", callback_data: "edit_key_referral_image" }],
          [{ text: "📤 Referral Share Text", callback_data: "edit_key_referral_share_text" }],
          [{ text: "🖼️ Referral Share Image", callback_data: "edit_key_referral_share_image" }],
          [{ text: "🔘 Referral Buttons Menu", callback_data: "edit_section_referral_buttons" }],
          [{ text: "🔙 Back", callback_data: "control_edit" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data === "edit_section_referral_buttons") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const buttons = promptsConfig.referral_buttons || [];
      let text = "🔘 <b>Referral Buttons Editor</b>\n\nThese are the buttons shown below your Referral Message for players:\n\n";
      const inlineKeyboard: any[] = [];
      
      buttons.forEach((row, rIndex) => {
        const rowButtons: any[] = [];
        row.forEach((btn, cIndex) => {
          text += `• Row ${rIndex + 1}, Col ${cIndex + 1}: <b>"${btn.text}"</b>\n`;
          rowButtons.push({
            text: `✏️ Row ${rIndex + 1} Col ${cIndex + 1}: ${btn.text}`,
            callback_data: `edit_refbtn_click_${rIndex}_${cIndex}`
          });
        });
        inlineKeyboard.push(rowButtons);
      });
      
      inlineKeyboard.push([{ text: "➕ Add New Button", callback_data: "edit_refbtn_add" }]);
      inlineKeyboard.push([{ text: "🔙 Back to Referral", callback_data: "edit_section_referral" }]);
      
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } });
      }
      return;
    }

    
    if (data === "control_announcements") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      await renderAnnouncementsDashboard(chatId, messageId);
      return;
    }
    
    if (data === "control_test_announcement_all") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      // Force trigger all
      const anns = loadAnnouncements();
      for (const ann of anns) {
        ann.lastRunTime = 0;
      }
      saveAnnouncements(anns);
      await processAnnouncements(bot);
      await bot.sendMessage(chatId, "✅ All announcements have been triggered to run instantly! Please check your channel.");
      await renderAnnouncementsDashboard(chatId, messageId);
      return;
    }

    if (data.startsWith("ann_view:")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const annId = data.substring("ann_view:".length);
      await renderAnnouncementDetail(chatId, annId, messageId);
      return;
    }

    if (data.startsWith("ann_toggle:")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      const annId = data.substring("ann_toggle:".length);
      const anns = loadAnnouncements();
      const ann = anns.find(a => a.id === annId);
      if (ann) {
        ann.enabled = !ann.enabled;
        saveAnnouncements(anns);
        await bot.answerCallbackQuery(query.id, { text: `Announcement is now ${ann.enabled ? 'Enabled 🟢' : 'Disabled 🔴'}` });
        await renderAnnouncementDetail(chatId, annId, messageId);
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Announcement not found." });
      }
      return;
    }

    if (data.startsWith("ann_edit_int_sel:")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const annId = data.substring("ann_edit_int_sel:".length);
      const text = `⏱️ <b>Select New Interval for <code>${annId}</code>:</b>\n\nChoose from preset options or click custom to type a specific value (in hours).`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: "1 Hour", callback_data: `ann_set_int:${annId}:1` },
            { text: "4 Hours", callback_data: `ann_set_int:${annId}:4` },
            { text: "8 Hours", callback_data: `ann_set_int:${annId}:8` }
          ],
          [
            { text: "12 Hours", callback_data: `ann_set_int:${annId}:12` },
            { text: "24 Hours (1 Day)", callback_data: `ann_set_int:${annId}:24` },
            { text: "48 Hours (2 Days)", callback_data: `ann_set_int:${annId}:48` }
          ],
          [
            { text: "168 Hours (1 Week)", callback_data: `ann_set_int:${annId}:168` },
            { text: "⌨️ Custom (Type)", callback_data: `ann_edit_int_custom:${annId}` }
          ],
          [{ text: "🔙 Cancel", callback_data: `ann_view:${annId}` }]
        ]
      };

      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("ann_set_int:")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      const parts = data.split(":");
      const annId = parts[1];
      const hours = parseInt(parts[2], 10);
      
      const anns = loadAnnouncements();
      const ann = anns.find(a => a.id === annId);
      if (ann && !isNaN(hours)) {
        ann.intervalHours = hours;
        saveAnnouncements(anns);
        await bot.answerCallbackQuery(query.id, { text: `Interval updated to ${hours}h ✅` });
        await renderAnnouncementDetail(chatId, annId, messageId);
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Failed to update interval." });
      }
      return;
    }

    if (data.startsWith("ann_edit_int_custom:")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const annId = data.substring("ann_edit_int_custom:".length);
      
      userStates.set(userId, { step: "waiting_for_ann_interval", editingKey: annId });
      await bot.sendMessage(chatId, `⏱️ <b>Custom Interval:</b>\n\nPlease type the interval in <b>hours</b> (e.g., <code>6</code> or <code>36</code>) for <code>${annId}</code>:\n\nType /cancel to abort.`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("ann_edit_text:")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const annId = data.substring("ann_edit_text:".length);
      
      userStates.set(userId, { step: "waiting_for_ann_text", editingKey: annId });
      await bot.sendMessage(chatId, `✍️ <b>Edit Caption/Text:</b>\n\nPlease send the new message text for <code>${annId}</code>. You can use standard HTML tags like <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;code&gt;</code>.\n\nType /cancel to abort.`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("ann_edit_photo:")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const annId = data.substring("ann_edit_photo:".length);
      
      userStates.set(userId, { step: "waiting_for_ann_photo", editingKey: annId });
      await bot.sendMessage(chatId, `🖼️ <b>Edit Announcement Photo:</b>\n\nPlease <b>upload/send a photo directly</b> in this chat, or send an image URL (or type <code>none</code> to remove photo):\n\nType /cancel to abort.`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("ann_send_single:")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      const annId = data.substring("ann_send_single:".length);
      await bot.answerCallbackQuery(query.id, { text: "⏳ Sending announcement..." });
      
      const anns = loadAnnouncements();
      const ann = anns.find(a => a.id === annId);
      if (ann) {
        try {
          let messageText = ann.text;
          let photo = ann.photoUrl;
          
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
            const { data: recentWd } = await supabase
              .from('transactions')
              .select('amount, created_at, users(username, first_name)')
              .eq('type', 'withdraw')
              .gte('amount', 20000)
              .order('created_at', { ascending: false })
              .limit(1);

            if (recentWd && recentWd.length > 0) {
              const rawUser: any = recentWd[0].users;
              const user = Array.isArray(rawUser) ? rawUser[0] : rawUser;
              const name = (user && (user.username || user.first_name)) ? (user.username || user.first_name) : 'Anonymous';
              messageText = `💸 <b>Massive Withdrawal Alert!</b> 💸\n\n` +
                `🎉 Congratulations to <b>${name}</b> for withdrawing <b>${recentWd[0].amount.toLocaleString()} ETB</b>!\n\n` +
                `🚀 Play now, win big, and get paid instantly.\n\n` +
                `<i>Real winners, real money! See the screenshot proof.</i>`;
              photo = "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=800";
            } else {
              messageText = `💸 <b>Massive Withdrawal Alert!</b> 💸\n\n` +
                `🎉 Congratulations to <b>User_***</b> for withdrawing <b>25,000 ETB</b>!\n\n` +
                `🚀 Play now, win big, and get paid instantly.\n\n` +
                `<i>Real winners, real money! See the screenshot proof.</i>`;
              photo = "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=800";
            }
          } else if (ann.type === "high_deposit") {
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
            photo = "https://images.unsplash.com/photo-1513151233558-d860c5398176?w=800";
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

          if (photo) {
            await downloadAndSendPhoto(bot, process.env.CHANNEL_ID!, photo, { caption: messageText, parse_mode: "HTML" });
          } else {
            await bot.sendMessage(process.env.CHANNEL_ID, messageText, { parse_mode: "HTML" });
          }

          ann.lastRunTime = Date.now();
          saveAnnouncements(anns);

          await bot.sendMessage(chatId, `✅ Announcement <code>${annId}</code> successfully sent to the channel!`, { parse_mode: "HTML" });
          await renderAnnouncementDetail(chatId, annId, messageId);
        } catch (err: any) {
          logBot(`Failed to manually send single announcement ${annId}: ${err.message}`);
          await bot.sendMessage(chatId, `❌ Failed to send announcement: ${err.message}`);
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Announcement not found." });
      }
      return;
    }

    if (data.startsWith("ann_delete_conf:")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const annId = data.substring("ann_delete_conf:".length);
      const text = `⚠️ <b>Delete Announcement Confirmation:</b>\n\nAre you absolutely sure you want to delete <code>${annId}</code>?\nThis action is permanent and cannot be undone.`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: "🛑 Yes, Delete", callback_data: `ann_delete_exec:${annId}` },
            { text: "🔙 No, Keep It", callback_data: `ann_view:${annId}` }
          ]
        ]
      };

      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("ann_delete_exec:")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      const annId = data.substring("ann_delete_exec:".length);
      const anns = loadAnnouncements();
      const filtered = anns.filter(a => a.id !== annId);
      if (filtered.length < anns.length) {
        saveAnnouncements(filtered);
        await bot.answerCallbackQuery(query.id, { text: `Announcement ${annId} deleted ✅` });
        await renderAnnouncementsDashboard(chatId, messageId);
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Announcement not found." });
      }
      return;
    }

    if (data === "ann_create_start") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const text = `➕ <b>Create Custom Announcement:</b>\n\nPlease select the type/category of the announcement:`;
      const keyboard = {
        inline_keyboard: [
          [
            { text: "🎉 Promotion", callback_data: "ann_create_type:promotion" },
            { text: "🏆 Event", callback_data: "ann_create_type:event" },
            { text: "📚 Guide", callback_data: "ann_create_type:guide" }
          ],
          [{ text: "🔙 Cancel", callback_data: "control_announcements" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("ann_create_type:")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const type = data.substring("ann_create_type:".length);
      
      userStates.set(userId, { step: "waiting_for_ann_create_id", field: type });
      await bot.sendMessage(chatId, `⌨️ <b>Step 1/4: Unique ID</b>\n\nPlease send a unique **ID** for this new announcement (alphanumeric, lowercase, underscores only, e.g., <code>special_discount_week</code>):\n\nType /cancel to abort.`, { parse_mode: "HTML" });
      return;
    }

    if (data === "control_manage_affiliate") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      renderManageAffiliate(chatId, messageId);
      return;
    }

    if (data === "affiliate_payout_announce") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);

      try {
        const stats = await fetchLeaderboardData();
        const startOfWeekISO = stats.startOfWeek;
        const totalJackpot = stats.promoterJackpot;

        // Save announcement transaction to DB
        await supabase.from('transactions').insert({
          user_id: 'system_jackpot',
          amount: totalJackpot,
          type: 'jackpot_announcement',
          description: startOfWeekISO
        });

        const msgText = `📢 <b>UPCOMING WEEKLY PROMOTER JACKPOT DISTRIBUTION!</b>\n\n` +
          `The Weekly Promoter Jackpot distribution is scheduled to happen in exactly <b>30 minutes</b>!\n\n` +
          `💰 <b>Jackpot Pool Amount:</b> <b>${totalJackpot.toLocaleString()} ETB</b>\n` +
          `<i>(Reward is 5% of 50% of the platform's weekly overall retained fees, with no Guaranteed Minimum)</i>\n\n` +
          `🏆 <b>Current Top Standings:</b>\n` +
          (stats.leaderboard && stats.leaderboard.length > 0 
            ? stats.leaderboard.slice(0, 3).map((entry, idx) => {
                const displayName = entry.first_name || entry.username || `User_${entry.referrer_id.slice(0, 6)}`;
                const prizeShare = idx === 0 ? 0.50 : idx === 1 ? 0.30 : 0.20;
                const shareAmount = Math.floor(totalJackpot * prizeShare);
                return `🏅 <b>Rank ${idx+1}:</b> ${displayName} — Vol: <b>${entry.volume.toLocaleString()} ETB</b> (Est. Reward: <b>${shareAmount.toLocaleString()} ETB</b>)`;
              }).join('\n')
            : `<i>No qualified referrers recorded yet this week.</i>`) +
          `\n\n📢 Promote your referral link <code>/referral</code> now to secure or upgrade your ranking before distribution! 🎮`;

        // Broadcast to all users
        const { data: allUsers } = await supabase.from('users').select('id');
        let successCount = 0;
        
        if (allUsers) {
          for (const u of allUsers) {
            if (!u.id || u.id === 'system_jackpot') continue;
            try {
              await bot.sendMessage(u.id, msgText, { parse_mode: "HTML" });
              successCount++;
            } catch (broadcastErr) {
              // Ignore blocked/deleted chats
            }
          }
        }

        bot.sendMessage(chatId, `✅ <b>Jackpot Payout Announced successfully!</b>\n\nBroadcasted reward pool of <b>${totalJackpot.toLocaleString()} ETB</b> to <b>${successCount} active users</b>.\n\n⏱️ A 30-minute lock is now active before distribution can be executed.`, { parse_mode: "HTML" });
        
        // Refresh panel
        renderManageAffiliate(chatId, messageId);

      } catch (err: any) {
        logBot(`Error announcing promoter jackpot: ${err.message}`);
        bot.sendMessage(chatId, `❌ <b>Announcement Error:</b> ${err.message}`, { parse_mode: "HTML" });
      }
      return;
    }

    if (data === "affiliate_payout_weekly") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);

      try {
        const stats = await fetchLeaderboardData();
        const startOfWeekISO = stats.startOfWeek;
        const dateStr = new Date(startOfWeekISO).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });

        // Check if already paid out for this week
        const checkDesc = `🏆 Weekly Promoter Jackpot - Rank % Winner (Week of ${startOfWeekISO.slice(0, 10)})`;
        const { data: existingPayouts } = await supabase
          .from('transactions')
          .select('id')
          .ilike('description', checkDesc);

        if (existingPayouts && existingPayouts.length > 0) {
          bot.sendMessage(chatId, `⚠️ <b>Jackpot already distributed!</b>\n\nPromoter Jackpot has already been paid out for the week starting <code>${dateStr}</code>.`, { parse_mode: "HTML" });
          return;
        }

        if (!stats.leaderboard || stats.leaderboard.length === 0) {
          bot.sendMessage(chatId, `ℹ️ <b>No promoters found</b>\n\nThere is no recorded playing volume from referred users to distribute the Promoter Jackpot for this week yet.`, { parse_mode: "HTML" });
          return;
        }

        // Enforce the 30-minute payout announcement rule
        const { data: annList } = await supabase
          .from('transactions')
          .select('created_at, amount')
          .eq('type', 'jackpot_announcement')
          .eq('description', startOfWeekISO)
          .order('created_at', { ascending: false })
          .limit(1);

        const lastAnn = annList && annList.length > 0 ? annList[0] : null;

        if (!lastAnn) {
          bot.sendMessage(chatId, `⚠️ <b>Payout Announcement Required First!</b>\n\nPer policies, you must announce the reward amount exactly 30 minutes prior to final distribution.\n\nPlease click the <b>"📢 Announce Jackpot Pool"</b> button first.`, { parse_mode: "HTML" });
          return;
        }

        const elapsed = (Date.now() - new Date(lastAnn.created_at).getTime()) / (1000 * 60);
        if (elapsed < 30) {
          const remainingMin = Math.ceil(30 - elapsed);
          bot.sendMessage(chatId, `⏳ <b>Jackpot Distribution Locked!</b>\n\nThe jackpot pool was announced ${Math.floor(elapsed)}m ago.\n\nYou must wait another <b>${remainingMin} minutes</b> before final distribution of prizes.`, { parse_mode: "HTML" });
          return;
        }

        // We distribute the exactly announced jackpot pool amount
        const totalJackpot = Number(lastAnn.amount);
        let p1Share = Math.floor(totalJackpot * 0.50);
        let p2Share = Math.floor(totalJackpot * 0.30);
        let p3Share = Math.floor(totalJackpot * 0.20);

        let report = `🎁 <b>DISTRIBUTING WEEKLY PROMOTER JACKPOT</b>\n\n`;
        report += `📅 <b>Week Starting:</b> <code>${dateStr}</code>\n`;
        report += `💰 <b>Jackpot Pool (Announced):</b> <b>${totalJackpot.toLocaleString()} ETB</b>\n\n`;

        // We process each winner (up to 3)
        const entries = stats.leaderboard.slice(0, 3);
        
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const rank = i + 1;
          const shareAmt = rank === 1 ? p1Share : rank === 2 ? p2Share : p3Share;
          
          if (shareAmt <= 0) continue;

          // 1. Fetch current balance
          const { data: userProfile } = await supabase.from('users').select('balance, username, first_name').eq('id', entry.referrer_id).single();
          
          if (userProfile) {
            const currentBalance = Number(userProfile.balance || 0);
            const newBalance = currentBalance + shareAmt;

            // 2. Update balance
            await supabase.from('users').update({ balance: newBalance }).eq('id', entry.referrer_id);

            // 3. Insert transaction
            await supabase.from('transactions').insert({
              user_id: entry.referrer_id,
              amount: shareAmt,
              type: 'reward',
              description: `🏆 Weekly Promoter Jackpot - Rank ${rank} Winner (Week of ${startOfWeekISO.slice(0, 10)})`
            });

            const winnerName = userProfile.first_name || userProfile.username || `User ${entry.referrer_id}`;
            report += `🏅 <b>Rank ${rank}:</b> ${winnerName} (ID: <code>${entry.referrer_id}</code>)\n`;
            report += `  - Playing Vol: <b>${entry.volume.toLocaleString()} ETB</b>\n`;
            report += `  - Prize Credited: <b>${shareAmt.toLocaleString()} ETB</b>\n\n`;

            // Send notification to the winner
            bot.sendMessage(entry.referrer_id, 
              `🎉 <b>Congratulations!</b>\n\n` +
              `You achieved <b>Rank ${rank}</b> on the Weekly Promoter Leaderboard with a referred volume of <b>${entry.volume.toLocaleString()} ETB</b>!\n\n` +
              `🏆 Your prize share of <b>${shareAmt.toLocaleString()} ETB</b> has been credited to your main balance.\n\n` +
              `Keep promoting ETB Game Hub and win big next week! 🎮`, 
              { parse_mode: "HTML" }
            ).catch(() => {});
          }
        }

        bot.sendMessage(chatId, report, { parse_mode: "HTML" });

      } catch (err: any) {
        logBot(`Error distributing weekly promoter jackpot: ${err.message}`);
        bot.sendMessage(chatId, `❌ <b>Payout Error:</b> ${err.message}`, { parse_mode: "HTML" });
      }
      return;
    }

    if (data === "control_back" || data === "control_panel_back") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      renderMainControlPanel(chatId, messageId);
      return;
    }

    if (data && data.startsWith("affiliate_review_")) {
        if (!isStartingAdmin(parseInt(userId, 10))) {
            bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
            return;
        }
        const reqId = data.replace("affiliate_review_", "");
        const { data: req } = await supabase.from('transactions').select('*').eq('id', reqId).single();
        if (!req) {
            bot.answerCallbackQuery(query.id, { text: "Request not found or already processed." });
            return;
        }
        
        // Fetch overlapping IPs
        const { data: aIps } = await supabase.from('transactions').select('description').eq('user_id', req.user_id).eq('type', 'ip_log');
        const affiliateIps = aIps?.map(i => i.description) || [];
        
        // Fetch all referrals of this user
        const { data: refs } = await supabase.from('transactions').select('description').eq('user_id', req.user_id).eq('type', 'referral_link');
        let refOverlapCount = 0;
        
        if (refs && refs.length > 0) {
            for (const r of refs) {
                const referredUserId = r.description.split(' | ')[0].replace('Referred by ', '');
                // Note: The description for referral_link is on the referred user's transactions usually? Wait! 
                // Ah, the referral_link transaction is on the REFERRED user's account! Wait, we query by user_id = req.user_id here. 
                // Wait, if it's on the REFERRED user, user_id is the referred user. So `refs` here would be empty if we query by influencer's ID.
                // The correct query to find referrals of this influencer:
                const { data: userRefs } = await supabase.from('transactions').select('user_id').eq('type', 'referral_link').ilike('description', `Referred by ${req.user_id}%`);
                if (userRefs && userRefs.length > 0) {
                    for (const uRef of userRefs) {
                        const { data: pIps } = await supabase.from('transactions').select('description').eq('user_id', uRef.user_id).eq('type', 'ip_log');
                        const pIpList = pIps?.map(i => i.description) || [];
                        if (pIpList.some(ip => affiliateIps.includes(ip))) {
                            refOverlapCount++;
                        }
                    }
                }
                break; // break the first loop since we handled it inside correctly
            }
        }
        
        const text = `🔎 <b>Affiliate Payout Review</b>\n\n` +
          `<b>Influencer ID:</b> <code>${req.user_id}</code>\n` +
          `<b>Requested Amount:</b> ${req.amount} ETB\n\n` +
          `⚠️ <b>Security Check:</b>\n` +
          `Overlap with referred players' IPs: <b>${refOverlapCount} matches found</b>\n\n` +
          `<i>If overlap count is high, this might be a syndicate.</i>`;
          
        bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ Approve Payout", callback_data: `affiliate_approve_${req.id}` },
                        { text: "❌ Decline & Refund", callback_data: `affiliate_reject_${req.id}` }
                    ],
                    [
                        { text: "🚫 Ban Influencer", callback_data: `affiliate_ban_${req.user_id}` },
                        { text: "🔙 Back", callback_data: "control_panel_back" }
                    ]
                ]
            }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }
    
    if (data && data.startsWith("affiliate_approve_")) {
        if (!isStartingAdmin(parseInt(userId, 10))) return;
        const reqId = data.replace("affiliate_approve_", "");
        const { data: req } = await supabase.from('transactions').select('*').eq('id', reqId).single();
        if (req) {
            // Convert request to an actual withdrawal transaction (we delete the request and insert an affiliate_withdrawal and a bot balance withdrawal)
            // Wait, we can just change the type of the transaction!
            await supabase.from('transactions').update({ type: 'affiliate_withdrawal', description: `Approved Affiliate Payout: ${req.amount} ETB`, amount: -Math.abs(req.amount) }).eq('id', reqId);
            
            // Also need to add money to the user's actual balance so they can withdraw via normal means?
            // OR we just give them ETB balance? Yes!
            const { data: user } = await supabase.from('users').select('balance').eq('id', req.user_id).single();
            if (user) {
                const newBalance = Number(user.balance || 0) + req.amount;
                await supabase.from('users').update({ balance: newBalance }).eq('id', req.user_id);
                await supabase.from('transactions').insert({ user_id: req.user_id, amount: req.amount, type: 'reward', description: 'Affiliate Payout Credited to Main Balance' });
                bot.sendMessage(req.user_id, `✅ <b>Affiliate Payout Approved!</b>\n\n${req.amount} ETB has been credited to your main balance.`, { parse_mode: "HTML" }).catch(()=>{});
            }
        }
        bot.answerCallbackQuery(query.id, { text: "Approved!" });
        bot.sendMessage(chatId, "Payout Approved. User credited.");
        return;
    }
    
    if (data && data.startsWith("affiliate_reject_")) {
        if (!isStartingAdmin(parseInt(userId, 10))) return;
        const reqId = data.replace("affiliate_reject_", "");
        const { data: req } = await supabase.from('transactions').select('*').eq('id', reqId).single();
        if (req) {
            // Delete the request so the money returns to their affiliate balance available
            await supabase.from('transactions').delete().eq('id', reqId);
            bot.sendMessage(req.user_id, `❌ <b>Affiliate Payout Declined</b>\n\nYour payout request of ${req.amount} ETB was declined by admin. Funds returned to affiliate balance.`, { parse_mode: "HTML" }).catch(()=>{});
        }
        bot.answerCallbackQuery(query.id, { text: "Declined!" });
        bot.sendMessage(chatId, "Payout Declined. Request removed.");
        return;
    }
    
    if (data && data.startsWith("affiliate_ban_")) {
        if (!isStartingAdmin(parseInt(userId, 10))) return;
        const targetUser = data.replace("affiliate_ban_", "");
        await supabase.from("transactions").insert({
             user_id: targetUser,
             amount: 0,
             type: "affiliate_flag",
             description: `Banned by Admin due to syndicate/abuse`
         });
         // Also delete all their pending requests
         await supabase.from("transactions").delete().eq("user_id", targetUser).eq("type", "affiliate_payout_request");
         bot.answerCallbackQuery(query.id, { text: "Banned!" });
         bot.sendMessage(chatId, `Influencer ${targetUser} banned from affiliate system. pending requests deleted.`);
         return;
    }
    if (data === "control_links") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      renderCommandLinks(chatId, messageId);
      return;
    }

    if (data.startsWith("edit_wbtn_click_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_wbtn_click_", "").split("_");
      const rIndex = parseInt(parts[0], 10);
      const cIndex = parseInt(parts[1], 10);
      
      const btn = promptsConfig.welcome_buttons?.[rIndex]?.[cIndex];
      if (!btn) {
        return bot.sendMessage(chatId, "❌ Button not found.");
      }
      
      const text = `🔘 <b>Editing Welcome Button</b>\n\n` +
        `• <b>Label:</b> <code>${btn.text}</code>\n` +
        `• <b>Type:</b> <code>${btn.type}</code>\n` +
        `• <b>Target Value:</b> <code>${btn.value}</code>\n\n` +
        `Select an action:`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: "✏️ Edit Button Label", callback_data: `edit_wbtn_label_${rIndex}_${cIndex}` }],
          [{ text: "🔧 Edit Button Type & Destination", callback_data: `edit_wbtn_dest_${rIndex}_${cIndex}` }],
          [{ text: "❌ Delete Button", callback_data: `edit_wbtn_del_${rIndex}_${cIndex}` }],
          [{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]
        ]
      };
      
      if (messageId) {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: keyboard
        });
      }
      return;
    }

    if (data.startsWith("edit_wbtn_label_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_wbtn_label_", "").split("_");
      const rIndex = parts[0];
      const cIndex = parts[1];
      
      userStates.set(userId, {
        step: 'awaiting_wbtn_label_change',
        row: parseInt(rIndex, 10),
        col: parseInt(cIndex, 10)
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter new label/text for the button:</b>\n\nType the text and send it directly.`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("edit_wbtn_dest_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_wbtn_dest_", "").split("_");
      const rIndex = parts[0];
      const cIndex = parts[1];
      
      const text = `🔧 <b>Select Button Type:</b>\n\n` +
        `• <b>Play WebApp:</b> Launches your gaming app.\n` +
        `• <b>Callback action:</b> Triggers built-in flows (e.g. <code>menu_deposit</code>, <code>menu_withdraw</code>, <code>menu_support</code>).\n` +
        `• <b>Custom URL:</b> Redirects player to any custom link or channel.`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: "🎮 Play WebApp Game", callback_data: `set_wbtn_type_${rIndex}_${cIndex}_webapp` }],
          [{ text: "💳 Callback Deposit Flow", callback_data: `set_wbtn_type_${rIndex}_${cIndex}_cb_dep` }],
          [{ text: "🏦 Callback Withdraw Flow", callback_data: `set_wbtn_type_${rIndex}_${cIndex}_cb_wd` }],
          [{ text: "📞 Callback Support Flow", callback_data: `set_wbtn_type_${rIndex}_${cIndex}_cb_sup` }],
          [{ text: "🔗 Custom URL Link", callback_data: `set_wbtn_type_${rIndex}_${cIndex}_url` }],
          [{ text: "🔙 Cancel", callback_data: `edit_wbtn_click_${rIndex}_${cIndex}` }]
        ]
      };
      
      if (messageId) {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: keyboard
        });
      }
      return;
    }

    if (data.startsWith("set_wbtn_type_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("set_wbtn_type_", "").split("_");
      const rIndex = parseInt(parts[0], 10);
      const cIndex = parseInt(parts[1], 10);
      const actionType = parts[2];
      
      if (!promptsConfig.welcome_buttons) promptsConfig.welcome_buttons = [];
      const btn = promptsConfig.welcome_buttons?.[rIndex]?.[cIndex];
      if (!btn) return;
      
      if (actionType === 'webapp') {
        btn.type = 'webapp';
        btn.value = 'appUrl';
        savePromptsConfig(promptsConfig);
        await bot.sendMessage(chatId, `✅ Welcome button updated to launch WebApp Game!`);
        await bot.sendMessage(chatId, `🔘 <b>Welcome Button Editor</b>\nUpdated!`, {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (actionType === 'cb_dep') {
        btn.type = 'callback';
        btn.value = 'menu_deposit';
        savePromptsConfig(promptsConfig);
        await bot.sendMessage(chatId, `✅ Welcome button updated to trigger Deposit Flow!`);
        await bot.sendMessage(chatId, `🔘 <b>Welcome Button Editor</b>\nUpdated!`, {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (actionType === 'cb_wd') {
        btn.type = 'callback';
        btn.value = 'menu_withdraw';
        savePromptsConfig(promptsConfig);
        await bot.sendMessage(chatId, `✅ Welcome button updated to trigger Withdraw Flow!`);
        await bot.sendMessage(chatId, `🔘 <b>Welcome Button Editor</b>\nUpdated!`, {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (actionType === 'cb_sup') {
        btn.type = 'callback';
        btn.value = 'menu_support';
        savePromptsConfig(promptsConfig);
        await bot.sendMessage(chatId, `✅ Welcome button updated to trigger Support Flow!`);
        await bot.sendMessage(chatId, `🔘 <b>Welcome Button Editor</b>\nUpdated!`, {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (actionType === 'url') {
        userStates.set(userId, {
          step: 'awaiting_wbtn_url_change',
          row: rIndex,
          col: cIndex
        });
        await bot.sendMessage(chatId, `✍️ <b>Please send the destination URL link:</b>\n\nExample: <code>https://t.me/EthiopiaPlayChannel</code>`, { parse_mode: "HTML" });
      }
      return;
    }

    if (data.startsWith("edit_wbtn_del_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_wbtn_del_", "").split("_");
      const rIndex = parseInt(parts[0], 10);
      const cIndex = parseInt(parts[1], 10);
      
      if (promptsConfig.welcome_buttons?.[rIndex]) {
        promptsConfig.welcome_buttons[rIndex].splice(cIndex, 1);
        if (promptsConfig.welcome_buttons[rIndex].length === 0) {
          promptsConfig.welcome_buttons.splice(rIndex, 1);
        }
        savePromptsConfig(promptsConfig);
        await bot.sendMessage(chatId, "✅ Welcome button deleted successfully!");
      }
      
      const text = "👋 <b>Welcome Buttons Main Editor</b>";
      await bot.sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Buttons Panel", callback_data: "edit_section_welcome_buttons" }]]
        }
      });
      return;
    }

    if (data === "edit_wbtn_add") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      userStates.set(userId, {
        step: 'awaiting_wbtn_add_label'
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter label/text for the new button:</b>\n\nType the text (e.g. <code>🎁 Free Bonus</code>) and send it directly.`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("add_wbtn_type_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const type = data.replace("add_wbtn_type_", "");
      const state = userStates.get(userId);
      const label = state?.new_label || "New Button";
      
      if (!promptsConfig.welcome_buttons) promptsConfig.welcome_buttons = [];
      
      if (type === 'webapp') {
        promptsConfig.welcome_buttons.push([{ text: label, type: 'webapp', value: 'appUrl' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await bot.sendMessage(chatId, "🔘 Welcome Buttons Menu", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (type === 'cb_dep') {
        promptsConfig.welcome_buttons.push([{ text: label, type: 'callback', value: 'menu_deposit' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await bot.sendMessage(chatId, "🔘 Welcome Buttons Menu", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (type === 'cb_wd') {
        promptsConfig.welcome_buttons.push([{ text: label, type: 'callback', value: 'menu_withdraw' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await bot.sendMessage(chatId, "🔘 Welcome Buttons Menu", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (type === 'cb_sup') {
        promptsConfig.welcome_buttons.push([{ text: label, type: 'callback', value: 'menu_support' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await bot.sendMessage(chatId, "🔘 Welcome Buttons Menu", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (type === 'url') {
        userStates.set(userId, {
          ...state,
          step: 'awaiting_wbtn_add_url'
        });
        await bot.sendMessage(chatId, `✍️ <b>Please send the destination URL link:</b>\n\nExample: <code>https://t.me/EthiopiaPlayChannel</code>`, { parse_mode: "HTML" });
      }
      return;
    }

    if (data === "edit_section_custom_commands") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const cmds = promptsConfig.custom_commands || {};
      let text = "✨ <b>Custom Commands Manager</b>\n\n" +
        "You can define your own Telegram bot commands dynamically! These will appear in player suggestions and triggers custom texts, photos, or buttons.\n\n" +
        "<b>Current Custom Commands:</b>\n";
      
      const inlineKeyboard: any[] = [];
      const keys = Object.keys(cmds);
      
      if (keys.length === 0) {
        text += "<i>No custom commands registered yet.</i>";
      } else {
        keys.forEach((cmd) => {
          text += `• <b>/${cmd}</b> - <i>${cmds[cmd].description || 'No description'}</i>\n`;
          inlineKeyboard.push([{
            text: `🛠️ /${cmd}`,
            callback_data: `ccmd_edit_${cmd}`
          }]);
        });
      }
      
      inlineKeyboard.push([{ text: "➕ Create Dynamic Command", callback_data: "ccmd_create_start" }]);
      inlineKeyboard.push([{ text: "🔙 Back", callback_data: "control_edit" }]);
      
      if (messageId) {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      }
      return;
    }

    if (data === "ccmd_create_start") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      userStates.set(userId, {
        step: 'awaiting_ccmd_name'
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter your new command name</b> (lowercase, no space, no slash):\n\nExample: <code>rules</code>`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("ccmd_edit_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const cmdName = data.replace("ccmd_edit_", "");
      await sendCustomCommandEditMenu(chatId, cmdName, messageId);
      return;
    }

    if (data.startsWith("ccmd_val_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const clean = data.replace("ccmd_val_", "");
      const parts = clean.split("_");
      const cmdName = parts[0];
      const action = parts.slice(1).join("_");
      
      if (action === "text" || action === "desc" || action === "photo") {
        userStates.set(userId, {
          step: 'awaiting_ccmd_val_change',
          cmd_name: cmdName,
          field: action
        });
        
        const label = action === "text" ? "response message text" : (action === "desc" ? "menu helper description" : "photo File ID or direct image URL");
        await bot.sendMessage(chatId, `✍️ <b>Please send the new ${label} for /${cmdName}:</b>`, { parse_mode: "HTML" });
      } else if (action === "photo_clear") {
        if (promptsConfig.custom_commands?.[cmdName]) {
          promptsConfig.custom_commands[cmdName].photo = undefined;
          savePromptsConfig(promptsConfig);
          await bot.sendMessage(chatId, `✅ Cleared photo for /${cmdName}!`);
          await sendCustomCommandEditMenu(chatId, cmdName);
        }
      } else if (action === "delete") {
        if (promptsConfig.custom_commands) {
          delete promptsConfig.custom_commands[cmdName];
          savePromptsConfig(promptsConfig);
          await bot.sendMessage(chatId, `✅ Deleted custom command /${cmdName}!`);
          
          try {
            const systemCommands = [
              { command: "start", description: "Launch the game hub and display menu" },
              { command: "play", description: "Launch the Web App immediately" },
              { command: "balance", description: "Check your current wallet balance" },
              { command: "deposit", description: "Deposit ETB into your balance" },
              { command: "withdraw", description: "Withdraw ETB from your balance" },
              { command: "referral", description: "Invite friends and earn rewards" },
              { command: "affiliate", description: "View your affiliate dashboard and earnings" },
              { command: "promoter_leaderboard", description: "View Weekly Promoter Leaderboard" },
              { command: "support", description: "Show contact support details" },
              { command: "language", description: "Change bot language" },
              { command: "cancel", description: "Cancel current operation or active flows" }
            ];

            const customCommandsList = Object.entries(promptsConfig.custom_commands || {}).map(([cmd, cfg]) => ({
              command: cmd,
              description: cfg.description || "Custom command"
            }));

            try {
              await bot.setMyCommands([...systemCommands, ...customCommandsList]);
              logBot("Bot commands updated successfully (delete command).");
            } catch (err: any) {
              logBot(`Failed to set Telegram commands: ${err.message}`);
            }
          } catch (err: any) {
            logBot(`Error in outer re-sync delete: ${err.message}`);
          }
        }
        const text = "✨ <b>Custom Commands Main Panel</b>";
        await bot.sendMessage(chatId, text, {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Commands Panel", callback_data: "edit_section_custom_commands" }]]
          }
        });
      } else if (action === "buttons") {
        await sendCustomCommandButtonsPanel(chatId, cmdName, messageId);
      }
      return;
    }

    if (data.startsWith("cc_btn_click_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("cc_btn_click_", "").split("_");
      const cmdName = parts[0];
      const rIndex = parseInt(parts[1], 10);
      const cIndex = parseInt(parts[2], 10);
      
      const cmd = promptsConfig.custom_commands?.[cmdName];
      const btn = cmd?.buttons?.[rIndex]?.[cIndex];
      if (!btn) return;
      
      const text = `🔘 <b>Editing Custom Command Button</b>\n\n` +
        `• <b>Command:</b> /${cmdName}\n` +
        `• <b>Label:</b> <code>${btn.text}</code>\n` +
        `• <b>Type:</b> <code>${btn.type}</code>\n` +
        `• <b>Target Value:</b> <code>${btn.value}</code>\n\n` +
        `Select an action:`;
        
      const keyboard = {
        inline_keyboard: [
          [{ text: "✏️ Edit Button Label", callback_data: `cc_btn_label_${cmdName}_${rIndex}_${cIndex}` }],
          [{ text: "❌ Delete Button", callback_data: `cc_btn_del_${cmdName}_${rIndex}_${cIndex}` }],
          [{ text: "🔙 Back to Buttons", callback_data: `ccmd_val_${cmdName}_buttons` }]
        ]
      };
      
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("cc_btn_label_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("cc_btn_label_", "").split("_");
      const cmdName = parts[0];
      const rIndex = parseInt(parts[1], 10);
      const cIndex = parseInt(parts[2], 10);
      
      userStates.set(userId, {
        step: 'awaiting_cc_btn_label_change',
        cmd_name: cmdName,
        row: rIndex,
        col: cIndex
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter new label for this /${cmdName} button:</b>`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("cc_btn_del_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("cc_btn_del_", "").split("_");
      const cmdName = parts[0];
      const rIndex = parseInt(parts[1], 10);
      const cIndex = parseInt(parts[2], 10);
      
      const cmd = promptsConfig.custom_commands?.[cmdName];
      if (cmd?.buttons?.[rIndex]) {
        cmd.buttons[rIndex].splice(cIndex, 1);
        if (cmd.buttons[rIndex].length === 0) {
          cmd.buttons.splice(rIndex, 1);
        }
        savePromptsConfig(promptsConfig);
        await bot.sendMessage(chatId, `✅ Button deleted successfully!`);
      }
      
      await sendCustomCommandButtonsPanel(chatId, cmdName);
      return;
    }

    if (data.startsWith("cc_btn_add_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const cmdName = data.replace("cc_btn_add_", "");
      userStates.set(userId, {
        step: 'awaiting_cc_btn_add_label',
        cmd_name: cmdName
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter label/text for the new button on /${cmdName}:</b>\n\nType the text and send it directly.`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("cc_add_type_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("cc_add_type_", "").split("_");
      const cmdName = parts[0];
      const type = parts.slice(1).join("_");
      
      const state = userStates.get(userId);
      const label = state?.new_label || "New Button";
      const cmd = promptsConfig.custom_commands?.[cmdName];
      if (!cmd) return;
      if (!cmd.buttons) cmd.buttons = [];
      
      if (type === 'webapp') {
        cmd.buttons.push([{ text: label, type: 'webapp', value: 'appUrl' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await sendCustomCommandButtonsPanel(chatId, cmdName);
      } else if (type === 'cb_dep') {
        cmd.buttons.push([{ text: label, type: 'callback', value: 'menu_deposit' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await sendCustomCommandButtonsPanel(chatId, cmdName);
      } else if (type === 'cb_wd') {
        cmd.buttons.push([{ text: label, type: 'callback', value: 'menu_withdraw' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await sendCustomCommandButtonsPanel(chatId, cmdName);
      } else if (type === 'cb_sup') {
        cmd.buttons.push([{ text: label, type: 'callback', value: 'menu_support' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await sendCustomCommandButtonsPanel(chatId, cmdName);
      } else if (type === 'url') {
        userStates.set(userId, {
          ...state,
          step: 'awaiting_cc_btn_add_url'
        });
        await bot.sendMessage(chatId, `✍️ <b>Please send the destination URL link:</b>\n\nExample: <code>https://t.me/EthiopiaPlayChannel</code>`, { parse_mode: "HTML" });
      }
      return;
    }

    if (data.startsWith("edit_refbtn_click_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_refbtn_click_", "").split("_");
      const rIndex = parseInt(parts[0], 10);
      const cIndex = parseInt(parts[1], 10);
      
      const btn = promptsConfig.referral_buttons?.[rIndex]?.[cIndex];
      if (!btn) {
        return bot.sendMessage(chatId, "❌ Button not found.");
      }
      
      const text = `🤝 <b>Editing Referral Button</b>\n\n` +
        `• <b>Label:</b> <code>${btn.text}</code>\n` +
        `• <b>Type:</b> <code>${btn.type}</code>\n` +
        `• <b>Target Value:</b> <code>${btn.value}</code>\n\n` +
        `Select an action:`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: "✏️ Edit Button Label", callback_data: `edit_refbtn_label_${rIndex}_${cIndex}` }],
          [{ text: "🔗 Edit Share URL", callback_data: `edit_refbtn_url_${rIndex}_${cIndex}` }],
          [{ text: "❌ Delete Button", callback_data: `edit_refbtn_del_${rIndex}_${cIndex}` }],
          [{ text: "🔙 Back to Buttons", callback_data: "edit_section_referral_buttons" }]
        ]
      };
      
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("edit_refbtn_label_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_refbtn_label_", "").split("_");
      const rIndex = parts[0];
      const cIndex = parts[1];
      
      userStates.set(userId, {
        step: 'awaiting_refbtn_label_change',
        row: parseInt(rIndex, 10),
        col: parseInt(cIndex, 10)
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter new label/text for the referral button:</b>\n\nType the text and send it directly.`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("edit_refbtn_url_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_refbtn_url_", "").split("_");
      const rIndex = parts[0];
      const cIndex = parts[1];
      
      userStates.set(userId, {
        step: 'awaiting_refbtn_url_change',
        row: parseInt(rIndex, 10),
        col: parseInt(cIndex, 10)
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter the new share URL link:</b>\n\nUse <code>{user_id}</code> and <code>{bot_username}</code> as placeholders if needed.`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("edit_refbtn_del_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_refbtn_del_", "").split("_");
      const rIndex = parseInt(parts[0], 10);
      const cIndex = parseInt(parts[1], 10);
      
      if (promptsConfig.referral_buttons?.[rIndex]) {
        promptsConfig.referral_buttons[rIndex].splice(cIndex, 1);
        if (promptsConfig.referral_buttons[rIndex].length === 0) {
          promptsConfig.referral_buttons.splice(rIndex, 1);
        }
        savePromptsConfig(promptsConfig);
        await bot.sendMessage(chatId, "✅ Referral button deleted successfully!");
      }
      
      await bot.sendMessage(chatId, "🤝 <b>Referral Buttons Main Editor</b>", {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Buttons Panel", callback_data: "edit_section_referral_buttons" }]]
        }
      });
      return;
    }

    if (data === "edit_refbtn_add") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      userStates.set(userId, {
        step: 'awaiting_refbtn_add_label'
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter label/text for the new referral button:</b>\n\nExample: <code>🎁 Invite & Earn</code>`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("edit_bank_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const bankId = data.replace("edit_bank_", "");
      const bank = promptsConfig.banks[bankId] || { name: bankId, account: "", owner_name: "" };
      const text = `🏦 <b>Bank Settings: ${bankId}</b>\n\n` +
        `🏷️ <b>Display Name:</b> <code>${bank.name}</code>\n` +
        `💳 <b>Account/Phone:</b> <code>${bank.account}</code>\n` +
        `👤 <b>Owner Name:</b> <code>${bank.owner_name}</code>\n\n` +
        `Select which property you want to edit:`;
      const keyboard = {
        inline_keyboard: [
          [{ text: "🏷️ Edit Display Name", callback_data: `edit_bankval_${bankId}_name` }],
          [{ text: "💳 Edit Account/Phone", callback_data: `edit_bankval_${bankId}_account` }],
          [{ text: "👤 Edit Owner Name", callback_data: `edit_bankval_${bankId}_owner_name` }],
          [{ text: "🔙 Back to Banks", callback_data: "edit_section_banks" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("edit_key_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const key = data.replace("edit_key_", "") as keyof PromptsConfig;
      const currentVal = promptsConfig[key] || "";
      userStates.set(userId, {
        step: 'edit_prompt_value',
        editingKey: key
      });

      let section = "control_edit";
      if (key.startsWith("withdraw")) section = "edit_section_withdrawal";
      else if (key.startsWith("deposit") || key === "support_text") section = "edit_section_deposit";
      else if (key === "referral_msg" || key === "referral_image" || key === "referral_share_text" || key === "referral_share_image") section = "edit_section_referral";
      else if (key.startsWith("welcome") || key === "support_card_msg") section = "edit_section_welcome";

      if (key === 'referral_image' || key === 'referral_share_image' || key === 'welcome_image' || key === 'welcome_guest_image') {
        let title = "Editing Image";
        if (key === 'referral_image') title = "Referral Image";
        else if (key === 'referral_share_image') title = "Referral Share Image";
        else if (key === 'welcome_image') title = "Welcome Image (Registered)";
        else if (key === 'welcome_guest_image') title = "Welcome Image (Guest)";

        const text = `🖼️ <b>Editing ${title}</b>\n\n` +
          `<b>Current File ID:</b> <code>${currentVal || 'None'}</code>\n\n` +
          `<i>Please send a PHOTO to update the image, or send <code>none</code> to remove it.</i>`;
        const keyboard = {
          inline_keyboard: [
            [{ text: "❌ Cancel", callback_data: section }]
          ]
        };
        if (messageId) {
          await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
        }
        return;
      }

      const text = `✍️ <b>Editing Prompt Key:</b> <code>${key}</code>\n\n` +
        `<b>Current Value:</b>\n` +
        `<pre>${currentVal}</pre>\n\n` +
        `<i>Please send the new text message in response to this message to update it. Markdown formatting is supported.</i>`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: "❌ Cancel", callback_data: section }]
        ]
      };

      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("edit_bankval_")) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const parts = data.replace("edit_bankval_", "").split("_");
      const bankId = parts[0];
      const prop = parts.slice(1).join("_"); // 'name' | 'account' | 'owner_name'
      const bank = promptsConfig.banks[bankId] || { name: bankId, account: "", owner_name: "" };
      const currentVal = (bank as any)[prop] || "";

      userStates.set(userId, {
        step: 'edit_prompt_value',
        editingKey: `bank_${bankId}_${prop}`
      });

      const text = `✍️ <b>Editing ${bankId} Bank Property:</b> <code>${prop}</code>\n\n` +
        `<b>Current Value:</b>\n` +
        `<pre>${currentVal}</pre>\n\n` +
        `<i>Please send the new value text message to update.</i>`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: "❌ Cancel", callback_data: `edit_bank_${bankId}` }]
        ]
      };

      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("lang_")) {
      const lang = data === "lang_en" ? "en" : "am";
      userLanguages.set(userId, lang);
      await bot.answerCallbackQuery(query.id, { text: `Language changed to ${lang === 'en' ? 'English' : 'Amharic'}` });
      bot.sendMessage(chatId, lang === 'en' ? "Language set to English." : "ቋንቋ ወደ አማርኛ ተቀይሯል።");
      return;
    }

    logBot(`callback_query received: userId=${userId}, chatId=${chatId}, data=${data}`);

    if (!chatId || !data) {
      logBot(`callback_query rejected: chatId=${chatId}, data=${data}`);
      return;
    }

    if (data === "register_start") {
      try {
        await bot.answerCallbackQuery(query.id);
        const contactPrompt = `📱 <b>Registration Required / ምዝገባ ያስፈልጋል</b>\n\n` +
          `To ensure a secure environment, protect your funds, and prevent bots, please share your contact details below to finalize your registration.\n\n` +
          `ደህንነቱ የተጠበቀ የጨዋታ ሁኔታ ለመፍጠር እና ቦቶችን ለመከላከል እባክዎ ከታች ያለውን <b>"📱 Share Contact / ስልክ ቁጥር ያጋሩ"</b> የሚለውን ቁልፍ ተጭነው ስልክ ቁጥርዎን ያጋሩ።`;
        
        await bot.sendMessage(chatId, contactPrompt, {
          parse_mode: "HTML",
          reply_markup: {
            keyboard: [
              [{ text: "📱 Share Contact / ስልክ ቁጥር ያጋሩ", request_contact: true }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
          }
        });
      } catch (e: any) {
        logBot(`Error in register_start callback: ${e.message}`);
      }
      return;
    }

    // Secure administrative callback actions against unauthorized users
    const isAdminAction = data.startsWith("approve_dep_") || 
                          data.startsWith("decline_dep_") || 
                          data.startsWith("approve_wd_") || 
                          data.startsWith("decline_wd_");

    if (isAdminAction) {
      const clickerId = query.from.id;
      if (!adminChatIds.has(clickerId)) {
        logBot(`Unauthorized transaction action attempt by clickerId=${clickerId} on ${data}`);
        try {
          await bot.answerCallbackQuery(query.id, { 
            text: "❌ Access Denied: You are not a registered Admin.",
            show_alert: true 
          });
        } catch (e) {
          // ignore
        }
        return;
      }
    }

    // --- ADMIN BROADCAST CAMPAIGN CALLBACK HANDLERS ---
    const isBroadcastAction = data.startsWith("bcast_");
    if (isBroadcastAction) {
      const clickerId = query.from.id;
      if (!adminChatIds.has(clickerId)) {
        logBot(`Unauthorized broadcast action attempt by clickerId=${clickerId} on ${data}`);
        try {
          await bot.answerCallbackQuery(query.id, { 
            text: "❌ Access Denied: You are not a registered Admin.",
            show_alert: true 
          });
        } catch (e) {
          // ignore
        }
        return;
      }
    }

    if (data === "bcast_cancel") {
      const clickerId = query.from.id;
      broadcastStates.delete(clickerId);
      try {
        await bot.answerCallbackQuery(query.id, { text: "Studio Canceled" });
        if (messageId) {
          await bot.editMessageText(`❌ <b>Broadcast campaign studio closed.</b>`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML"
          });
        }
      } catch (e) {
        // ignore
      }
      return;
    }

    if (data === "bcast_back_dash") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (!state) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Session expired.", show_alert: true });
        return;
      }
      try {
        await bot.answerCallbackQuery(query.id);
        await renderBroadcastDashboard(bot, chatId, clickerId, state, messageId);
      } catch (e) {
        // ignore
      }
      return;
    }

    // Navigation sub-panels
    if (data === "bcast_dash_target") {
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await renderTargetSelection(bot, chatId, messageId);
        }
      } catch (e) {}
      return;
    }

    if (data === "bcast_dash_template") {
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await renderTemplateSelection(bot, chatId, messageId);
        }
      } catch (e) {}
      return;
    }

    if (data === "bcast_dash_style") {
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await renderStyleSelection(bot, chatId, messageId);
        }
      } catch (e) {}
      return;
    }

    if (data === "bcast_dash_history") {
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await renderBroadcastHistory(bot, chatId, messageId);
        }
      } catch (e) {}
      return;
    }

    if (data === "bcast_dash_custom_decor") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (!state) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Session expired.", show_alert: true });
        return;
      }
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await renderCustomDecorSelection(bot, chatId, messageId, state);
        }
      } catch (e) {}
      return;
    }

    if (data === "bcast_dash_buttons") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (!state) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Session expired.", show_alert: true });
        return;
      }
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await renderButtonsManager(bot, chatId, messageId, state);
        }
      } catch (e) {}
      return;
    }

    if (data === "bcast_custom_decor_header") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.step = 'awaiting_custom_header';
        try {
          await bot.answerCallbackQuery(query.id);
          await bot.sendMessage(chatId, `✍️ <b>Enter Custom Header Template</b>\n\nType the custom text you want to use as your visual header (e.g., <code>🔥 Ethiopian New Year Tournament 🔥</code>).\n\n💡 <i>You can use standard HTML markup (like <b>bold</b> or <i>italic</i>) and emojis. Type <code>none</code> to remove/clear completely.</i>`, { parse_mode: "HTML" });
        } catch (e) {}
      }
      return;
    }

    if (data === "bcast_custom_decor_footer") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.step = 'awaiting_custom_footer';
        try {
          await bot.answerCallbackQuery(query.id);
          await bot.sendMessage(chatId, `✍️ <b>Enter Custom Footer Subtext</b>\n\nType the custom subtext you want to append as your visual footer (e.g., <code>⚡ Offers expire in 2 hours!</code>).\n\n💡 <i>You can use standard HTML markup and emojis. Type <code>none</code> to remove/clear completely.</i>`, { parse_mode: "HTML" });
        } catch (e) {}
      }
      return;
    }

    if (data === "bcast_custom_decor_clear") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.customHeader = undefined;
        state.customFooter = undefined;
        try {
          await bot.answerCallbackQuery(query.id, { text: "🧹 Custom decor cleared" });
          if (messageId) {
            await renderCustomDecorSelection(bot, chatId, messageId, state);
          }
        } catch (e) {}
      }
      return;
    }

    if (data === "bcast_buttons_add") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.step = 'awaiting_btn_text';
        try {
          await bot.answerCallbackQuery(query.id);
          await bot.sendMessage(chatId, `✍️ <b>Add Custom Button</b>\n\nPlease enter the label text for this button (e.g., <code>Play Now 🎮</code> or <code>Join Group 👥</code>):`, { parse_mode: "HTML" });
        } catch (e) {}
      }
      return;
    }

    if (data === "bcast_buttons_clear") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.buttons = [];
        try {
          await bot.answerCallbackQuery(query.id, { text: "🧹 All custom buttons cleared" });
          if (messageId) {
            await renderButtonsManager(bot, chatId, messageId, state);
          }
        } catch (e) {}
      }
      return;
    }

    if (data === "bcast_buttons_done") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      logBot(`bcast_buttons_done clicked, state exists: ${!!state}`);
      if (state) {
        state.step = 'review';
        try {
          await bot.answerCallbackQuery(query.id);
          // Try to delete the button manager message
          if (messageId) {
            await bot.deleteMessage(chatId, messageId).catch(() => {});
          }
          logBot(`Calling showBroadcastReview...`);
          await showBroadcastReview(bot, chatId, clickerId, state);
          logBot(`showBroadcastReview called successfully`);
        } catch (e: any) {
          logBot(`Error in bcast_buttons_done: ${e.message}`);
        }
      }
      return;
    }

    // Set Targets
    if (data.startsWith("bcast_set_target_")) {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        const selectedTarget = data.replace("bcast_set_target_", "") as any;
        state.target = selectedTarget;
        try {
          await bot.answerCallbackQuery(query.id, { text: `🎯 Target updated!` });
          await renderBroadcastDashboard(bot, chatId, clickerId, state, messageId);
        } catch (e) {}
      }
      return;
    }

    // Set Templates
    if (data.startsWith("bcast_set_temp_")) {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        const selectedTemplate = data.replace("bcast_set_temp_", "") as any;
        state.template = selectedTemplate;
        try {
          await bot.answerCallbackQuery(query.id, { text: `🎨 Template preset updated!` });
          await renderBroadcastDashboard(bot, chatId, clickerId, state, messageId);
        } catch (e) {}
      }
      return;
    }

    // Past Campaign Retraction confirmation/execution
    if (data.startsWith("bcast_hist_retract_")) {
      const campaignId = data.replace("bcast_hist_retract_", "");
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await renderRetractConfirmation(bot, chatId, messageId, campaignId);
        }
      } catch (e) {}
      return;
    }

    if (data.startsWith("bcast_retract_execute_")) {
      const clickerId = query.from.id;
      const campaignId = data.replace("bcast_retract_execute_", "");
      const campaigns = loadCampaigns();
      const campIndex = campaigns.findIndex(c => c.id === campaignId);
      if (campIndex === -1) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Campaign not found.", show_alert: true });
        return;
      }
      
      const camp = campaigns[campIndex];
      try {
        await bot.answerCallbackQuery(query.id, { text: "Retracting..." });
        
        let statusMsg: any = null;
        if (messageId) {
          statusMsg = await bot.editMessageText(`⏳ <b>Retracting message from ${camp.sent_messages.length} player chats...</b>`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML"
          });
        } else {
          statusMsg = await bot.sendMessage(chatId, `⏳ <b>Retracting message from ${camp.sent_messages.length} player chats...</b>`, { parse_mode: "HTML" });
        }

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < camp.sent_messages.length; i++) {
          const item = camp.sent_messages[i];
          try {
            await bot.deleteMessage(item.chat_id, item.message_id);
            successCount++;
          } catch (e) {
            failCount++;
          }
          
          if (i % 20 === 0) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }

        // Remove from campaigns
        campaigns.splice(campIndex, 1);
        updateCampaignsFile(campaigns);

        const resultText = `🎉 <b>Campaign Retracted Successfully!</b>\n\n` +
          `The message has been removed from recipients' Telegram inboxes.\n\n` +
          `• ✅ Deleted from: <code>${successCount}</code> player chats\n` +
          `• ❌ Failed (already deleted/old): <code>${failCount}</code> chats\n\n` +
          `<i>Campaign record removed from history.</i>`;

        await bot.sendMessage(chatId, resultText, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to History", callback_data: "bcast_dash_history" }]]
          }
        });

      } catch (err: any) {
        logBot(`Retraction error: ${err.message}`);
        await bot.sendMessage(chatId, `❌ <b>Retraction failed:</b> ${err.message}`);
      }
      return;
    }

    if (data === "bcast_type_text") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.step = 'awaiting_text';
        state.type = 'text';
      } else {
        broadcastStates.set(clickerId, { step: 'awaiting_text', type: 'text', target: 'all', template: 'none' });
      }
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await bot.editMessageText(
            `📝 <b>Text-Only Announcement</b>\n\n` +
            `Please type and send the text message you want to broadcast.\n\n` +
            `💡 <i>HTML tags are supported:</i>\n` +
            `• <code>&lt;b&gt;bold&lt;/b&gt;</code>\n` +
            `• <code>&lt;i&gt;italics&lt;/i&gt;</code>\n` +
            `• <code>&lt;a href="LINK"&gt;text&lt;/a&gt;</code>\n\n` +
            `Send your message now, or type <code>/cancel</code> to abort.`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔙 Studio Dashboard", callback_data: "bcast_back_dash" }]
                ]
              }
            }
          );
        }
      } catch (e) {
        // ignore
      }
      return;
    }

    if (data === "bcast_type_photo") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.step = 'awaiting_photo';
        state.type = 'photo';
      } else {
        broadcastStates.set(clickerId, { step: 'awaiting_photo', type: 'photo', target: 'all', template: 'none' });
      }
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await bot.editMessageText(
            `🖼️ <b>Photo + Caption Announcement</b>\n\n` +
            `Please upload/send the <b>Photo</b> you want to broadcast.\n\n` +
            `💡 <i>Tip: You can add the styled caption directly on the photo before sending, or write it in the next step.</i>`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔙 Studio Dashboard", callback_data: "bcast_back_dash" }]
                ]
              }
            }
          );
        }
      } catch (e) {
        // ignore
      }
      return;
    }

    if (data === "bcast_type_photo_button") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.step = 'awaiting_photo';
        state.type = 'photo_button';
      } else {
        broadcastStates.set(clickerId, { step: 'awaiting_photo', type: 'photo_button', target: 'all', template: 'none' });
      }
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await bot.editMessageText(
            `🖼️ <b>Photo + Caption + Button Announcement</b>\n\n` +
            `Please upload/send the <b>Photo</b> you want to broadcast.\n\n` +
            `💡 <i>After uploading, you will be prompted to add caption and custom buttons.</i>`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔙 Studio Dashboard", callback_data: "bcast_back_dash" }]
                ]
              }
            }
          );
        }
      } catch (e) {
        // ignore
      }
      return;
    }

    if (data === "bcast_type_webapp") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.step = 'awaiting_text';
        state.type = 'webapp';
      } else {
        broadcastStates.set(clickerId, { step: 'awaiting_text', type: 'webapp', target: 'all', template: 'none' });
      }
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await bot.editMessageText(
            `🔘 <b>Play Button Announcement</b>\n\n` +
            `Please type and send the text message you want to broadcast.\n\n` +
            `💡 We will automatically append an interactive <b>"Play Game 🎮"</b> button linking straight to the Web App underneath your message.\n\n` +
            `Send your message now, or type <code>/cancel</code> to abort.`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔙 Studio Dashboard", callback_data: "bcast_back_dash" }]
                ]
              }
            }
          );
        }
      } catch (e) {
        // ignore
      }
      return;
    }

    if (data === "bcast_action_edit") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (!state) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Session expired.", show_alert: true });
        return;
      }
      try {
        await bot.answerCallbackQuery(query.id);
        if (state.type === 'photo') {
          state.step = 'awaiting_photo';
          await bot.sendMessage(chatId, `🖼️ <b>Please send the new Photo:</b>`, { parse_mode: "HTML" });
        } else {
          state.step = 'awaiting_text';
          await bot.sendMessage(chatId, `✍️ <b>Please send the new text message:</b>`, { parse_mode: "HTML" });
        }
      } catch (e) {
        // ignore
      }
      return;
    }

    if (data === "bcast_action_send" || data === "bcast_action_send_pin") {
      const clickerId = query.from.id;
      const composer = broadcastStates.get(clickerId);
      if (!composer) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Session expired.", show_alert: true });
        return;
      }

      const shouldPin = (data === "bcast_action_send_pin");
      try {
        await bot.answerCallbackQuery(query.id, { text: "🚀 Sending..." });
        
        // Notify of start
        const statusMsg = await bot.sendMessage(chatId, `⏳ <b>Filtering players from database...</b>`, { parse_mode: "HTML" });

        let realPlayers: any[] = [];
        const targetType = composer.target || 'all';

        if (targetType === 'test') {
          // Admin test run only
          realPlayers = Array.from(adminChatIds).map(id => ({ id: id.toString() }));
        } else if (targetType === 'whales') {
          // Users with balance >= 150000
          const { data: dbUsers, error: dbError } = await supabase
            .from('users')
            .select('id')
            .gte('balance', 150000);
          if (dbError) throw new Error(`Database fetch failed: ${dbError.message}`);
          realPlayers = (dbUsers || []).filter(u => u.id && /^-?\d+$/.test(u.id));
        } else if (targetType === 'active') {
          // Distinct players from game_logs
          const { data: logUsers, error: logError } = await supabase
            .from('game_logs')
            .select('user_id');
          if (logError) {
            const { data: dbUsers } = await supabase.from('users').select('id');
            realPlayers = (dbUsers || []).filter(u => u.id && /^-?\d+$/.test(u.id));
          } else {
            const activeIds = Array.from(new Set((logUsers || []).map(l => l.user_id).filter(Boolean)));
            realPlayers = activeIds.map(id => ({ id })).filter(u => u.id && /^-?\d+$/.test(u.id));
          }
        } else {
          // All Players
          const { data: dbUsers, error: dbError } = await supabase.from('users').select('id');
          if (dbError) throw new Error(`Database fetch failed: ${dbError.message}`);
          realPlayers = (dbUsers || []).filter(u => u.id && /^-?\d+$/.test(u.id));
        }

        if (realPlayers.length === 0) {
          await bot.editMessageText(`⚠️ <b>Aborted:</b> No players match the chosen audience filter.`, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: "HTML"
          });
          broadcastStates.delete(clickerId);
          return;
        }

        const totalPlayers = realPlayers.length;
        await bot.editMessageText(`📢 <b>Starting Campaign Delivery...</b>\n\n⚡ <i>Progress: 0% (0/${totalPlayers} sent)</i>`, {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: "HTML"
        });

        const campaignId = "camp_" + Date.now();
        const sentMessagesList: CampaignMessage[] = [];
        let successCount = 0;
        let failCount = 0;
        const startTime = Date.now();

        const campaignRawText = composer.textMessage || "";
        const campaignFormattedText = formatMessageWithTemplate(campaignRawText, composer.template, composer.customHeader, composer.customFooter);
        const playerButtons = buildCampaignReplyMarkup(composer, appUrl);
        const playerReplyMarkup = playerButtons.length > 0 ? { inline_keyboard: playerButtons } : undefined;

        for (let i = 0; i < totalPlayers; i++) {
          const playerId = realPlayers[i].id;
          if (!playerId) continue;

          try {
            let sentMsg: any = null;

            if ((composer.type === 'photo' || composer.type === 'photo_button') && composer.photoFileId) {
              sentMsg = await bot.sendPhoto(playerId, composer.photoFileId, {
                caption: campaignFormattedText,
                parse_mode: "HTML",
                reply_markup: playerReplyMarkup
              });
            } else {
              sentMsg = await bot.sendMessage(playerId, campaignFormattedText, {
                parse_mode: "HTML",
                reply_markup: playerReplyMarkup
              });
            }

            if (sentMsg) {
              sentMessagesList.push({
                chat_id: playerId,
                message_id: sentMsg.message_id
              });

              if (shouldPin) {
                await bot.pinChatMessage(playerId, sentMsg.message_id, { disable_notification: true })
                  .catch(() => {}); // catch if not supported
              }
            }

            successCount++;
          } catch (sendErr: any) {
            failCount++;
            logBot(`Broadcast delivery failed for player ${playerId}: ${sendErr.message}`);
          }

          // Throttle update
          if ((i + 1) % 10 === 0 || i === totalPlayers - 1) {
            const percent = Math.round(((i + 1) / totalPlayers) * 100);
            await bot.editMessageText(
              `📢 <b>Sending Broadcast Announcement...</b>\n\n` +
              `📊 <b>Progress:</b> <code>${percent}%</code> (${i + 1}/${totalPlayers})\n` +
              `✅ Delivered: <code>${successCount}</code>\n` +
              `❌ Failed: <code>${failCount}</code>`,
              {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: "HTML"
              }
            ).catch(() => {});
          }

          // Rate limit protection sleep (100ms)
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Save successfully sent message IDs to our persistent local campaign tracker
        if (sentMessagesList.length > 0) {
          saveCampaign({
            id: campaignId,
            timestamp: Date.now(),
            type: composer.type || 'text',
            target: targetType,
            template: composer.template || 'none',
            textSnippet: campaignRawText.slice(0, 50) || "Image-Only Broadcast",
            sent_messages: sentMessagesList
          });
        }

        await bot.sendMessage(
          chatId,
          `🎉 <b>Broadcast Campaign Completed!</b>\n\n` +
          `📊 <b>Results:</b>\n` +
          `• 👥 Total Target: <code>${totalPlayers} players</code>\n` +
          `• ✅ Successfully Sent: <code>${successCount}</code>\n` +
          `• ❌ Failed/Blocked: <code>${failCount}</code>\n` +
          `• 📌 Pinned: <code>${shouldPin ? 'Yes' : 'No'}</code>\n` +
          `• ⏱️ Delivery Time: <code>${elapsed} seconds</code>\n\n` +
          `💡 <i>Need to retract? You can instantly retract this campaign from the "Retract / Delete Campaigns" list!</i>`,
          { parse_mode: "HTML" }
        );

      } catch (err: any) {
        logBot(`Broadcast Campaign Error: ${err.message}`);
        await bot.sendMessage(chatId, `❌ <b>Campaign failed with error:</b>\n\n<code>${err.message}</code>`, { parse_mode: "HTML" });
      } finally {
        broadcastStates.delete(clickerId);
      }
      return;
    }

    // --- SETADMIN CONTROL PANEL CALLBACKS ---
    if (data === "setadmin_cancel") {
      const clickerId = query.from.id;
      if (isStartingAdmin(clickerId)) {
        setAdminStates.delete(clickerId);
        try {
          await bot.answerCallbackQuery(query.id, { text: "Operation Canceled" });
          if (messageId) {
            await bot.editMessageText(`❌ <b>Operation canceled.</b>`, {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML"
            });
          }
        } catch (e) {
          // ignore
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner only", show_alert: true });
      }
      return;
    }

    if (data === "setadmin_add_start") {
      const clickerId = query.from.id;
      if (isStartingAdmin(clickerId)) {
        setAdminStates.set(clickerId, { action: 'awaiting_add_userid' });
        try {
          await bot.answerCallbackQuery(query.id);
          if (messageId) {
            await bot.editMessageText(
              `🆔 <b>Please provide the Telegram User ID of the new admin:</b>\n\n` +
              `<i>Send the numeric User ID directly as a message (e.g., <code>5115194570</code>).</i>\n\n` +
              `You can find a user's ID using bot tools or via their profile info.`,
              {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "HTML"
              }
            );
          }
        } catch (e) {
          // ignore
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner only", show_alert: true });
      }
      return;
    }

    if (data === "setadmin_del_start") {
      const clickerId = query.from.id;
      if (isStartingAdmin(clickerId)) {
        try {
          await bot.answerCallbackQuery(query.id);

          // Get all other registered admins
          const otherAdmins = Array.from(adminChatIds).filter(id => !isStartingAdmin(id));

          if (otherAdmins.length === 0) {
            if (messageId) {
              await bot.editMessageText(
                `⚠️ <b>There are no other registered admins in the system.</b>`,
                {
                  chat_id: chatId,
                  message_id: messageId,
                  parse_mode: "HTML",
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: "🔙 Back", callback_data: "setadmin_back" }]
                    ]
                  }
                }
              );
            }
            return;
          }

          // Build inline buttons for each admin
          const keyboard = otherAdmins.map(id => [
            { text: `👤 Admin ID: ${id} ❌`, callback_data: `setadmin_del_confirm_${id}` }
          ]);
          keyboard.push([{ text: "🔙 Cancel", callback_data: "setadmin_cancel" }]);

          if (messageId) {
            await bot.editMessageText(
              `➖ <b>Select the Admin you want to delete:</b>`,
              {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "HTML",
                reply_markup: {
                  inline_keyboard: keyboard
                }
              }
            );
          }
        } catch (e) {
          // ignore
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner only", show_alert: true });
      }
      return;
    }

    if (data === "setadmin_back") {
      const clickerId = query.from.id;
      if (isStartingAdmin(clickerId)) {
        setAdminStates.delete(clickerId);
        try {
          await bot.answerCallbackQuery(query.id);
          if (messageId) {
            await bot.editMessageText(
              `👑 <b>Admin Control Panel</b>\n\nSelect an operation to manage administrator privileges:`,
              {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "HTML",
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: "➕ Add Admin", callback_data: "setadmin_add_start" },
                      { text: "➖ Delete Admin", callback_data: "setadmin_del_start" }
                    ],
                    [
                      { text: "🔒 Change Password", callback_data: "setadmin_change_pw_start" },
                      { text: "❌ Cancel", callback_data: "setadmin_cancel" }
                    ]
                  ]
                }
              }
            );
          }
        } catch (e) {
          // ignore
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner only", show_alert: true });
      }
      return;
    }

    if (data === "setadmin_change_pw_start") {
      const clickerId = query.from.id;
      if (isStartingAdmin(clickerId)) {
        setAdminStates.set(clickerId, { action: 'change_pw_old_auth' });
        try {
          await bot.answerCallbackQuery(query.id);
          if (messageId) {
            await bot.editMessageText(
              `🔒 <b>Change Password</b>\n\n` +
              `🔑 Please enter your <b>old/current password</b> as a message:\n\n` +
              `<i>If you have forgotten your password, click the "Forget Password" button below to receive it on Telegram (via @Scofield1621).</i>`,
              {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "HTML",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "📨 Forget Password ❓", callback_data: "setadmin_forget_pw" }],
                    [{ text: "🔙 Cancel", callback_data: "setadmin_cancel" }]
                  ]
                }
              }
            );
          }
        } catch (e) {
          // ignore
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner only", show_alert: true });
      }
      return;
    }

    if (data === "setadmin_forget_pw") {
      const clickerId = query.from.id;
      if (isStartingAdmin(clickerId)) {
        try {
          await bot.answerCallbackQuery(query.id, { text: "Retrieving and sending password to @Scofield1621..." });
          const password = getStoredPassword();

          // Locate the ID of Scofield1621 strictly and send to them
          let telegramSent = false;
          try {
            const { data: dbUsers } = await supabase
              .from('users')
              .select('id, username')
              .ilike('username', 'Scofield1621');

            if (dbUsers && dbUsers.length > 0) {
              for (const u of dbUsers) {
                if (u.id) {
                  await bot.sendMessage(u.id, `🔑 <b>Admin Password Recovery:</b>\n\nYour current admin password is: <code>${password}</code>`, { parse_mode: "HTML" });
                  telegramSent = true;
                }
              }
            } else if (query.from.username && query.from.username.toLowerCase() === 'scofield1621') {
              // Fallback to clicker if clicker is Scofield1621
              await bot.sendMessage(clickerId, `🔑 <b>Admin Password Recovery:</b>\n\nYour current admin password is: <code>${password}</code>`, { parse_mode: "HTML" });
              telegramSent = true;
            }
          } catch (dbErr: any) {
            logBot(`Error searching database for Scofield1621: ${dbErr.message}`);
          }

          if (messageId) {
            let statusText = `📨 <b>Success!</b>\n\n`;
            if (telegramSent) {
              statusText += `✅ Your current password has been sent directly to your Telegram chat (<b>@Scofield1621</b>).\n\n`;
            } else {
              statusText += `⚠️ Could not locate an active Telegram chat session for @Scofield1621. Make sure @Scofield1621 has started/messaged the bot first.\n\n` +
                `<i>For testing fallback: your current password is <code>${password}</code></i>\n\n`;
            }

            statusText += `<i>Please check your messages and enter the current password here to continue:</i>`;

            await bot.editMessageText(
              statusText,
              {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "HTML",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "🔙 Cancel", callback_data: "setadmin_cancel" }]
                  ]
                }
              }
            );
          }
        } catch (e) {
          // ignore
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner only", show_alert: true });
      }
      return;
    }

    if (data.startsWith("setadmin_del_confirm_")) {
      const clickerId = query.from.id;
      if (isStartingAdmin(clickerId)) {
        const targetIdStr = data.replace("setadmin_del_confirm_", "");
        const targetId = parseInt(targetIdStr, 10);

        if (!isNaN(targetId)) {
          setAdminStates.set(clickerId, {
            action: 'awaiting_del_password',
            deleteTargetId: targetId
          });

          try {
            await bot.answerCallbackQuery(query.id);
            if (messageId) {
              await bot.editMessageText(
                `⚠️ <b>Security Confirmation</b>\n\nYou are about to remove Admin ID <code>${targetId}</code>.\n\n` +
                `🔑 <b>Please enter your Owner Password as a message to confirm deletion:</b>`,
                {
                  chat_id: chatId,
                  message_id: messageId,
                  parse_mode: "HTML"
                }
              );
            }
          } catch (e) {
            // ignore
          }
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner only", show_alert: true });
      }
      return;
    }

    // --- MAIN BOT MENUS (SUPPORTING BOTH NEW AND OLD BUTTON PAYLOADS) ---
    if (data === "menu_deposit" || data === "deposit_info") {
      try {
        await bot.answerCallbackQuery(query.id);
      } catch (e) {
        logBot(`Failed to answer callback query: ${e}`);
      }
      return startDepositFlow(chatId, userId);
    }

    if (data === "menu_withdraw" || data === "withdraw_info") {
      try {
        await bot.answerCallbackQuery(query.id);
      } catch (e) {
        logBot(`Failed to answer callback query: ${e}`);
      }
      return startWithdrawalFlow(chatId, userId);
    }

    if (data === "menu_support") {
      try {
        await bot.answerCallbackQuery(query.id);
      } catch (e) {
        logBot(`Failed to answer callback query: ${e}`);
      }
      return sendSupportCard(chatId);
    }

    // --- DEPOSIT: BANK SELECTED ---
    if (data.startsWith("dep_bank_")) {
      const bank = data.replace("dep_bank_", "");
      const state = userStates.get(userId);

      if (!state || state.step !== 'deposit_bank') {
        bot.answerCallbackQuery(query.id, { text: "❌ Session expired. Please restart deposit." });
        return;
      }

      userStates.set(userId, {
        ...state,
        step: 'deposit_msg',
        bank
      });

      const amount = state.amount || 10;
      const bankConfig = promptsConfig.banks[bank] || { name: bank, account: "0931503559", owner_name: "Tadese" };
      const supportTxt = promptsConfig.support_text;

      const paymentInstructions = `${supportTxt}\n\n` +
        `1. ከታች ባለው የ*${bankConfig.name || bank}* አካውንት *${amount.toLocaleString()} ብር* ያስገቡ\n` +
        `    *Account/Phone:* \`${bankConfig.account}\`\n` +
        `    *Name:* \`${bankConfig.owner_name}\`\n\n` +
        `2. የከፈሉበትን አጭር የጹሁፍ መልዕክት(message) copy በማድረግ እዚ ላይ Past አድረገው ያስገቡና ይላኩት👇👇👇\n\n` +
        `_(Please copy and paste the SMS transaction receipt text as response)_`;

      bot.answerCallbackQuery(query.id);
      return bot.sendMessage(chatId, paymentInstructions, { parse_mode: "Markdown" });
    }

    // --- WITHDRAW: BANK SELECTED ---
    if (data.startsWith("wd_bank_")) {
      const bank = data.replace("wd_bank_", "");
      const state = userStates.get(userId);

      if (!state || state.step !== 'withdraw_bank') {
        bot.answerCallbackQuery(query.id, { text: "❌ Session expired. Please restart withdrawal." });
        return;
      }

      userStates.set(userId, {
        ...state,
        step: 'withdraw_account',
        bank
      });

      bot.answerCallbackQuery(query.id);

      if (bank === "Telebirr") {
        return bot.sendMessage(chatId, promptsConfig.withdraw_telebirr_prompt, { parse_mode: "Markdown" });
      } else {
        return bot.sendMessage(chatId, promptsConfig.withdraw_other_bank_prompt, { parse_mode: "Markdown" });
      }
    }

    // --- ADMIN ACTION: APPROVE DEPOSIT ---
    if (data.startsWith("approve_dep_")) {
      const requestId = data.replace("approve_dep_", "");
      const request = pendingRequests.get(requestId);

      if (!request) {
        bot.answerCallbackQuery(query.id, { text: "❌ Request not found or already processed." });
        return;
      }

      try {
        // Fetch current user balance
        const { data: user } = await supabase.from('users').select('balance').eq('id', request.userId).single();
        const currentBalance = user ? Number(user.balance) : 0;
        const newBalance = currentBalance + request.amount;

        // Update balance
        await supabase.from('users').update({ balance: newBalance }).eq('id', request.userId);

        // Add transaction ledger entry
        await supabase.from('transactions').insert({
          user_id: request.userId,
          amount: request.amount,
          type: 'reward',
          description: `Deposit Approved (Ref: ${requestId})`
        });

        // Unique verification Ref
        const refCode = "DEP_" + generateRef(10);

        // Send confirmation to User
        const successMsg = promptsConfig.deposit_approved_msg
          .replace(/{amount}/g, request.amount.toLocaleString())
          .replace(/{ref}/g, refCode);
        await bot.sendMessage(request.chatId, successMsg, { parse_mode: "Markdown" });
        await postToChannel(`✅ <b>New Deposit Confirmed!</b>\n\n👤 <b>User:</b> @${request.username}\n💰 <b>Amount:</b> <code>${request.amount.toLocaleString()} ETB</code>\n🧾 <b>Ref:</b> <code>${refCode}</code>`);

        // Update Client App UI Instantly via socket
        io.emit('balanceUpdated', { userId: request.userId, balance: newBalance });

        // Delete from pending store
        pendingRequests.delete(requestId);

        // Acknowledge Admin click
        bot.answerCallbackQuery(query.id, { text: "✅ Deposit approved!" });

        // Update Admin inline message
        const adminUsername = query.from.username || query.from.first_name || "Admin";
        const updatedAdminMsg = `📥 *DEPOSIT APPROVED (Ref: ${refCode})*\n\n` +
          `👤 *User:* @${request.username} (${request.fullName})\n` +
          `🆔 *User ID:* \`${request.userId}\`\n` +
          `💰 *Amount:* *${request.amount.toLocaleString()} ETB*\n` +
          `🏦 *Bank:* *${request.bank}*\n` +
          `📝 *Pasted Receipt SMS:*\n\`\`\`\n${request.receiptText}\n\`\`\`\n\n` +
          `✅ *Approved by admin:* @${adminUsername}`;

        if (messageId) {
          bot.editMessageText(updatedAdminMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown"
          }).catch(e => console.error("Admin msg update failed:", e));
        }

      } catch (err) {
        console.error("Failed to approve deposit:", err);
        bot.answerCallbackQuery(query.id, { text: "⚠️ Error processing deposit." });
      }
      return;
    }

    // --- ADMIN ACTION: DECLINE DEPOSIT ---
    if (data.startsWith("decline_dep_")) {
      const requestId = data.replace("decline_dep_", "");
      const request = pendingRequests.get(requestId);

      if (!request) {
        bot.answerCallbackQuery(query.id, { text: "❌ Request not found or already processed." });
        return;
      }

      try {
        // Send decline notification to User
        const declineMsg = promptsConfig.deposit_declined_msg
          .replace(/{amount}/g, request.amount.toLocaleString());
        await bot.sendMessage(request.chatId, declineMsg, { parse_mode: "Markdown" });

        // Delete from pending store
        pendingRequests.delete(requestId);

        // Acknowledge Admin click
        bot.answerCallbackQuery(query.id, { text: "❌ Deposit Declined" });

        // Update Admin inline message
        const adminUsername = query.from.username || query.from.first_name || "Admin";
        const updatedAdminMsg = `📥 *DEPOSIT DECLINED*\n\n` +
          `👤 *User:* @${request.username} (${request.fullName})\n` +
          `🆔 *User ID:* \`${request.userId}\`\n` +
          `💰 *Amount:* *${request.amount.toLocaleString()} ETB*\n` +
          `🏦 *Bank:* *${request.bank}*\n` +
          `📝 *Pasted Receipt SMS:*\n\`\`\`\n${request.receiptText}\n\`\`\`\n\n` +
          `❌ *Declined by admin:* @${adminUsername}`;

        if (messageId) {
          bot.editMessageText(updatedAdminMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown"
          }).catch(e => console.error("Admin msg update failed:", e));
        }

      } catch (err) {
        console.error("Failed to decline deposit:", err);
        bot.answerCallbackQuery(query.id, { text: "⚠️ Error processing decline." });
      }
      return;
    }

    // --- ADMIN ACTION: APPROVE WITHDRAWAL ---
    if (data.startsWith("approve_wd_")) {
      const requestId = data.replace("approve_wd_", "");
      const request = pendingRequests.get(requestId);

      if (!request) {
        bot.answerCallbackQuery(query.id, { text: "❌ Request not found or already processed." });
        return;
      }

      try {
        // Funds were already deducted when they submitted. We finalize the withdrawal.
        await supabase.from('transactions').insert({
          user_id: request.userId,
          amount: -request.amount,
          type: 'bet', // Record as debit transaction
          description: `Withdrawal Approved (Ref: ${requestId})`
        });

        // Unique Verification Ref
        const refCode = "WD_" + generateRef(10);

        // Send confirmation to User
        const successMsg = promptsConfig.withdraw_approved_msg
          .replace(/{amount}/g, request.amount.toLocaleString())
          .replace(/{ref}/g, refCode);
        await bot.sendMessage(request.chatId, successMsg, { parse_mode: "Markdown" });
        await postToChannel(`📤 <b>New Withdrawal Processed!</b>\n\n👤 <b>User:</b> @${request.username}\n💰 <b>Amount:</b> <code>${request.amount.toLocaleString()} ETB</code>\n🧾 <b>Ref:</b> <code>${refCode}</code>`);

        // Delete from pending store
        pendingRequests.delete(requestId);

        bot.answerCallbackQuery(query.id, { text: "✅ Withdrawal Approved!" });

        // Update Admin inline message
        const adminUsername = query.from.username || query.from.first_name || "Admin";
        const updatedAdminMsg = `📤 *WITHDRAWAL APPROVED (Ref: ${refCode})*\n\n` +
          `👤 *User:* @${request.username} (${request.fullName})\n` +
          `🆔 *User ID:* \`${request.userId}\`\n` +
          `💰 *Amount:* *${request.amount.toLocaleString()} ETB*\n` +
          `🏦 *Bank:* *${request.bank}*\n` +
          `💳 *Account/Phone:* \`${request.account}\`\n\n` +
          `✅ *Approved by admin:* @${adminUsername}`;

        if (messageId) {
          bot.editMessageText(updatedAdminMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown"
          }).catch(e => console.error("Admin msg update failed:", e));
        }

      } catch (err) {
        console.error("Failed to approve withdrawal:", err);
        bot.answerCallbackQuery(query.id, { text: "⚠️ Error processing approval." });
      }
      return;
    }

    // --- ADMIN ACTION: DECLINE WITHDRAWAL ---
    if (data.startsWith("decline_wd_")) {
      const requestId = data.replace("decline_wd_", "");
      const request = pendingRequests.get(requestId);

      if (!request) {
        bot.answerCallbackQuery(query.id, { text: "❌ Request not found or already processed." });
        return;
      }

      try {
        // Refund back to user's balance because it was deducted upon request
        const { data: user } = await supabase.from('users').select('balance').eq('id', request.userId).single();
        const currentBalance = user ? Number(user.balance) : 0;
        const refundedBalance = currentBalance + request.amount;

        await supabase.from('users').update({ balance: refundedBalance }).eq('id', request.userId);

        // Record a Refund ledger entry
        await supabase.from('transactions').insert({
          user_id: request.userId,
          amount: request.amount,
          type: 'reward',
          description: `Withdrawal Declined & Refunded (Ref: ${requestId})`
        });

        // Send detailed Decline & Refund message to user
        const declineMsg = promptsConfig.withdraw_declined_msg
          .replace(/{amount}/g, request.amount.toLocaleString())
          .replace(/{balance}/g, refundedBalance.toLocaleString());
        await bot.sendMessage(request.chatId, declineMsg, { parse_mode: "Markdown" });

        // Update Client App UI instantly via socket
        io.emit('balanceUpdated', { userId: request.userId, balance: refundedBalance });

        // Delete from pending store
        pendingRequests.delete(requestId);

        bot.answerCallbackQuery(query.id, { text: "❌ Withdrawal Declined" });

        // Update Admin inline message
        const adminUsername = query.from.username || query.from.first_name || "Admin";
        const updatedAdminMsg = `📤 *WITHDRAWAL DECLINED & REFUNDED*\n\n` +
          `👤 *User:* @${request.username} (${request.fullName})\n` +
          `🆔 *User ID:* \`${request.userId}\`\n` +
          `💰 *Amount:* *${request.amount.toLocaleString()} ETB*\n` +
          `🏦 *Bank:* *${request.bank}*\n` +
          `💳 *Account/Phone:* \`${request.account}\`\n\n` +
          `❌ *Declined by admin:* @${adminUsername}`;

        if (messageId) {
          bot.editMessageText(updatedAdminMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown"
          }).catch(e => console.error("Admin msg update failed:", e));
        }

      } catch (err) {
        console.error("Failed to decline and refund withdrawal:", err);
        bot.answerCallbackQuery(query.id, { text: "⚠️ Error processing withdrawal refund." });
      }
      return;
    }
    } catch (globalErr: any) {
      logBot(`[Callback Query ERROR] Unexpected dispatcher error: ${globalErr.message || globalErr}`);
      try {
        await bot.answerCallbackQuery(query.id, { text: "⚠️ An error occurred in the bot. Please try again." });
      } catch (err) {
        console.error("Failed to answer callback query after exception:", err);
      }
    }
  });

  // Start automated campaign background scheduler
  startAutoCampaignScheduler(bot);
  startAnnouncementScheduler(bot);
  
  // Start automated weekly promoter jackpot scheduler
  startAutomatedJackpotScheduler(bot);

  return botInfo?.username || null;
}

export function getBotUsername() {
  return botInfo?.username || null;
}

export async function triggerBotFlow(userId: string, flowType: 'deposit' | 'withdraw'): Promise<boolean> {
  logBot(`triggerBotFlow called for userId=${userId}, flowType=${flowType}`);
  const chatId = parseInt(userId, 10);
  if (isNaN(chatId)) {
    logBot(`Invalid userId for triggerBotFlow: ${userId}`);
    return false;
  }

  if (flowType === 'deposit') {
    if (startDepositFlowRef) {
      startDepositFlowRef(chatId, userId);
      return true;
    }
  } else if (flowType === 'withdraw') {
    if (startWithdrawalFlowRef) {
      await startWithdrawalFlowRef(chatId, userId);
      return true;
    }
  }
  return false;
}

const AUTO_CAMPAIGN_FILE = path.join(process.cwd(), "auto_campaign_config.json");

export function loadAutoCampaignConfig() {
  try {
    if (fs.existsSync(AUTO_CAMPAIGN_FILE)) {
      const data = JSON.parse(fs.readFileSync(AUTO_CAMPAIGN_FILE, "utf-8"));
      // Ensure we migrate old single prompt format to multi prompt list
      if (!data.prompts || !Array.isArray(data.prompts)) {
        const oldPromptText = data.promptText || "👋 Hey {name}! You haven't visited us in a while. Come play Even/Odd or Jackpot and double your ETB! 🎮";
        data.prompts = [
          { id: "prompt_1", text: oldPromptText }
        ];
        data.activePromptId = "prompt_1";
        delete data.promptText;
        saveAutoCampaignConfig(data);
      }
      return data;
    }
  } catch (e) {
    console.error("Failed to load auto campaign config:", e);
  }
  return {
    isEnabled: false,
    prompts: [
      {
        id: "prompt_1",
        text: "👋 Hey {name}! You haven't visited us in a while. Come play Even/Odd or Jackpot and double your ETB! 🎮"
      },
      {
        id: "prompt_2",
        text: "🎁 Daily Reward Waiting! Hey {name}, log in now and check your balance of {balance} ETB. Don't miss today's luck! 🍀"
      },
      {
        id: "prompt_3",
        text: "🔥 Action Alert! {name}, the live betting wheel is turning! Double your ETB instantly on Even/Odd. Come play now! 🚀"
      }
    ],
    activePromptId: "prompt_1",
    targetCategory: "all",
    balanceThresholdOperator: "any",
    balanceThresholdValue: 1000,
    inactivityDays: 3,
    intervalHours: 24,
    lastRunTime: 0
  };
}

export function saveAutoCampaignConfig(config: any) {
  try {
    fs.writeFileSync(AUTO_CAMPAIGN_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save auto campaign config:", e);
  }
}

export function startAutoCampaignScheduler(bot: any) {
  logBot("🤖 Auto Campaign background scheduler started successfully!");
  // Run checks every 5 minutes
  setInterval(async () => {
    try {
      const config = loadAutoCampaignConfig();
      if (!config.isEnabled) return;

      const now = Date.now();
      const intervalMs = config.intervalHours * 3600 * 1000;
      if (now - (config.lastRunTime || 0) < intervalMs) return;

      logBot("🤖 Starting Scheduled Auto Campaign check...");
      
      // Fetch matching users from DB
      let { data: users, error } = await supabase.from('users').select('*');
      if (error || !users) {
        logBot(`[AutoCampaign] Failed to fetch users: ${error?.message}`);
        return;
      }

      const target = config.targetCategory; // 'all' | 'whales' | 'active'
      const op = config.balanceThresholdOperator; // 'less_than' | 'greater_than' | 'any'
      const threshold = config.balanceThresholdValue;
      const days = config.inactivityDays;

      // Filter users
      const qualifyingUsers = users.filter((u: any) => {
        // Skip if no id or not numeric telegram ID
        if (!u.id || !/^-?\d+$/.test(u.id)) return false;

        // 1. Category Filter
        if (target === 'whales' && Number(u.balance) < 150000) return false;
        if (target === 'active') {
          if (!u.last_seen) return false;
        }
        
        // 2. Balance Filter
        if (op === 'less_than' && Number(u.balance) >= threshold) return false;
        if (op === 'greater_than' && Number(u.balance) <= threshold) return false;

        // 3. Inactivity Filter
        if (days > 0) {
          const activityTime = u.last_seen ? new Date(u.last_seen).getTime() : (u.created_at ? new Date(u.created_at).getTime() : now);
          const inactiveMs = days * 24 * 3600 * 1000;
          if (now - activityTime < inactiveMs) return false;
        }

        return true;
      });

      logBot(`[AutoCampaign] Found ${qualifyingUsers.length} qualifying users for scheduled delivery.`);

      const activePrompt = config.prompts?.find((p: any) => p.id === config.activePromptId) || config.prompts?.[0] || { text: "👋 Hey {name}! You haven't visited us in a while. Come play Even/Odd or Jackpot and double your ETB! 🎮" };
      const activeText = activePrompt.text;

      let successCount = 0;
      for (const user of qualifyingUsers) {
        try {
          const customizedText = activeText
            .replace(/{name}/g, escapeHTML(user.username || user.first_name || "Player"))
            .replace(/{balance}/g, Number(user.balance).toLocaleString());

          await bot.sendMessage(user.id, customizedText, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🎮 Play Game Hub 🚀", web_app: { url: globalAppUrl } }]
              ]
            }
          }).catch(async (e: any) => {
            logBot(`[AutoCampaign] HTML delivery failed for ${user.id}, retrying as plain text: ${e.message}`);
            // Fallback to plain text if HTML is invalid
            await bot.sendMessage(user.id, customizedText, {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🎮 Play Game Hub 🚀", web_app: { url: globalAppUrl } }]
                ]
              }
            });
          });
          successCount++;
          // Throttle slightly to avoid spamming TG servers
          await new Promise(r => setTimeout(r, 100));
        } catch (sendErr: any) {
          // ignore individual send errors
        }
      }

      config.lastRunTime = now;
      saveAutoCampaignConfig(config);
      logBot(`[AutoCampaign] Completed successfully. Delivered to ${successCount} users.`);
    } catch (err: any) {
      logBot(`[AutoCampaign] Unexpected error in scheduler: ${err.message}`);
    }
  }, 5 * 60 * 1000); // 5 minutes
}

export function startAutomatedJackpotScheduler(bot: any) {
  logBot("🤖 Automated Jackpot Scheduler started successfully!");
  setInterval(async () => {
    try {
      if (!supabase) return;

      const now = Date.now();
      const startOfWeek = getStartOfWeekUTC();
      const startOfWeekISO = startOfWeek.toISOString();
      const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 3600 * 1000);
      const announcementTime = new Date(endOfWeek.getTime() - 30 * 60 * 1000);

      // Check if we are in the last 30 minutes of the week
      if (now >= announcementTime.getTime() && now < endOfWeek.getTime()) {
        // Check if an announcement already exists for this week starting ISO
        const { data: annList, error: annError } = await supabase
          .from('transactions')
          .select('id')
          .eq('type', 'jackpot_announcement')
          .eq('description', startOfWeekISO)
          .limit(1);

        if (annError) {
          logBot(`[AutomatedJackpot] Error checking existing announcement: ${annError.message}`);
          return;
        }

        if (!annList || annList.length === 0) {
          logBot(`[AutomatedJackpot] Time to announce jackpot for week starting ${startOfWeekISO}. Running...`);
          
          const stats = await fetchLeaderboardData();
          const totalJackpot = stats.promoterJackpot;

          // Insert announcement to prevent double triggering
          await supabase.from('transactions').insert({
            user_id: 'system_jackpot',
            amount: totalJackpot,
            type: 'jackpot_announcement',
            description: startOfWeekISO
          });

          const msgText = `📢 <b>UPCOMING WEEKLY PROMOTER JACKPOT DISTRIBUTION!</b>\n\n` +
            `The Weekly Promoter Jackpot distribution is scheduled to happen in exactly <b>30 minutes</b> (at the turn of the week)!\n\n` +
            `💰 <b>Jackpot Pool Amount:</b> <b>${totalJackpot.toLocaleString()} ETB</b>\n` +
            `<i>(Reward is 5% of 50% of the platform's weekly overall retained fees, with no Guaranteed Minimum)</i>\n\n` +
            `🏆 <b>Current Top Standings:</b>\n` +
            (stats.leaderboard && stats.leaderboard.length > 0 
              ? stats.leaderboard.slice(0, 3).map((entry, idx) => {
                  const displayName = entry.first_name || entry.username || `User_${entry.referrer_id.slice(0, 6)}`;
                  const prizeShare = idx === 0 ? 0.50 : idx === 1 ? 0.30 : 0.20;
                  const shareAmount = Math.floor(totalJackpot * prizeShare);
                  return `🏅 <b>Rank ${idx+1}:</b> ${displayName} — Vol: <b>${entry.volume.toLocaleString()} ETB</b> (Est. Reward: <b>${shareAmount.toLocaleString()} ETB</b>)`;
                }).join('\n')
              : `<i>No qualified referrers recorded yet this week.</i>`) +
            `\n\n📢 Promote your referral link <code>/referral</code> now to secure or upgrade your ranking before distribution! 🎮`;

          // Broadcast to all users
          const { data: allUsers } = await supabase.from('users').select('id');
          let successCount = 0;
          if (allUsers) {
            for (const u of allUsers) {
              if (!u.id || u.id === 'system_jackpot') continue;
              try {
                await bot.sendMessage(u.id, msgText, { parse_mode: "HTML" });
                successCount++;
              } catch (broadcastErr) {
                // Ignore blocked/deleted chats
              }
            }
          }
          logBot(`[AutomatedJackpot] Successfully broadcasted weekly jackpot announcement to ${successCount} users.`);
        }
      }
    } catch (err: any) {
      logBot(`[AutomatedJackpot] Error in scheduler: ${err.message}`);
    }
  }, 60000); // Check every minute
}

async function renderAutoCampaignDashboard(chatId: number, messageId?: number) {
  if (!botInstance) return;
  const config = loadAutoCampaignConfig();
  
  const targetLabel: Record<string, string> = {
    all: '👥 All Registered Players',
    active: '⚡ Active Players (with history)',
    whales: '💰 High Balancers / Whales (>= 150K)',
  };

  let balanceFilterLabel = "No Limit";
  if (config.balanceThresholdOperator === 'less_than') {
    balanceFilterLabel = `Balance &lt; ${config.balanceThresholdValue.toLocaleString()} ETB`;
  } else if (config.balanceThresholdOperator === 'greater_than') {
    balanceFilterLabel = `Balance &gt; ${config.balanceThresholdValue.toLocaleString()} ETB`;
  }

  const activePrompt = config.prompts?.find((p: any) => p.id === config.activePromptId) || config.prompts?.[0] || { text: "None configured." };

  const text = `🤖 <b>Auto Campaign Scheduler</b>\n\n` +
    `Configure automated bot invitations & advertisements sent to subscribers automatically.\n\n` +
    `⚙️ <b>Current Settings:</b>\n` +
    `• <b>Status:</b> ${config.isEnabled ? "🟢 ACTIVE (Scheduled)" : "🔴 PAUSED"}\n` +
    `• <b>Target Category:</b> <code>${escapeHTML(targetLabel[config.targetCategory] || config.targetCategory)}</code>\n` +
    `• <b>Balance Filter:</b> <code>${balanceFilterLabel}</code>\n` +
    `• <b>Inactivity Days:</b> <code>${config.inactivityDays > 0 ? `${config.inactivityDays} Days Offline` : "No Limit"}</code>\n` +
    `• <b>Send Frequency:</b> Every <code>${config.intervalHours} Hours</code>\n` +
    `• <b>Last Run:</b> <code>${config.lastRunTime ? new Date(config.lastRunTime).toLocaleString() : "Never"}</code>\n\n` +
    `📢 <b>Active Message Template:</b>\n` +
    `<i>${escapeHTML(activePrompt.text)}</i>\n\n` +
    `👇 <b>Manage Scheduler:</b>`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: config.isEnabled ? "🔴 Pause Scheduler" : "🟢 Activate Scheduler", callback_data: "autocamp_toggle" },
        { text: "💬 Manage Prompts List", callback_data: "autocamp_prompts_list" }
      ],
      [
        { text: "👥 Set Target Category", callback_data: "autocamp_set_target" },
        { text: "💤 Set Offline Days", callback_data: "autocamp_set_days" }
      ],
      [
        { text: "🏦 Set Balance Filter", callback_data: "autocamp_set_bal" },
        { text: "⏱️ Set Send Interval", callback_data: "autocamp_set_hours" }
      ],
      [
        { text: "⚡ Test Run (Send to Me)", callback_data: "autocamp_test" },
        { text: "🔙 Back to Control", callback_data: "control_back" }
      ]
    ]
  };

  if (messageId) {
    await botInstance.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard }).catch(() => {
      botInstance.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    });
  } else {
    await botInstance.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

async function renderPromptsListDashboard(chatId: number, messageId?: number) {
  if (!botInstance) return;
  const config = loadAutoCampaignConfig();
  const prompts = config.prompts || [];

  let text = `📂 <b>Campaign Prompts List</b>\n\n` +
    `Select, view, edit, or create new automatic campaign message templates. The active one will be automatically selected and dispatched when scheduled runs fire.\n\n` +
    `<b>Available Templates:</b>\n`;

  const inlineKeyboard: any[] = [];

  prompts.forEach((p: any, idx: number) => {
    const isActive = p.id === config.activePromptId;
    const snippet = p.text.length > 40 ? p.text.substring(0, 37) + "..." : p.text;
    const indicator = isActive ? "✅ " : "📄 ";
    text += `${idx + 1}. ${indicator} <i>${escapeHTML(snippet)}</i>\n`;
    
    inlineKeyboard.push([
      { text: `${idx + 1}. ${isActive ? "[Active] " : ""}${p.text.substring(0, 20)}...`, callback_data: `autocamp_p_view_${p.id}` }
    ]);
  });

  if (prompts.length === 0) {
    text += "⚠️ No prompt templates found! Create one now.";
  }

  text += `\n👇 <b>Select a template to Manage or Create a new one:</b>`;

  inlineKeyboard.push([
    { text: "➕ Create New Prompt", callback_data: "autocamp_p_add" }
  ]);
  inlineKeyboard.push([
    { text: "🔙 Back to Scheduler", callback_data: "control_autocamp" }
  ]);

  const keyboard = { inline_keyboard: inlineKeyboard };

  if (messageId) {
    await botInstance.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard }).catch(() => {
      botInstance.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    });
  } else {
    await botInstance.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

async function renderPromptDetailsDashboard(chatId: number, promptId: string, messageId?: number) {
  if (!botInstance) return;
  const config = loadAutoCampaignConfig();
  const prompts = config.prompts || [];
  const prompt = prompts.find((p: any) => p.id === promptId);

  if (!prompt) {
    await botInstance.sendMessage(chatId, "⚠️ Prompt template not found.");
    await renderPromptsListDashboard(chatId);
    return;
  }

  const isActive = prompt.id === config.activePromptId;

  const text = `ℹ️ <b>Prompt Template Details</b>\n\n` +
    `• <b>ID:</b> <code>${escapeHTML(prompt.id)}</code>\n` +
    `• <b>Status:</b> ${isActive ? "✅ ACTIVE (Currently used by scheduler)" : "💤 INACTIVE"}\n\n` +
    `📝 <b>Template Content:</b>\n` +
    `----------------------------------------\n` +
    `${escapeHTML(prompt.text)}\n` +
    `----------------------------------------\n\n` +
    `💡 <i>Placeholders supported: <code>{name}</code>, <code>{balance}</code>.</i>\n\n` +
    `👇 <b>Manage Template:</b>`;

  const inlineKeyboard: any[] = [];

  if (!isActive) {
    inlineKeyboard.push([{ text: "🎯 Activate & Select", callback_data: `autocamp_p_activate_${promptId}` }]);
  }

  inlineKeyboard.push([
    { text: "📝 Edit Text Content", callback_data: `autocamp_p_edit_${promptId}` },
    { text: "🗑️ Delete Template", callback_data: `autocamp_p_delete_${promptId}` }
  ]);

  inlineKeyboard.push([{ text: "🔙 Back to Prompts List", callback_data: "autocamp_prompts_list" }]);

  const keyboard = { inline_keyboard: inlineKeyboard };

  if (messageId) {
    await botInstance.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard }).catch(() => {
      botInstance.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    });
  } else {
    await botInstance.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
  }
}
