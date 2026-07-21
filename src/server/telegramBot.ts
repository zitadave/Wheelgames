import { registerCommandHandlers } from "./bot/commands.js";
import TelegramBot from "node-telegram-bot-api";
import { supabase } from "./supabase.js";
import { getAnalysisSummary } from "./analysis.js";
import { Server } from "socket.io";
import { fetchLeaderboardData, getStartOfWeekUTC } from "./leaderboardHelper.js";
import { logBot, getBotLogs } from "./logger.js";
import { startAnnouncementScheduler, loadAnnouncements, saveAnnouncements, Announcement, processAnnouncements, generateSlotNumbers, formatEmojiNumbers, downloadAndSendPhoto, processAnnouncementText, syncAnnouncementsFromSupabase } from "./announcementManager.js";
import { txManager } from "./transactionManager.js";
import * as fs from "fs";
import * as path from "path";
import ExcelJS from 'exceljs';
import { handleSupportChat, addKnowledgeChunk, searchKnowledgeBase } from "./aiSupport.js";
import { handleUsersReport, handleFinancialReport, generateDummyUsersExcelBuffer } from "./reports.js";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType, BorderStyle } from "docx";
import { getGameSettingsSync, saveGameSettings, isGameEnabled, getGameConfig } from "./gameSettings.js";


let botInfo: any = (globalThis as any).telegramBotInfo || null;
let botInstance: any = (globalThis as any).telegramBotInstance && (globalThis as any).telegramBotInstance !== "initializing" ? (globalThis as any).telegramBotInstance : null;
let globalAppUrl = process.env.APP_URL || "https://wheelgames1.onrender.com";

// getChannelId relocated below promptsConfig initialization

// logBot and getBotLogs moved to logger.ts to break circular dependencies

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
  if (promptsConfig && promptsConfig.tx_channel_posts_enabled === false) {
    return;
  }
  const channelId = getChannelId();
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

export function escapeHTML(str: string) {
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
  gameId?: string;
  targetUserId?: string;
}

const userStates = new Map<string, UserState>();
const userLanguages = new Map<number, string>();
const registeredUsersCache = new Set<string>();

// Simple balance cache to speed up lookups (valid for 30 seconds)
const userBalanceCache = new Map<string, { balance: number; timestamp: number }>();

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
  withdraw_prompt?: string;
}

interface PromptsConfig {
  deposit_start_msg: string;
  deposit_success_msg: string;
  deposit_approved_msg: string;
  deposit_declined_msg: string;
  deposit_payment_instructions_msg: string;
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
  channel_id?: string;
  tx_channel_posts_enabled?: boolean;
  custom_commands?: {
    [cmd: string]: CustomCommand;
  };

  weekly_jackpot_amount?: number;
  automated_jackpot_broadcast_enabled?: boolean;
  banks: {
    [bankId: string]: BankConfig;
  };
}

const DEFAULT_PROMPTS_CONFIG: PromptsConfig = {
  automated_jackpot_broadcast_enabled: true,
  deposit_start_msg: "💰 *ማስገባት የሚፈልጉትን መጠን ከ10 ብር ጀምሮ ያስገቡ።*\n\n_(Please type the amount of ETB you want to deposit, minimum 10 ETB):_",
  deposit_success_msg: "✅ *Your deposit Request have been sent to admins please wait 1 min.*",
  deposit_approved_msg: "✅ *Your deposit of {amount} ETB is confirmed.*\n🧾 *Ref:* `{ref}`",
  deposit_declined_msg: "❌ *Your deposit of {amount} ETB is Declined.*",
  deposit_payment_instructions_msg: "1. ከታች ባለው የ*{bank_name}* አካውንት *{amount} ብር* ያስገቡ\n    *Account/Phone:* `{account}`\n    *Name:* `{owner_name}`\n\n2. የከፈሉበትን አጭር የጹሁፍ መልዕክት(message) copy በማድረግ እዚ ላይ Past አድረገው ያስገቡና ይላኩት👇👇👇\n\n_(Please copy and paste the SMS transaction receipt text as response)_",
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

  welcome_msg: "👋 *Welcome to ETB Game Hub, {name}!* 🎮\n\nExperience the thrill of real-time multiplayer gaming right here in Telegram!\n\n💰 *Your current balance:* `{balance}`\n\n🚀 *Available Games:*\n• 🎱 <b>Bingo (ቢንጎ):</b> Focusing on daily tournaments and big wins.\n• ⚖️ <b>Mola/Godele (ሞላ/ጎደለ):</b> Highlighting the simplicity and instant results of the game.\n• 🍀 <b>Edil (ዕድል):</b> Focusing on daily luck and jackpot opportunities.\n• 🚀 <b>Fettan (ፈጣን):</b> Emphasizing speed, 24/7 service, and fast payouts.\n\n👇 Click the buttons below to start playing!",
  welcome_image: "",
  welcome_guest_msg: "🎮 <b>Welcome to ETB Game Hub!</b> 🚀\n\nExperience the ultimate Telegram gaming destination!\n\n• 🎱 <b>Bingo (ቢንጎ):</b> Daily tournaments & big wins.\n• ⚖️ <b>Mola/Godele (ሞላ/ጎደለ):</b> Simple & instant results.\n• 🍀 <b>Edል (ዕድል):</b> Luck & jackpot opportunities.\n• 🚀 <b>Fettan (ፈጣን):</b> Speed & fast payouts.\n\n💎 <i>Play instantly, win with real-time multipliers, and withdraw directly to your favorite wallet!</i>",
  welcome_guest_image: "",
  support_card_msg: "📞 *Contact Support*\n\n📱 *Phone:* `+251-931-50-35-59`\n📧 *Email:* `support@wheelgame.et`\n💬 *Telegram:* @scofiled1\n\n⏰ *Support Hours:*\nMonday - Sunday: 9 AM - 9 PM\n\nWe're here to help!",
 
  welcome_buttons: [
    [
      { text: "🎮 Play Game Hub 🚀", type: "webapp", value: "appUrl" }
    ],
    [
      { text: "🎱 Bingo (ቢንጎ)", type: "webapp", value: "appUrl" },
      { text: "⚖️ Mola/Godele (ሞላ/ጎደለ)", type: "webapp", value: "appUrl" }
    ],
    [
      { text: "🍀 Edil (ዕድል)", type: "webapp", value: "appUrl" },
      { text: "🚀 Fettan (ፈጣን)", type: "webapp", value: "appUrl" }
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
  channel_id: "",
  tx_channel_posts_enabled: true,
  referral_buttons: [
    [
      { text: "📢 Share to Friends", type: "url", value: "https://t.me/share/url?url=https://t.me/{bot_username}?start=ref_{user_id}&text={referral_share_text}" }
    ]
  ],
  custom_commands: {},
  weekly_jackpot_amount: 1000,
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
const AUTO_CAMPAIGN_FILE = path.join(process.cwd(), "auto_campaign_config.json");
const CHANNEL_ID_FILE_PATH = path.join(process.cwd(), "channel_id.json");

let promptsConfig: PromptsConfig = { ...DEFAULT_PROMPTS_CONFIG };

/**
 * Persists Channel ID and Prompts Config to Supabase for durability in ephemeral environments (Cloud Run).
 * Falls back to local files for initialization.
 */

export function getChannelId() {
  // Priority 1: dedicated channel_id.json (Local Cache)
  try {
    if (fs.existsSync(CHANNEL_ID_FILE_PATH)) {
      let cid = fs.readFileSync(CHANNEL_ID_FILE_PATH, "utf8").trim();
      cid = cid.replace(/^["']|["']$/g, '');
      if (cid && cid !== "" && cid !== 'null' && cid !== 'undefined') return cid;
    }
  } catch (e) {}

  // Priority 2: promptsConfig
  const configId = promptsConfig?.channel_id;
  if (configId && configId.trim() !== "") return configId.trim();

  // Priority 3: Environment Variables
  const envId = process.env.CHANNEL_ID || process.env.TELEGRAM_CHANNEL_ID;
  if (envId && envId.trim() !== "") return envId.trim();
  
  return null;
}

let isConfigLoaded = false;

async function saveChannelIdToSupabase(channelId: string) {
  if (!isConfigLoaded) {
    logBot("[SUPABASE] ERROR: Refusing to save channel_id because configuration has not been successfully loaded from Supabase.");
    return;
  }
  try {
    await supabase.from("bot_config").upsert({ key: "channel_id", value: channelId });
  } catch (err) {
    logBot(`[SUPABASE] Failed to save channel_id: ${err}`);
  }
}

async function savePromptsToSupabase(config: PromptsConfig) {
  if (!isConfigLoaded) {
    logBot("[SUPABASE] ERROR: Refusing to save prompts_v4 because configuration has not been successfully loaded from Supabase.");
    return;
  }
  try {
    const jsonStr = JSON.stringify(config);
    await supabase.from("bot_config").upsert({ key: "prompts_v4", value: jsonStr, updated_at: new Date().toISOString() });
    logBot("[SUPABASE] Prompts persisted to database (prompts_v4).");
  } catch (err) {
    logBot(`[SUPABASE] Failed to save prompts_v4: ${err}`);
  }
}

async function loadConfigFromSupabase() {
  let retries = 5;
  while (retries > 0) {
    try {
      logBot(`[SUPABASE] Loading configuration (v4) - Attempt ${6 - retries}...`);
      
      // 1. Load Channel ID
      const { data: cidData, error: cidError } = await supabase.from("bot_config").select("value").eq("key", "channel_id").maybeSingle();
      if (cidError) throw new Error(`Channel ID fetch failed: ${cidError.message}`);
      if (cidData?.value) {
        const cid = cidData.value.trim();
        fs.writeFileSync(CHANNEL_ID_FILE_PATH, cid, "utf8");
        logBot(`[SUPABASE] Channel ID loaded: ${cid}`);
      }

      // 2. Load Prompts (v4 with v3 fallback migration)
      let promptsDataVal = null;
      const { data: promptsV4Data, error: promptsV4Error } = await supabase.from("bot_config").select("value").eq("key", "prompts_v4").maybeSingle();
      if (promptsV4Error) throw new Error(`Prompts v4 fetch failed: ${promptsV4Error.message}`);
      
      if (promptsV4Data?.value) {
        promptsDataVal = promptsV4Data.value;
        logBot("[SUPABASE] Prompts (v4) successfully found and loaded.");
      } else {
        logBot("[SUPABASE] No prompts_v4 found. Attempting to migrate from prompts_v3...");
        const { data: promptsV3Data, error: promptsV3Error } = await supabase.from("bot_config").select("value").eq("key", "prompts_v3").maybeSingle();
        if (promptsV3Error) {
          logBot(`[SUPABASE] Migration warning: prompts_v3 fetch failed: ${promptsV3Error.message}`);
        } else if (promptsV3Data?.value) {
          promptsDataVal = promptsV3Data.value;
          // Persist the migrated value into v4
          await supabase.from("bot_config").upsert({ key: "prompts_v4", value: promptsV3Data.value, updated_at: new Date().toISOString() });
          logBot("[SUPABASE] Migrated existing prompts from prompts_v3 to prompts_v4 successfully.");
        }
      }

      const localConfig = loadPromptsConfig();

      if (promptsDataVal) {
        const dbData = JSON.parse(promptsDataVal);
        
        // Use smart merge to preserve local developer edits
        const { merged, changed } = mergeConfigs(localConfig, dbData, DEFAULT_PROMPTS_CONFIG);
        
        fs.writeFileSync(PROMPTS_CONFIG_FILE_PATH, JSON.stringify(merged, null, 2), "utf8");
        promptsConfig = loadPromptsConfig();
        logBot(`[SUPABASE] Prompts merged with local customizations. Keys found: ${Object.keys(merged).length}`);
        
        if (changed) {
          logBot("[SUPABASE] Local prompt/bank edits detected. Syncing merged config back to Supabase...");
          isConfigLoaded = true; // Set to true temporarily so savePromptsToSupabase is allowed to write
          await savePromptsToSupabase(merged);
        }
      } else {
        logBot("[SUPABASE] No prompts_v4 or prompts_v3 found in database. Initializing database with local/hardcoded defaults.");
        fs.writeFileSync(PROMPTS_CONFIG_FILE_PATH, JSON.stringify(localConfig, null, 2), "utf8");
        promptsConfig = localConfig;
        isConfigLoaded = true; // Set to true temporarily so savePromptsToSupabase is allowed to write
        await savePromptsToSupabase(localConfig);
      }

      // 3. Load Auto Campaign (v4 with v3 fallback migration)
      let campaignDataVal = null;
      const { data: campaignV4Data, error: campaignV4Error } = await supabase.from("bot_config").select("value").eq("key", "auto_campaign_v4").maybeSingle();
      if (campaignV4Error) throw new Error(`Auto Campaign v4 fetch failed: ${campaignV4Error.message}`);

      if (campaignV4Data?.value) {
        campaignDataVal = campaignV4Data.value;
        logBot("[SUPABASE] Auto Campaign (v4) successfully found and loaded.");
      } else {
        logBot("[SUPABASE] No auto_campaign_v4 found. Attempting to migrate from auto_campaign_v3...");
        const { data: campaignV3Data, error: campaignV3Error } = await supabase.from("bot_config").select("value").eq("key", "auto_campaign_v3").maybeSingle();
        if (campaignV3Error) {
          logBot(`[SUPABASE] Migration warning: auto_campaign_v3 fetch failed: ${campaignV3Error.message}`);
        } else if (campaignV3Data?.value) {
          campaignDataVal = campaignV3Data.value;
          await supabase.from("bot_config").upsert({ key: "auto_campaign_v4", value: campaignV3Data.value, updated_at: new Date().toISOString() });
          logBot("[SUPABASE] Migrated existing campaign settings from auto_campaign_v3 to auto_campaign_v4 successfully.");
        }
      }

      if (campaignDataVal) {
        const data = JSON.parse(campaignDataVal);
        fs.writeFileSync(AUTO_CAMPAIGN_FILE, JSON.stringify(data, null, 2), "utf8");
        logBot("[SUPABASE] Auto Campaign loaded to disk.");
      } else {
        logBot("[SUPABASE] No auto_campaign_v4 or auto_campaign_v3 found in database. Using local defaults.");
      }

      // 4. Load Announcements
      await syncAnnouncementsFromSupabase();

      // 5. Load APP_URL
      const { data: urlData, error: urlError } = await supabase.from("bot_config").select("value").eq("key", "app_url").maybeSingle();
      if (urlError) throw new Error(`APP_URL fetch failed: ${urlError.message}`);
      if (urlData?.value) {
        globalAppUrl = urlData.value.trim();
        logBot(`[SUPABASE] APP_URL loaded: ${globalAppUrl}`);
      }

      isConfigLoaded = true;
      logBot("[SUPABASE] Configuration (v4) successfully loaded.");
      return; // Success!
    } catch (err: any) {
      retries--;
      logBot(`[SUPABASE] Attempt failed to load config: ${err.message}. Retries left: ${retries}`);
      if (retries === 0) {
        logBot("[SUPABASE] CRITICAL: Failed to load configuration from Supabase after 5 attempts. Falling back to local files without marking database as loaded.");
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
}

async function saveAutoCampaignToSupabase(config: any) {
  if (!isConfigLoaded) {
    logBot("[SUPABASE] ERROR: Refusing to save auto_campaign_v4 because configuration has not been successfully loaded from Supabase.");
    return;
  }
  try {
    const jsonStr = JSON.stringify(config);
    await supabase.from("bot_config").upsert({ key: "auto_campaign_v4", value: jsonStr, updated_at: new Date().toISOString() });
    logBot("[SUPABASE] Auto Campaign persisted to database (auto_campaign_v4).");
  } catch (err) {
    logBot(`[SUPABASE] Failed to save auto_campaign_v4: ${err}`);
  }
}

async function saveAppUrlToSupabase(url: string) {
  if (!isConfigLoaded) {
    logBot("[SUPABASE] ERROR: Refusing to save app_url because configuration has not been successfully loaded from Supabase.");
    return;
  }
  try {
    await supabase.from("bot_config").upsert({ key: "app_url", value: url });
    logBot(`[SUPABASE] APP_URL persisted to database: ${url}`);
  } catch (err) {
    logBot(`[SUPABASE] Failed to save app_url: ${err}`);
  }
}

function loadPromptsConfig(): PromptsConfig {
  try {
    if (fs.existsSync(PROMPTS_CONFIG_FILE_PATH)) {
      const fileData = fs.readFileSync(PROMPTS_CONFIG_FILE_PATH, "utf8");
      const data = JSON.parse(fileData);
      
      // Start with a clean deep clone of the hardcoded defaults
      const config: PromptsConfig = JSON.parse(JSON.stringify(DEFAULT_PROMPTS_CONFIG));
      
      // Explicitly overwrite properties from file data
      Object.keys(data).forEach(key => {
        if (['banks', 'custom_commands', 'welcome_buttons', 'referral_buttons'].includes(key)) {
          // Complex objects/arrays must be completely replaced to allow deletion to persist
          (config as any)[key] = JSON.parse(JSON.stringify(data[key]));
        } else {
          // Primitive types
          (config as any)[key] = data[key];
        }
      });
      
      logBot(`[CONFIG] Loaded from disk. Active Payment Gateways: ${Object.keys(config.banks).join(", ")}`);
      return config;
    }
  } catch (err: any) {
    logBot(`[CONFIG] Warning: Failed to load config from disk (${err.message}). Using defaults.`);
  }
  return JSON.parse(JSON.stringify(DEFAULT_PROMPTS_CONFIG));
}

function mergeConfigs(local: PromptsConfig, db: PromptsConfig, defaults: PromptsConfig): { merged: PromptsConfig, changed: boolean } {
  const merged = JSON.parse(JSON.stringify(db));
  let changed = false;

  const isEqual = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

  // 1. Merge primitive/simple keys
  const simpleKeys = Object.keys(defaults).filter(k => k !== 'banks' && k !== 'custom_commands' && k !== 'welcome_buttons' && k !== 'referral_buttons') as (keyof PromptsConfig)[];
  for (const key of simpleKeys) {
    const localVal = local[key];
    const dbVal = db[key];
    const defaultVal = defaults[key];

    if (localVal !== undefined && !isEqual(localVal, defaultVal)) {
      if (!isEqual(localVal, dbVal)) {
        logBot(`[CONFIG-MERGE] Prompt key '${key}' customized locally. Merging local value.`);
        (merged as any)[key] = JSON.parse(JSON.stringify(localVal));
        changed = true;
      }
    }
  }

  // 2. Merge banks bank-by-bank
  merged.banks = merged.banks || {};
  const allBankIds = Array.from(new Set([
    ...Object.keys(local.banks || {}),
    ...Object.keys(db.banks || {}),
    ...Object.keys(defaults.banks || {})
  ]));

  for (const bankId of allBankIds) {
    const localBank = local.banks?.[bankId];
    const dbBank = db.banks?.[bankId];
    const defaultBank = defaults.banks?.[bankId];

    if (localBank === undefined) {
      // Bank was deleted or not present locally
      if (dbBank !== undefined && defaultBank !== undefined) {
        // If it was a default bank, and developer removed it locally, delete from merged
        logBot(`[CONFIG-MERGE] Default bank '${bankId}' was removed locally. Deleting from DB.`);
        delete merged.banks[bankId];
        changed = true;
      }
      continue;
    }

    if (dbBank === undefined) {
      // New bank added locally
      logBot(`[CONFIG-MERGE] New bank '${bankId}' added locally. Syncing to DB.`);
      merged.banks[bankId] = JSON.parse(JSON.stringify(localBank));
      changed = true;
      continue;
    }

    // Bank exists in both, merge properties (name, account, owner_name, withdraw_prompt)
    const props = ['name', 'account', 'owner_name', 'withdraw_prompt'];
    for (const prop of props) {
      const localPropVal = (localBank as any)[prop];
      const dbPropVal = (dbBank as any)[prop];
      const defaultPropVal = defaultBank ? (defaultBank as any)[prop] : undefined;

      if (localPropVal !== undefined && !isEqual(localPropVal, defaultPropVal)) {
        if (!isEqual(localPropVal, dbPropVal)) {
          logBot(`[CONFIG-MERGE] Bank '${bankId}' prop '${prop}' customized locally. Merging.`);
          (merged.banks[bankId] as any)[prop] = localPropVal;
          changed = true;
        }
      }
    }
  }

  // 3. Merge custom_commands command-by-command
  merged.custom_commands = merged.custom_commands || {};
  const allCmds = Array.from(new Set([
    ...Object.keys(local.custom_commands || {}),
    ...Object.keys(db.custom_commands || {})
  ]));
  for (const cmd of allCmds) {
    const localCmd = local.custom_commands?.[cmd];
    const dbCmd = db.custom_commands?.[cmd];

    if (localCmd === undefined) continue;
    if (dbCmd === undefined) {
      logBot(`[CONFIG-MERGE] New custom command '${cmd}' added locally. Syncing.`);
      merged.custom_commands[cmd] = JSON.parse(JSON.stringify(localCmd));
      changed = true;
      continue;
    }

    if (!isEqual(localCmd, dbCmd)) {
      logBot(`[CONFIG-MERGE] Custom command '${cmd}' modified locally. Merging.`);
      merged.custom_commands[cmd] = JSON.parse(JSON.stringify(localCmd));
      changed = true;
    }
  }

  // 4. Merge buttons
  const buttonKeys = ['welcome_buttons', 'referral_buttons'] as (keyof PromptsConfig)[];
  for (const key of buttonKeys) {
    const localVal = local[key];
    const dbVal = db[key];
    const defaultVal = defaults[key];

    if (localVal !== undefined && !isEqual(localVal, defaultVal)) {
      if (!isEqual(localVal, dbVal)) {
        logBot(`[CONFIG-MERGE] Button group '${key}' customized locally. Merging.`);
        (merged as any)[key] = JSON.parse(JSON.stringify(localVal));
        changed = true;
      }
    }
  }

  return { merged, changed };
}

function savePromptsConfig(config: PromptsConfig) {
  if (!isConfigLoaded) {
    logBot("[CONFIG] ERROR: Cannot save prompts config. Configuration has not been successfully loaded from Supabase. Aborting save to prevent overwriting database with defaults.");
    return;
  }
  try {
    // 1. Create a snapshot to ensure we're saving exactly what was requested
    const dataToSave = JSON.parse(JSON.stringify(config));
    const jsonStr = JSON.stringify(dataToSave, null, 2);
    
    // 2. Synchronous write to ensure completion (Local Cache)
    fs.writeFileSync(PROMPTS_CONFIG_FILE_PATH, jsonStr, "utf8");
    
    // 3. Update the global runtime variable with the snapshot
    promptsConfig = dataToSave;

    // 4. Async push to Supabase for persistence across container restarts
    savePromptsToSupabase(dataToSave).catch(err => logBot(`[ERROR] Supabase sync failed: ${err}`));
    
    logBot(`[CONFIG] Saved to disk & sync started. Current Gateways: ${Object.keys(config.banks).join(", ")}`);
  } catch (err: any) {
    logBot(`[CONFIG] CRITICAL ERROR: Could not save configuration to disk! ${err.message}`);
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
  rejectReason?: string;
}

const processedMessages = new Set<string>();
const processedCallbacks = new Set<string>();

export const pendingRequests = new Map<string, PendingRequest>();

export async function savePendingRequestsToDB() {
  try {
    const list = Array.from(pendingRequests.values());
    const jsonStr = JSON.stringify(list);
    await supabase
      .from('bot_config')
      .upsert({
        key: 'pending_transaction_requests',
        value: jsonStr,
        updated_at: new Date().toISOString()
      });
    logBot(`[DB Sync] Saved ${list.length} pending requests to database.`);
  } catch (err: any) {
    logBot(`Failed to save pending requests to DB: ${err.message}`);
  }
}

async function loadPendingRequestsFromDB() {
  try {
    const { data, error } = await supabase
      .from('bot_config')
      .select('value')
      .eq('key', 'pending_transaction_requests')
      .maybeSingle();

    if (error) {
      logBot(`Error loading pending requests from DB: ${error.message}`);
      return;
    }

    if (data?.value) {
      const parsed = JSON.parse(data.value) as PendingRequest[];
      pendingRequests.clear();
      for (const req of parsed) {
        pendingRequests.set(req.id, req);
      }
      logBot(`[DB Sync] Loaded ${pendingRequests.size} pending requests from database.`);
    }
  } catch (err: any) {
    logBot(`Failed to load pending requests from DB: ${err.message}`);
  }
}

// Dynamic Owner configurations to prevent Access Denied for testers
const OWNER_IDS = new Set<number>([336997351]);

export async function getPromptsConfig(): Promise<PromptsConfig> {
  return promptsConfig;
}

function isOwner(userId: number | undefined): boolean {
  if (!userId) return false;
  return OWNER_IDS.has(userId);
}

function isStartingAdmin(userId: number | undefined): boolean {
  if (!userId) return false;
  if (OWNER_IDS.has(userId)) return true;
  
  const envId = process.env.ADMIN_ID;
  if (envId && parseInt(envId, 10) === userId) return true;
  
  const adminEnv = process.env.TELEGRAM_ADMIN_IDS;
  if (adminEnv) {
    const ids = adminEnv.split(',').map(id => parseInt(id.trim(), 10));
    if (ids.includes(userId)) return true;
  }
  
  return userId === getPrimaryOwnerId();
}

export function getPrimaryOwnerId(): number {
  const envId = process.env.ADMIN_ID || process.env.TELEGRAM_ADMIN_IDS?.split(',')[0];
  if (envId) {
    const parsed = parseInt(envId, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return 336997351; // Fallback
}

export function isAnyAdmin(userId: number | string | undefined): boolean {
  if (!userId) return false;
  const uid = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (isNaN(uid)) return false;
  return isStartingAdmin(uid) || isOwner(uid) || adminChatIds.has(uid);
}

// Admin Chat IDs (Initialized with all owners/starting admins)
export const adminChatIds = new Set<number>(OWNER_IDS);
adminChatIds.add(getPrimaryOwnerId());

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
      logBot(`Syncing ${adminUsers.length} admins from database...`);
      adminUsers.forEach(u => {
        const id = parseInt(u.id, 10);
        if (!isNaN(id)) adminChatIds.add(id);
      });
      logBot(`Current total unique admins in memory: ${adminChatIds.size}`);
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

// Blocked User cache for Abuse Prevention
const blockedUsersCache = new Set<string>();

async function syncBlockedUsersFromDB() {
  try {
    const { data: blockedUsers, error } = await supabase
      .from('users')
      .select('id')
      .eq('is_blocked_bot', true);
    
    if (error) {
      if (!error.message.includes('schema cache')) {
        logBot(`Error fetching blocked users from DB: ${error.message}`);
      }
      return;
    }

    if (blockedUsers) {
      blockedUsersCache.clear();
      blockedUsers.forEach(u => {
        blockedUsersCache.add(String(u.id));
      });
      logBot(`Current total unique blocked users in memory: ${blockedUsersCache.size}`);
    }
  } catch (err: any) {
    logBot(`syncBlockedUsersFromDB error: ${err.message}`);
  }
}

// Generate unique Ref Codes (e.g., C8OM3PUXUX, OTY2A7PFR2)
export function generateRef(length = 10): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function getBotInstance() {
  return botInstance;
}

let isBotInitializing = false;

export async function initTelegramBot(io: Server): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not found. Telegram bot is disabled.");
    return null;
  }

  if (isBotInitializing || (global as any).telegramBotInstance === "initializing") {
    console.log("Telegram Bot already initializing. Waiting...");
    return botInfo?.username || (global as any).telegramBotInfo?.username || null;
  }

  // If there's an existing instance that is already a bot, just return its username
  if ((global as any).telegramBotInstance && typeof (global as any).telegramBotInstance === "object" && (global as any).telegramBotInstance !== "initializing") {
    console.log("Telegram Bot already initialized in this process. Reusing instance.");
    botInstance = (global as any).telegramBotInstance;
    botInfo = (global as any).telegramBotInfo;
    return botInfo?.username || null;
  }

  isBotInitializing = true;
  (global as any).telegramBotInstance = "initializing"; // Temporary lock

  const currentProcessId = process.pid;
  logBot(`Bot initialization started. PID: ${currentProcessId}, Timestamp: ${Date.now()}`);
  
  // Load persistent configuration from Supabase before starting the bot
  await loadConfigFromSupabase();

  // Make sure we strip any trailing slash
  globalAppUrl = globalAppUrl.replace(/\/$/, "");
  
  logBot(`Bot initializing with APP_URL: ${globalAppUrl}`);
  
  const TelegramBotClass = typeof TelegramBot === "function" 
    ? TelegramBot 
    : ((TelegramBot as any).default || TelegramBot);
  
  const bot = new (TelegramBotClass as any)(token, { 
    polling: {
      interval: 100, // Faster polling (100ms instead of 300ms) for snappy responses
      autoStart: true,
      params: {
        timeout: 50 // Longer timeout for long polling (standard practice)
      }
    }
  });
  botInstance = bot;
  (global as any).telegramBotInstance = bot;
  (global as any).telegramBotInfo = botInfo;
  isBotInitializing = false;

  // Monkey-patch to ignore "message is not modified" errors globally
  const originalEditMessageText = bot.editMessageText.bind(bot);
  bot.editMessageText = async (text: any, options: any) => {
    try {
      return await originalEditMessageText(text, options);
    } catch (e: any) {
      if (e.message && e.message.includes("message is not modified")) {
        return true;
      }
      throw e;
    }
  };

  const originalEditMessageReplyMarkup = bot.editMessageReplyMarkup.bind(bot);
  bot.editMessageReplyMarkup = async (replyMarkup: any, options: any) => {
    try {
      return await originalEditMessageReplyMarkup(replyMarkup, options);
    } catch (e: any) {
      if (e.message && e.message.includes("message is not modified")) {
        return true;
      }
      throw e;
    }
  };

  const originalAnswerCallbackQuery = bot.answerCallbackQuery.bind(bot);
  bot.answerCallbackQuery = async (callbackQueryId: string, options: any) => {
    try {
      return await originalAnswerCallbackQuery(callbackQueryId, options);
    } catch (e: any) {
      if (e.message && (e.message.includes("query is too old") || e.message.includes("query_id_invalid"))) {
        return true;
      }
      throw e;
    }
  };

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

  syncBlockedUsersFromDB().catch(err => {
    logBot(`Error in syncBlockedUsersFromDB background execution: ${err.message || err}`);
  });

  loadPendingRequestsFromDB().catch(err => {
    logBot(`Error in loadPendingRequestsFromDB background execution: ${err.message || err}`);
  });

  // Periodically sync admins from DB every 10 minutes
  setInterval(() => {
    syncAdminsFromDB().catch(err => logBot(`Scheduled admin sync failed: ${err.message || err}`));
  }, 10 * 60 * 1000);

  // Periodically sync blocked users from DB every 10 minutes
  setInterval(() => {
    syncBlockedUsersFromDB().catch(err => logBot(`Scheduled blocked users sync failed: ${err.message || err}`));
  }, 10 * 60 * 1000);

  // Start Announcement Scheduler
  startAnnouncementScheduler(botInstance);

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
        const channelId = getChannelId();
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
            web_app: { url: globalAppUrl }
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
      // Check cache first
      const cached = userBalanceCache.get(userId);
      if (cached && Date.now() - cached.timestamp < 30000) {
        return { balance: cached.balance };
      }

      const { data, error } = await supabase.from('users').select('balance').eq('id', userId);
      if (error) {
        logBot(`supabase error fetching user ID=${userId}: ${error.message}`);
        return null;
      }
      if (data && data.length > 0) {
        registeredUsersCache.add(userId);
        const balance = Number(data[0].balance);
        userBalanceCache.set(userId, { balance, timestamp: Date.now() });
        return { balance };
      }

      logBot(`User ID=${userId} not found. Creating user in database...`);
      const { data: insertedData, error: insertError } = await supabase
        .from('users')
        .insert({
          id: userId,
          username: username || null,
          first_name: firstName || null,
          last_name: lastName || null,
          balance: 0
        })
        .select('balance')
        .single();

      if (insertError) {
        logBot(`Error inserting user ID=${userId}: ${insertError.message}`);
        return { balance: 0 };
      }
      registeredUsersCache.add(userId);
      const balance = insertedData ? Number(insertedData.balance) : 0;
      userBalanceCache.set(userId, { balance, timestamp: Date.now() });
      return { balance };
    } catch (e: any) {
      logBot(`Unexpected error in getOrCreateUser for ID=${userId}: ${e?.message || e}`);
      return { balance: 0 };
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
      if (registeredUsersCache.has(userId)) {
        await onRegistered();
        return;
      }
      const { data, error } = await supabase.from('users').select('id').eq('id', userId);
      if (data && data.length > 0) {
        registeredUsersCache.add(userId);
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

  // Logic for commands now handled in main message dispatcher
  // registerCommandHandlers(bot, logBot, checkRegisteredAndHandle, sendSupportCard, userStates);

  // --- BOT COMMANDS HANDLERS ---
  
  // Start Command
  // Removed bot.onText listeners for start and play as they are now in the unified dispatcher

  // Quick Command triggers for Deposits and Withdrawals
  // (Removed individual onText handlers to prevent duplication - now handled in message dispatcher)


  // Built-in command listeners (centralized in dispatcher)


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

  



  function renderMainControlPanel(chatId: number, messageId?: number) {
    if (!isStartingAdmin(chatId)) {
      bot.sendMessage(chatId, "❌ <b>Access Denied.</b>\n\nThis panel is restricted to the starting administrator of this bot.", { parse_mode: "HTML" });
      return;
    }
    const channelId = getChannelId() || "⚠️ <b>NOT CONFIGURED</b>";
    const currentAppUrl = globalAppUrl || "⚠️ <b>NOT CONFIGURED</b>";
    const text = `🛠️ <b>Main Control Panel</b>\n\n` +
                 `🎯 <b>Target Channel:</b> <code>${channelId}</code>\n` +
                 `🌐 <b>App URL:</b> <code>${currentAppUrl}</code>\n` +
                 `<i>(The bot posts announcements to the channel and launches the game using this URL)</i>`;
    const keyboard = {
      inline_keyboard: [
        [
          { text: "🛰️ Configure Channel ID", callback_data: "cmd_ann_set_channel" },
          { text: "🌐 Set APP_URL", callback_data: "cmd_set_app_url" }
        ],
        [
          { text: "👑 Set Admin", callback_data: "control_setadmin" },
          { text: "📊 Analysis", callback_data: "control_analysis" }
        ],
        [
          { text: "📢 Broadcast", callback_data: "control_broadcast" },
          { text: "📝 Edit Prompts", callback_data: "control_edit" }
        ],
        [
          { text: "📢 Announcements", callback_data: "control_announcement_menu" },
          { text: "📌 Unpin All Broadcasts", callback_data: "control_unpin_all" }
        ],
        [
          { text: "🔗 Command Links", callback_data: "control_links" },
          { text: "🤖 Auto Campaigns", callback_data: "control_autocamp" }
        ],
        [
          { text: "🤖 AI Support Settings", callback_data: "control_ai_instructions" },
          { text: "📚 Knowledge Base", callback_data: "control_kb_main" }
        ],
        [
          { text: "🔍 User Lookup", callback_data: "control_user_lookup" },
          { text: "🤝 Manage Affiliate", callback_data: "control_manage_affiliate" }
        ],
        [
          { text: "🎮 የጨዋታዎች መቆጣጠሪያ (Game Settings)", callback_data: "control_game_settings" }
        ],
        [
          { text: "👥 Users Report", callback_data: "control_users_report" },
          { text: "💰 Financial Report", callback_data: "control_financial_report" }
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

  function renderGameSettingsPanel(chatId: number, messageId?: number) {
    const settings = getGameSettingsSync();
    let text = "🎮 <b>የጨዋታዎች መቆጣጠሪያ ፓናል (Game Settings)</b>\n\n" +
               "በቦቱ ላይ ያሉትን ጨዋታዎች በጊዜያዊነት ማገድ (Toggle on/off)፣ አነስተኛ እና ከፍተኛ የውርርድ መጠን (Min/Max limits) ማስተካከል፣ እንዲሁም የአሸናፊነት ማባዣ ክፍያዎችን (Payout Multipliers) በቀጥታ ከዚህ ማስተካከል ይችላሉ።\n\n" +
               "<i>የሚፈለገውን ጨዋታ በመምረጥ ማስተካከያ ያድርጉ:</i>";
               
    const keyboard = {
      inline_keyboard: [] as any[]
    };

    const keys = Object.keys(settings);
    for (const key of keys) {
      const g = settings[key];
      const statusEmoji = g.enabled ? "🟢" : "🔴";
      keyboard.inline_keyboard.push([
        { text: `${statusEmoji} ${g.nameAm}`, callback_data: `game_set_select:${g.id}` }
      ]);
    }

    keyboard.inline_keyboard.push([
      { text: "🔙 ወደ ዋናው ማውጫ (Back to Main)", callback_data: "game_set_back_main" }
    ]);

    if (messageId) {
      bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard })
        .catch(() => bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard }));
    } else {
      bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    }
  }

  function renderSingleGameSettings(chatId: number, gameId: string, messageId?: number) {
    const g = getGameConfig(gameId);
    if (!g) {
      bot.sendMessage(chatId, "❌ ጨዋታው አልተገኘም።");
      return;
    }

    const statusEmoji = g.enabled ? "🟢" : "🔴";
    const statusTextAm = g.enabled ? "ንቁ (Enabled)" : "የታገደ (Disabled)";
    
    const isSlotOrBingo = g.id.startsWith("jackpot_") || g.id.startsWith("bingo_");
    const labelMin = isSlotOrBingo ? "የቲኬት መግቢያ ዋጋ (Ticket Entry Fee)" : "ዝቅተኛ ውርርድ (Min Bet Limit)";
    const labelMax = isSlotOrBingo ? "ከፍተኛ የቲኬት ገደብ (Max Limit)" : "ከፍተኛ ውርርድ (Max Bet Limit)";
    const labelMult = g.id.startsWith("bingo_") ? "የአሸናፊነት ክፍያ ስርጭት (Payout Ratio)" : "የአሸናፊነት ማባዣ (Payout Multiplier)";

    let text = `🎮 <b>የ${g.nameAm} ማስተካከያ ፓናል</b>\n\n` +
               `👉 <b>ሁኔታ (Status):</b> ${statusEmoji} ${statusTextAm}\n` +
               `👉 <b>${labelMin}:</b> <code>${g.minBet.toLocaleString()} ETB</code>\n` +
               `👉 <b>${labelMax}:</b> <code>${g.maxBet.toLocaleString()} ETB</code>\n` +
               `👉 <b>${labelMult}:</b> <code>${g.multiplier}x</code>\n\n` +
               `<i>ከታች ያሉትን ቁልፎች በመጠቀም ማስተካከያ ማድረግ ይችላሉ:</i>`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: `${g.enabled ? "🔴 ጨዋታውን እገድ (Disable)" : "🟢 ጨዋታውን አንቃ (Enable)"}`, callback_data: `game_set_toggle:${g.id}` }
        ],
        [
          { text: `📉 ${isSlotOrBingo ? "መግቢያ ዋጋ ቀይር" : "ዝቅተኛ ውርርድ ቀይር"}`, callback_data: `game_set_min:${g.id}` },
          { text: `📈 ${isSlotOrBingo ? "ከፍተኛ ገደብ ቀይር" : "ከፍተኛ ውርርድ ቀይር"}`, callback_data: `game_set_max:${g.id}` }
        ],
        [
          { text: `✖️ ${g.id.startsWith("bingo_") ? "የክፍያ ስርጭት ቀይር" : "የአሸናፊነት ማባዣ ቀይር"}`, callback_data: `game_set_mult:${g.id}` }
        ],
        [
          { text: "🔙 ወደ ጨዋታዎች ዝርዝር (Back)", callback_data: "game_set_back_list" }
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

  async function processUserLookup(chatId: number, targetIdentifier: string, messageId?: number) {
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

      // Even/Odd game (ሞላ/ጎደለ)
      const evenOddBets = bets || [];
      const totalEvenOddWagered = evenOddBets.reduce((s, b) => s + Number(b.amount), 0) || 0;
      const evenOddWins = logs?.filter(l => l.game_type?.startsWith('Even/Odd')) || [];
      const totalEvenOddWins = evenOddWins.reduce((s, l) => s + Number(l.win_amount), 0) || 0;

      // Bingo (ቢንጎ)
      const bingo10Txs = txs?.filter(t => (t.type === 'bet' || t.type === 'refund') && t.description?.includes('bingo-10')) || [];
      const bingo10Bets = bingo10Txs.filter(t => t.type === 'bet');
      const bingo10Wagered = Math.abs(bingo10Txs.reduce((s, t) => s + Number(t.amount), 0));
      const bingo10Wins = txs?.filter(t => t.type === 'win' && t.description?.includes('Bingo Win (bingo-10)')) || [];
      const bingo10Won = bingo10Wins.reduce((s, t) => s + Number(t.amount), 0);

      const bingo20Txs = txs?.filter(t => (t.type === 'bet' || t.type === 'refund') && t.description?.includes('bingo-20')) || [];
      const bingo20Bets = bingo20Txs.filter(t => t.type === 'bet');
      const bingo20Wagered = Math.abs(bingo20Txs.reduce((s, t) => s + Number(t.amount), 0));
      const bingo20Wins = txs?.filter(t => t.type === 'win' && t.description?.includes('Bingo Win (bingo-20)')) || [];
      const bingo20Won = bingo20Wins.reduce((s, t) => s + Number(t.amount), 0);

      // Fast Game (ፈጣን - 1-10, 1-20)
      const fast10Txs = txs?.filter(t => (t.type === 'bet' || t.type === 'refund') && t.description?.includes('in 1-10')) || [];
      const fast10Bets = fast10Txs.filter(t => t.type === 'bet');
      const fast10Wagered = Math.abs(fast10Txs.reduce((s, t) => s + Number(t.amount), 0));
      const fast10Wins = txs?.filter(t => t.type === 'win' && t.description?.includes('in 1-10')) || [];
      const fast10Won = fast10Wins.reduce((s, t) => s + Number(t.amount), 0);

      const fast20Txs = txs?.filter(t => (t.type === 'bet' || t.type === 'refund') && t.description?.includes('in 1-20')) || [];
      const fast20Bets = fast20Txs.filter(t => t.type === 'bet');
      const fast20Wagered = Math.abs(fast20Txs.reduce((s, t) => s + Number(t.amount), 0));
      const fast20Wins = txs?.filter(t => t.type === 'win' && t.description?.includes('in 1-20')) || [];
      const fast20Won = fast20Wins.reduce((s, t) => s + Number(t.amount), 0);

      // Jackpot (ዕድል - mini, grand)
      const jackpotMiniTxs = txs?.filter(t => (t.type === 'bet' || t.type === 'refund') && t.description?.includes('in mini')) || [];
      const jackpotMiniBets = jackpotMiniTxs.filter(t => t.type === 'bet');
      const jackpotMiniWagered = Math.abs(jackpotMiniTxs.reduce((s, t) => s + Number(t.amount), 0));
      const jackpotMiniWins = txs?.filter(t => t.type === 'win' && t.description?.includes('in mini')) || [];
      const jackpotMiniWon = jackpotMiniWins.reduce((s, t) => s + Number(t.amount), 0);

      const jackpotGrandTxs = txs?.filter(t => (t.type === 'bet' || t.type === 'refund') && t.description?.includes('in grand')) || [];
      const jackpotGrandBets = jackpotGrandTxs.filter(t => t.type === 'bet');
      const jackpotGrandWagered = Math.abs(jackpotGrandTxs.reduce((s, t) => s + Number(t.amount), 0));
      const jackpotGrandWins = txs?.filter(t => t.type === 'win' && t.description?.includes('in grand')) || [];
      const jackpotGrandWon = jackpotGrandWins.reduce((s, t) => s + Number(t.amount), 0);

      // Keno (ኬኖ)
      const kenoTxs = txs?.filter(t => (t.type === 'bet' || t.type === 'refund') && t.description?.includes('Keno Bet')) || [];
      const kenoBets = kenoTxs.filter(t => t.type === 'bet');
      const kenoWagered = Math.abs(kenoTxs.reduce((s, t) => s + Number(t.amount), 0));
      const kenoWins = txs?.filter(t => t.type === 'win' && t.description?.includes('Keno Win')) || [];
      const kenoWon = kenoWins.reduce((s, t) => s + Number(t.amount), 0);

      const totalRoundsPlayed = evenOddBets.length + bingo10Bets.length + bingo20Bets.length + fast10Bets.length + fast20Bets.length + jackpotMiniBets.length + jackpotGrandBets.length + kenoBets.length;
      const directReferralsCount = (await supabase.from('users').select('id', { count: 'exact', head: true }).eq('referrer_id', targetId)).count || 0;

      const totalWon = totalEvenOddWins + bingo10Won + bingo20Won + fast10Won + fast20Won + jackpotMiniWon + jackpotGrandWon + kenoWon;
      const totalWagered = totalEvenOddWagered + bingo10Wagered + bingo20Wagered + fast10Wagered + fast20Wagered + jackpotMiniWagered + jackpotGrandWagered + kenoWagered;
      
      const playerProfit = totalWon - totalWagered;
      const netHouseGGR = totalWagered - totalWon;

      let report = `👤 <b>Admin User Report:</b> <code>${targetId}</code>\n` +
                   `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                   `👤 <b>Username:</b> @${user.username || 'N/A'}\n` +
                   `🏷️ <b>Full Name:</b> ${escapeHTML(user.full_name || 'N/A')}\n` +
                   `📞 <b>Phone Number:</b> ${user.phone_number || 'N/A'}\n` +
                   `🌐 <b>Language Preference:</b> ${user.language_code || 'en'}\n` +
                   `🤝 <b>Referred By:</b> ${user.referrer_id || 'None'}\n` +
                   `👑 <b>Admin Status:</b> ${user.is_admin ? '👑 Administrator' : '👤 Regular Player'}\n` +
                   `🚫 <b>Bot Access Status:</b> ${user.is_blocked_bot ? '🔴 BLOCKED BY BOT' : '🟢 Active/Allowed'}\n` +
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
                   `🎲 <b>ሞላ/ጎደለ (Even/Odd):</b> <code>${totalEvenOddWagered.toLocaleString()} ETB</code> (${evenOddBets.length} plays)\n` +
                   `  └ Wins: <code>${totalEvenOddWins.toLocaleString()} ETB</code>\n` +
                   `🎡 <b>ፈጣን (Fast Games):</b>\n` +
                   `  └ 1-10: <code>${fast10Wagered.toLocaleString()} ETB</code> (${fast10Bets.length} plays, Wins: <code>${fast10Won.toLocaleString()} ETB</code>)\n` +
                   `  └ 1-20: <code>${fast20Wagered.toLocaleString()} ETB</code> (${fast20Bets.length} plays, Wins: <code>${fast20Won.toLocaleString()} ETB</code>)\n` +
                   `🏆 <b>ዕድል (Jackpot):</b>\n` +
                   `  └ Mini (1-50): <code>${jackpotMiniWagered.toLocaleString()} ETB</code> (${jackpotMiniBets.length} plays, Wins: <code>${jackpotMiniWon.toLocaleString()} ETB</code>)\n` +
                   `  └ Grand (1-100): <code>${jackpotGrandWagered.toLocaleString()} ETB</code> (${jackpotGrandBets.length} plays, Wins: <code>${jackpotGrandWon.toLocaleString()} ETB</code>)\n` +
                   `🎱 <b>ቢንጎ (Bingo):</b>\n` +
                   `  └ ባለ 10: <code>${bingo10Wagered.toLocaleString()} ETB</code> (${bingo10Bets.length} plays, Wins: <code>${bingo10Won.toLocaleString()} ETB</code>)\n` +
                   `  └ ባለ 20: <code>${bingo20Wagered.toLocaleString()} ETB</code> (${bingo20Bets.length} plays, Wins: <code>${bingo20Won.toLocaleString()} ETB</code>)\n` +
                   `🎱 <b>ኬኖ (Keno):</b>\n` +
                   `  └ Total: <code>${kenoWagered.toLocaleString()} ETB</code> (${kenoBets.length} plays, Wins: <code>${kenoWon.toLocaleString()} ETB</code>)\n` +
                   `📈 <b>Net Player Profit:</b> <code>${playerProfit > 0 ? '+' : ''}${playerProfit.toLocaleString()} ETB</code>\n` +
                   `📉 <b>House GGR (Revenue):</b> <code>${netHouseGGR > 0 ? '+' : ''}${netHouseGGR.toLocaleString()} ETB</code>\n` +
                   `━━━━━━━━━━━━━━━━━━━━━━━━━━`;

      userStates.set(String(chatId), { step: 'idle' });

      const isBlocked = !!user.is_blocked_bot;
      const inline_keyboard: any[][] = [];
      const isAnyAdm = isAnyAdmin(chatId);

      if (isAnyAdm) {
        inline_keyboard.push([
          { text: user.is_admin ? "👤 Demote Admin" : "👑 Promote Admin", callback_data: `lookup_toggle_admin_${targetId}` }
        ]);
        inline_keyboard.push([
          { text: isBlocked ? "✅ Unblock Bot" : "🚫 Block Bot", callback_data: `lookup_toggle_block_${targetId}` }
        ]);
        inline_keyboard.push([
          { text: isAffiliateBanned ? "🟢 Unban Affiliate" : "🔴 Ban Affiliate", callback_data: `lookup_toggle_affiliate_${targetId}` }
        ]);
        inline_keyboard.push([
          { text: "💰 የሂሳብ ማስተካከያ (Adjust Balance)", callback_data: `lookup_adjust_bal_${targetId}` }
        ]);
      }

      inline_keyboard.push([
        { text: "⬅️ Back to User Lookup", callback_data: "control_user_lookup" }
      ]);

      if (messageId) {
        await bot.editMessageText(report, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard }
        }).catch(async () => {
          await bot.sendMessage(chatId, report, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard }
          });
        });
      } else {
        await bot.sendMessage(chatId, report, {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard }
        });
      }
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

    const text = `🤖 <b>AI Support Assistant Settings</b>\n\n` +
                 `Configure how the AI interacts with users and manage the information it knows.\n\n` +
                 `📜 <b>Current System Instructions:</b>\n` +
                 `----------------------------------------\n` +
                 `${currentInstruction}\n` +
                 `----------------------------------------\n\n` +
                 `💡 <b>Tip:</b> Use the Knowledge Base to give the AI specific data about games, rules, and procedures without cluttering these instructions.`;

    const keyboard = {
      inline_keyboard: [
        [{ text: "📝 Edit System Instructions", callback_data: "control_ai_edit" }],
        [{ text: "📚 Manage Knowledge Base (RAG)", callback_data: "control_kb_main" }],
        [{ text: "🔙 Back to Control Panel", callback_data: "control_back" }]
      ]
    };

    if (messageId) {
      bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard })
        .catch(() => bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard }));
    } else {
      bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    }
  }

  async function renderKBPanel(chatId: number, messageId?: number) {
    try {
      const { count } = await supabase.from('knowledge_base').select('*', { count: 'exact', head: true });
      const text = `📚 <b>Knowledge Base (RAG)</b>\n\n` +
                   `Total chunks in database: <b>${count || 0}</b>\n\n` +
                   `The AI automatically searches this database when users ask questions. Use the buttons below to manage it.`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: "➕ Add Knowledge", callback_data: "control_kb_add" }],
          [{ text: "🔍 Test Search", callback_data: "control_kb_search" }],
          [{ text: "🔙 Back", callback_data: "control_ai_instructions" }]
        ]
      };

      if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      } else {
        bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
      }
    } catch (err) {
      bot.sendMessage(chatId, "❌ Error loading knowledge base stats.");
    }
  }

  async function renderAnnouncementCmdPanel(chatId: number, messageId?: number) {
    try {
      const anns = loadAnnouncements();
      const grand = anns.find(a => a.id === "vip_100_slots");
      const mini = anns.find(a => a.id === "vip_50_slots");
      const fast = anns.find(a => a.id === "fast_20_slots");
      const bingo = anns.find(a => a.id === "ann_bingo");
      const mola = anns.find(a => a.id === "ann_mola_godele");
      const edil = anns.find(a => a.id === "ann_edil");
      const fettan = anns.find(a => a.id === "ann_fettan");

      let text = "📢 <b>Slot & Game Announcements Control Panel</b>\n\n" +
                 "Toggle automatic announcements or force-send promotion messages instantly:\n\n";

      if (grand) {
        text += `🔥 <b>ዕድል 100-ሰው (VIP Grand)</b>: ${grand.enabled ? "🟢" : "🔴"}\n`;
      }
      if (mini) {
        text += `💥 <b>ዕድል 50-ሰው (VIP Mini)</b>: ${mini.enabled ? "🟢" : "🔴"}\n`;
      }
      if (fast) {
        text += `⚡ <b>ፈጣን 20-ሰው (Fast 20)</b>: ${fast.enabled ? "🟢" : "🔴"}\n`;
      }
      if (bingo) {
        text += `🎱 <b>Bingo Promo</b>: ${bingo.enabled ? "🟢" : "🔴"}\n`;
      }
      const kenoAnn = anns.find(a => a.id === "ann_keno");
      if (kenoAnn) {
        text += `🎰 <b>Keno Promo</b>: ${kenoAnn.enabled ? "🟢" : "🔴"}\n`;
      }
      if (mola) {
        text += `⚖️ <b>Mola/Godele Promo</b>: ${mola.enabled ? "🟢" : "🔴"}\n`;
      }
      if (edil) {
        text += `🍀 <b>Edil Promo</b>: ${edil.enabled ? "🟢" : "🔴"}\n`;
      }
      if (fettan) {
        text += `🚀 <b>Fettan Promo</b>: ${fettan.enabled ? "🟢" : "🔴"}\n`;
      }

      const buttons = [];
      if (grand) {
        buttons.push([
          { text: "🚀 Send Grand 100", callback_data: `cmd_ann_send:${grand.id}` },
          { text: "🚀 Send Mini 50", callback_data: `cmd_ann_send:${mini?.id || 'vip_50_slots'}` }
        ]);
      }
      if (fast) {
        buttons.push([
          { text: "🚀 Send Fast 20", callback_data: `cmd_ann_send:${fast.id}` },
          { text: "🚀 Send Bingo", callback_data: `cmd_ann_send:${bingo?.id || 'ann_bingo'}` }
        ]);
      }
      if (mola || edil || fettan) {
        const row = [];
        if (mola) row.push({ text: "🚀 Mola", callback_data: `cmd_ann_send:${mola.id}` });
        if (edil) row.push({ text: "🚀 Edil", callback_data: `cmd_ann_send:${edil.id}` });
        if (fettan) row.push({ text: "🚀 Fettan", callback_data: `cmd_ann_send:${fettan.id}` });
        buttons.push(row);
      }
      const currentId = getChannelId() || "<i>Not Set</i>";
      text += `\n🎯 <b>Target Channel:</b> <code>${currentId}</code>\n` +
              `<i>(Ensure the bot is an administrator in this channel)</i>`;

      buttons.push([{ text: "🆔 Set Channel ID", callback_data: "cmd_ann_set_channel" }, { text: "📌 Unpin All Broadcasts", callback_data: "control_unpin_all" }]);
      buttons.push([{ text: "⚙️ Manage Full Announcements Dashboard", callback_data: "control_announcements" }]);
      buttons.push([{ text: "🔙 Back to Control Panel", callback_data: "control_back" }]);

      const keyboard = { inline_keyboard: buttons };

      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard })
          .catch(() => bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard }));
      } else {
        await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
      }
    } catch (err: any) {
      logBot(`Error rendering announcement command panel: ${err.message}`);
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

      rows.push([{ text: "🆔 Set Channel ID", callback_data: "cmd_ann_set_channel" }]);
      
      const txPostsStatus = promptsConfig.tx_channel_posts_enabled !== false ? "🟢 ON" : "🔴 OFF";
      rows.push([{ text: `💳 Tx Channel Posts: ${txPostsStatus}`, callback_data: "ann_toggle_tx_posts" }]);

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
          [
            { text: "🆔 Set Channel ID", callback_data: "cmd_ann_set_channel" },
            { text: "🔙 Back to List", callback_data: "control_announcements" }
          ]
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


  async function renderManageAffiliate(chatId: number, messageId?: number) {
    try {
        const { data: txs } = await supabase.from('transactions').select('amount').in('type', ['affiliate_withdrawal', 'reward']).ilike('description', '%Referral Commission%');
        const totalHousePaidOut = txs ? txs.reduce((sum, t) => sum + Number(t.amount || 0), 0) : 0;
        
        // Fetch current week jackpot stats
        const stats = await fetchLeaderboardData(promptsConfig.weekly_jackpot_amount || 0);
        const startOfWeekISO = stats.startOfWeek;
        
        // Fetch all time referrals (count of referral_link transactions)
        const { count: totalHouseReferrals } = await supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('type', 'referral_link');
        
        // Fetch pending requests
        const { data: pending } = await supabase.from('transactions').select('id, user_id, amount, description').eq('type', 'affiliate_payout_request');
        
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
        
        const isAutoJackpotEnabled = promptsConfig.automated_jackpot_broadcast_enabled !== false;

        let text = `🤝 <b>House Affiliate Report</b>\n\n` +
          `Current Commission Rate: <b>1% of Bet Amount</b>\n\n` +
          `👥 <b>Weekly New Referrals:</b> <b>${stats.totalPlatformVolume}</b>\n` +
          `👥 <b>Total All-Time Referrals:</b> <b>${totalHouseReferrals || 0}</b>\n` +
          `💵 <b>Total Payouts to Influencers:</b> ${totalHousePaidOut.toLocaleString()} ETB\n\n` +
          `🏆 <b>Current Promoter Jackpot Pool:</b> <b>${stats.promoterJackpot.toLocaleString()} ETB</b>\n` +
          `<i>(Manually set by Admin)</i>\n` +
          `🔔 <b>Auto Weekly Broadcast:</b> ${isAutoJackpotEnabled ? "🟢 ENABLED (30m before turn of week)" : "🔴 DISABLED"}\n\n` +
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
        
        inline_keyboard.push([{ text: "📊 Referrers Referee Report (Excel)", callback_data: "affiliate_referrers_report" }]);
        inline_keyboard.push([{ text: "💰 Set Weekly Jackpot Amount", callback_data: "affiliate_set_jackpot" }]);
        inline_keyboard.push([{ text: "📢 Announce Jackpot Pool", callback_data: "affiliate_payout_announce" }]);
        inline_keyboard.push([{ text: "👥 Debug: List Users", callback_data: "debug_list_users" }]);
        inline_keyboard.push([{ text: "🗑️ Debug: List Dummy Users", callback_data: "debug_list_dummy_users" }]);
        inline_keyboard.push([{ text: isAutoJackpotEnabled ? "🔴 Disable Weekly Auto Broadcast" : "🟢 Enable Weekly Auto Broadcast", callback_data: "affiliate_toggle_auto_broadcast" }]);
        inline_keyboard.push([{ text: "🧹 Retract Recent Broadcasts (Clean Spam)", callback_data: "affiliate_retract_broadcasts" }]);
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


  function renderRetractMenu(chatId: number, messageId?: number) {
    const campaigns = loadCampaigns();
    const text = `🧹 <b>Retract Telegram Messages / Broadcasts</b>\n\n` +
      `Select a past broadcast campaign below to retract (delete) it from <b>all users'</b> inboxes. This deletes the message from their private chats.\n\n` +
      `You can also use the special automated spam cleaner to clear the recent duplicate weekly jackpot messages.`;

    const inline_keyboard: any[][] = [];

    // Special quick action to clean the recent jackpot spam of 34 broadcasts
    inline_keyboard.push([{ text: "🧹 Clean Past Jackpot Spam (34 duplicates)", callback_data: "affiliate_retract_flood_jackpot" }]);

    if (campaigns.length > 0) {
      inline_keyboard.push([{ text: "📋 --- Select Broadcast to Retract ---", callback_data: "noop" }]);
      campaigns.slice(0, 12).forEach((camp) => {
        const timeStr = new Date(camp.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) + 
          " " + new Date(camp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const snippet = camp.textSnippet || "Broadcast";
        const label = `🗑️ [${timeStr}] ${snippet.slice(0, 18)}`;
        inline_keyboard.push([{ text: label, callback_data: `bcast_retract_execute_${camp.id}` }]);
      });
    } else {
      inline_keyboard.push([{ text: "<i>No other recent broadcasts found.</i>", callback_data: "noop" }]);
    }

    inline_keyboard.push([
      { text: "🧹 Last 10", callback_data: "affiliate_retract_range:10" },
      { text: "🧹 Last 15", callback_data: "affiliate_retract_range:15" },
      { text: "🧹 Last 30", callback_data: "affiliate_retract_range:30" },
      { text: "🧹 Last 60", callback_data: "affiliate_retract_range:60" }
    ]);

    inline_keyboard.push([{ text: "🔙 Back to Affiliate Management", callback_data: "control_manage_affiliate" }]);

    const keyboard = { inline_keyboard };

    if (messageId) {
      bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard })
        .catch(() => bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard }));
    } else {
      bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    }
  }


  function sendBankSettings(chatId: number, bankId: string, messageId?: number) {
    const bank = promptsConfig.banks[bankId];
    if (!bank) {
       logBot(`[WARNING] Attempted to show settings for non-existent bank: ${bankId}`);
       bot.sendMessage(chatId, `❌ Bank "${bankId}" not found in configuration.`);
       return;
    }

    const text = `🏦 <b>Bank Settings: ${bankId}</b>\n\n` +
      `🏷️ <b>Display Name:</b> <code>${bank.name}</code>\n` +
      `💳 <b>Account/Phone:</b> <code>${bank.account}</code>\n` +
      `👤 <b>Owner Name:</b> <code>${bank.owner_name}</code>\n` +
      `📝 <b>Withdraw Prompt:</b> <code>${bank.withdraw_prompt || "Default"}</code>\n\n` +
      `Select which property you want to edit:`;
    
    const keyboard = {
      inline_keyboard: [
        [{ text: "🏷️ Edit Display Name", callback_data: `edit_bankval_${bankId}_name` }],
        [{ text: "💳 Edit Account/Phone", callback_data: `edit_bankval_${bankId}_account` }],
        [{ text: "👤 Edit Owner Name", callback_data: `edit_bankval_${bankId}_owner_name` }],
        [{ text: "📝 Edit Withdraw Prompt", callback_data: `edit_bankval_${bankId}_withdraw_prompt` }],
        [{ text: "🛑 DELETE THIS BANK", callback_data: `delete_bank_confirm_${bankId}` }],
        [{ text: "🔙 Back to Banks", callback_data: "edit_section_banks" }]
      ]
    };

    logBot(`[ADMIN] Showing bank settings for: ${bankId} to Chat: ${chatId}`);

    if (messageId) {
      bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard }).catch(e => {
        bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
      });
    } else {
      bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    }
  }

  function sendManageBanksMenu(chatId: number, messageId?: number) {
    if (!isAnyAdmin(chatId.toString())) {
      bot.sendMessage(chatId, "❌ Access Denied.");
      return;
    }
    const bk = promptsConfig.banks || {};
    const bankIds = Object.keys(bk);
    const text = `🏦 <b>Bank & Gateway Management</b>\n\n` +
      `Active Gateways: <b>${bankIds.length}</b>\n\n` +
      `<i>Changes made here are reflected immediately in player deposit/withdrawal flows.</i>`;
    
    const inline_keyboard: any[][] = [];

    // Banks in rows of 2 for better layout
    for (let i = 0; i < bankIds.length; i += 2) {
      const row: any[] = [];
      row.push({ text: `✏️ ${bk[bankIds[i]]?.name || bankIds[i]}`, callback_data: `edit_bank_${bankIds[i]}` });
      if (i + 1 < bankIds.length) {
        row.push({ text: `✏️ ${bk[bankIds[i+1]]?.name || bankIds[i+1]}`, callback_data: `edit_bank_${bankIds[i+1]}` });
      }
      inline_keyboard.push(row);
    }

    inline_keyboard.push([{ text: "✨ ADD NEW BANK GATEWAY", callback_data: "add_bank_start" }]);
    inline_keyboard.push([{ text: "🔄 Force Sync from Disk", callback_data: "reload_config_silent" }]);
    inline_keyboard.push([{ text: "🔙 Back to Prompts Menu", callback_data: "control_edit" }]);

    const keyboard = { inline_keyboard };

    if (messageId) {
      bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard }).catch(() => {
        bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
      });
    } else {
      bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    }
  }

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
          { text: "🏦 Manage Banks (Add/Delete)", callback_data: "edit_section_banks" }
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

    const customCampaignRows = buildCampaignReplyMarkup(composer, globalAppUrl);
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


  // --- MESSAGE STEP-BY-STEP HANDLERS ---
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    const userIdNum = parseInt(userId, 10);
    if (!userId) return;

    // Deduplicate processed messages to prevent duplicate responses
    const msgKey = `${chatId}_${msg.message_id}`;
    if (processedMessages.has(msgKey)) {
      logBot(`Duplicate message ignored: ${msgKey}`);
      return;
    }
    processedMessages.add(msgKey);

    // Show immediate activity feedback
    bot.sendChatAction(chatId, 'typing').catch(() => {});

    if (processedMessages.size > 1000) {
      const first = processedMessages.values().next().value;
      if (first !== undefined) processedMessages.delete(first);
    }

    if (blockedUsersCache.has(userId)) {
      const isStartingAdm = isAnyAdmin(userIdNum);
      if (!isStartingAdm) {
        await bot.sendMessage(chatId, "ይቅርታ፣ እርስዎ ይህን አገልግሎት እንዳይጠቀሙ ታግደዋል። ተጨማሪ መረጃ ከፈለጉ እባክዎን በቀጥታ @scofiled1 ያነጋግሩ።\n\nSorry, you have been blocked from using this bot. For more info, please contact @scofiled1 directly.");
        return;
      }
    }

    // Prevent concurrent processing for the same user
    if (processingUsers.has(userId)) return;
    processingUsers.add(userId);

    try {
      const text = msg.text?.trim() || "";
    const supportState = userStates.get(userId);

    // AI Support Logic
    if (supportState?.isSupportAI && text && !text.startsWith("/")) {
      logBot(`AI Support: Processing message from userId=${userId}`);
      const isAdmin = isAnyAdmin(userId);
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
      
      if (cmdName === "checkadmin") {
      const isAdmin = isAnyAdmin(userIdNum);
      const isPrimary = userIdNum === getPrimaryOwnerId();
      let status = `🔍 <b>Admin Status Check</b>\n\n`;
      status += `👤 <b>Your User ID:</b> <code>${userIdNum}</code>\n`;
      status += `👑 <b>Is Admin:</b> ${isAdmin ? "✅ Yes" : "❌ No"}\n`;
      status += `⭐ <b>Is Primary Owner:</b> ${isPrimary ? "✅ Yes" : "❌ No"}\n\n`;
      
      if (isAdmin) {
        status += `📊 <b>Notification Queue:</b> ${adminChatIds.size} admins listed.\n`;
        status += `📝 <b>List:</b> <code>${Array.from(adminChatIds).join(', ')}</code>\n\n`;
        status += `<i>If you are in the list but not receiving messages, ensure you have messaged this bot directly in private!</i>`;
      } else {
        status += `⚠️ <b>Note:</b> If you should be an admin, please ensure your User ID is added to <code>TELEGRAM_ADMIN_IDS</code> in the Settings menu.`;
      }
      
      return bot.sendMessage(chatId, status, { parse_mode: "HTML" }).catch(() => {});
    }

    if (cmdName === "gridstate") {
        if (!isAnyAdmin(userIdNum)) return;
        const { gridRooms } = await import("./gridState.js");
        let status = "🎲 <b>Grid Rooms State:</b>\n\n";
        for (const [name, room] of Object.entries(gridRooms)) {
          const claimedCount = Object.keys(room.claimedSlots || {}).length;
          status += `▫️ <b>${name}</b>: ${claimedCount} slots claimed (Round: ${room.roundId})\n`;
        }
        await bot.sendMessage(chatId, status, { parse_mode: "HTML" });
        return;
      }

      if (cmdName === "envcheck") {
        if (!isAnyAdmin(userIdNum)) return;
        const channelIdEnv = process.env.CHANNEL_ID || process.env.TELEGRAM_CHANNEL_ID;
        const channelIdCfg = promptsConfig.channel_id;
        const finalId = getChannelId();
        
        let status = "🛠️ <b>Environment Check:</b>\n\n";
        
        status += `🔹 <b>Env CHANNEL_ID:</b> <code>${channelIdEnv || "Not Set"}</code>\n`;
        status += `🔹 <b>Config CHANNEL_ID:</b> <code>${channelIdCfg || "Not Set"}</code>\n\n`;
        
        if (finalId) {
          const masked = finalId.length > 6 
            ? `${finalId.substring(0, 4)}...${finalId.substring(finalId.length - 2)}`
            : "***";
          status += `✅ <b>Active ID:</b> <code>${masked}</code> (Length: ${finalId.length})\n\n`;
        } else {
          status += `❌ <b>No Active CHANNEL_ID Found</b>\n\n`;
        }
        
        const allKeys = Object.keys(process.env).filter(k => k.includes("ID") || k.includes("BOT") || k.includes("CHAN")).join(", ");
        status += `<b>Available related keys:</b>\n<code>${allKeys || "None"}</code>\n\n` +
                  `<i>Use /control -> Announcements -> Set Channel ID to configure it manually.</i>`;
        
        await bot.sendMessage(chatId, status, { parse_mode: "HTML" });
        return;
      }

      if (cmdName === "start") {
        const payload = commandParts[1] || "";
        const firstName = msg.from?.first_name || "Player";
        let isRegistered = false;
        try {
          const { data } = await supabase.from('users').select('id').eq('id', userId);
          if (data && data.length > 0) isRegistered = true;
        } catch (e) {}

        if (isRegistered) {
          if (payload === 'deposit') {
            const now = Date.now();
            const lastTime = lastFlowTrigger.get(`${userId}_deposit`) || 0;
            if (now - lastTime > 2000) {
              lastFlowTrigger.set(`${userId}_deposit`, now);
              return startDepositFlow(chatId, userId);
            }
            return;
          } else if (payload === 'withdraw') {
            const now = Date.now();
            const lastTime = lastFlowTrigger.get(`${userId}_withdraw`) || 0;
            if (now - lastTime > 2000) {
              lastFlowTrigger.set(`${userId}_withdraw`, now);
              return startWithdrawalFlow(chatId, userId);
            }
            return;
          } else if (payload === 'play') {
            return bot.sendMessage(chatId, "🎮 *ETB Game Hub is ready!*", { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🚀 Launch Game", web_app: { url: globalAppUrl } }]] } });
          }

          let userBalanceStr = "0 ETB";
          try {
            const { data } = await supabase.from('users').select('balance').eq('id', userId);
            if (data && data.length > 0) userBalanceStr = `${Number(data[0].balance).toLocaleString()} ETB`;
          } catch (e) {}

          const welcomeMsgPattern = promptsConfig.welcome_msg || `👋 *Welcome to ETB Game Hub, {name}!* 🎮\n\n💰 *Your current balance:* \`{balance}\`\n\n👇 Click below to play!`;
          const welcomeMsg = welcomeMsgPattern.replace(/{name}/g, firstName).replace(/{balance}/g, userBalanceStr);
          const welcomeButtonsRows = ((promptsConfig.welcome_buttons && promptsConfig.welcome_buttons.length > 0) 
            ? promptsConfig.welcome_buttons 
            : DEFAULT_PROMPTS_CONFIG.welcome_buttons).map(row => 
            row.map(btn => {
              const btnVal = btn.value === 'appUrl' ? globalAppUrl : btn.value;
              if (btn.type === 'webapp') return { text: btn.text, web_app: { url: btnVal } };
              if (btn.type === 'url') return { text: btn.text, url: btnVal };
              return { text: btn.text, callback_data: btnVal };
            })
          );

          if (promptsConfig.welcome_image) {
            await bot.sendPhoto(chatId, promptsConfig.welcome_image, { caption: welcomeMsg, parse_mode: "Markdown", reply_markup: { inline_keyboard: welcomeButtonsRows } })
              .catch(() => bot.sendMessage(chatId, welcomeMsg, { parse_mode: "Markdown", reply_markup: { inline_keyboard: welcomeButtonsRows } }));
          } else {
            await bot.sendMessage(chatId, welcomeMsg, { parse_mode: "Markdown", reply_markup: { inline_keyboard: welcomeButtonsRows } });
          }
        } else {
          pendingRegistrations.set(userId, { payload });
          const desc = promptsConfig.welcome_guest_msg || DEFAULT_PROMPTS_CONFIG.welcome_guest_msg;
          const markup = { inline_keyboard: [[{ text: "🎮 Start Play / ለመጫወት ጀምር 🚀", callback_data: "register_start" }]] };
          if (promptsConfig.welcome_guest_image) {
            await bot.sendPhoto(chatId, promptsConfig.welcome_guest_image, { caption: desc, parse_mode: "HTML", reply_markup: markup })
              .catch(() => bot.sendMessage(chatId, desc, { parse_mode: "HTML", reply_markup: markup }));
          } else {
            await bot.sendMessage(chatId, desc, { parse_mode: "HTML", reply_markup: markup });
          }
        }
        return;
      }
      if (cmdName === "play") {
        await checkRegisteredAndHandle(msg, () => bot.sendMessage(chatId, "🎮 *ETB Game Hub is ready!*", { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🚀 Launch Game", web_app: { url: globalAppUrl } }]] } }));
        return;
      }
      if (cmdName === "deposit") {
        const now = Date.now();
        const lastTime = lastFlowTrigger.get(`${userId}_deposit`) || 0;
        if (now - lastTime < 2000) return;
        lastFlowTrigger.set(`${userId}_deposit`, now);
        await checkRegisteredAndHandle(msg, () => startDepositFlow(chatId, userId));
        return;
      }
      if (cmdName === "withdraw") {
        const now = Date.now();
        const lastTime = lastFlowTrigger.get(`${userId}_withdraw`) || 0;
        if (now - lastTime < 2000) return;
        lastFlowTrigger.set(`${userId}_withdraw`, now);
        await checkRegisteredAndHandle(msg, () => startWithdrawalFlow(chatId, userId));
        return;
      }
      if (cmdName === "referral") {
        await checkRegisteredAndHandle(msg, async () => {
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
          await bot.sendMessage(chatId, referralMsg, {
            parse_mode: "HTML",
            reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined
          });
        });
        return;
      }
      if (cmdName === "support") {
        userStates.set(userId, { step: 'support_ai', isSupportAI: true, aiHistory: undefined });
        await bot.sendMessage(chatId, "👋 <b>Welcome to AI Support!</b>\n\nI am your AI assistant. How can I help you today? You can ask about your balance, games, or any issues you're facing.\n\n<i>Type your message below to start chatting. To exit support, type /cancel.</i>", { parse_mode: "HTML" });
        return;
      }
      if (cmdName === "language") {
        await bot.sendMessage(chatId, "🌐 <b>Select your language / ቋንቋ ይምረጡ:</b>", {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🇬🇧 English", callback_data: "lang_en" }],
              [{ text: "🇪🇹 Amharic", callback_data: "lang_am" }]
            ]
          }
        });
        return;
      }
      if (cmdName === "cancel") {
        userStates.set(userId, { step: 'idle' });
        if (isAnyAdmin(userIdNum)) {
          setAdminStates.delete(userIdNum);
          broadcastStates.delete(userIdNum);
        }
        await bot.sendMessage(chatId, "❌ <b>Operation cancelled.</b>", { parse_mode: "HTML" });
        return;
      }
      if (cmdName === "announcement" || cmdName === "list_of_recent_announcement") {
        if (!isAnyAdmin(userIdNum)) return bot.sendMessage(chatId, "❌ Access Denied.");
        await renderAnnouncementCmdPanel(chatId);
        return;
      }
      if (cmdName === "announcement_delete") {
        if (!isAnyAdmin(userIdNum)) return bot.sendMessage(chatId, "❌ Access Denied.");
        const id = commandParts[1];
        if (!id) return bot.sendMessage(chatId, "Please specify an ID. Usage: /announcement_delete <id>");
        let anns = loadAnnouncements();
        const initialLen = anns.length;
        anns = anns.filter(a => a.id !== id);
        if (anns.length < initialLen) {
          saveAnnouncements(anns);
          await bot.sendMessage(chatId, `✅ Announcement ${id} deleted.`);
        } else {
          await bot.sendMessage(chatId, `❌ Announcement ${id} not found.`);
        }
        return;
      }
      if (cmdName === "broadcast") {
        if (!isAnyAdmin(userIdNum)) return bot.sendMessage(chatId, `❌ <b>Access Denied.</b>`, { parse_mode: "HTML" });
        const composer: BroadcastComposer = { step: 'choose_target', target: 'all', template: 'none' };
        broadcastStates.set(userIdNum, composer);
        await renderBroadcastDashboard(bot, chatId, userIdNum, composer);
        return;
      }
      if (cmdName === "debug_list_users") {
        if (!isAnyAdmin(userIdNum)) return bot.sendMessage(chatId, `❌ <b>Access Denied.</b>`, { parse_mode: "HTML" });
        const { data: users, error } = await supabase.from('users').select('id, username, first_name').limit(50);
        if (error) {
          logBot(`Error fetching users: ${error.message}`);
          return bot.sendMessage(chatId, "❌ Error fetching users.");
        }
        let userList = `👥 <b>First 50 Users (Debug):</b>\n\n`;
        users?.forEach(u => {
          userList += `• ID: <code>${u.id}</code> | User: ${u.username || 'N/A'} | Name: ${u.first_name || 'N/A'}\n`;
        });
        await bot.sendMessage(chatId, userList, { parse_mode: "HTML" });
        return;
      }
      if (cmdName === "analysis") {
        if (!isAnyAdmin(userIdNum)) return bot.sendMessage(chatId, `❌ <b>Access Denied.</b>`, { parse_mode: "HTML" });
        await bot.sendMessage(chatId, "📊 <b>Select Timeframe:</b>", {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📅 Day", callback_data: "analysis_day" }, { text: "🗓️ Week", callback_data: "analysis_week" }],
              [{ text: "📆 Month", callback_data: "analysis_month" }, { text: "📅 Year", callback_data: "analysis_year" }]
            ]
          }
        });
        return;
      }
      if (cmdName === "manage_affiliate" || (cmdName === "manage" && (commandParts[1] === "affiliate" || commandParts[1] === "affiliates"))) {
        if (!isAnyAdmin(userIdNum)) return bot.sendMessage(chatId, "❌ Access Denied.");
        await renderManageAffiliate(chatId);
        return;
      }
      if (cmdName === "edit") {
        if (!isAnyAdmin(userIdNum)) return bot.sendMessage(chatId, "❌ Access Denied.");
        await sendEditPanelMenu(chatId);
        return;
      }
      if (cmdName === "setadmin" || cmdName === "control" || cmdName === "reload_config") {
        const isActuallyStartingAdmin = isStartingAdmin(userIdNum);
        const isAdmin = isAnyAdmin(userIdNum);
        
        if (cmdName === "control") {
           if (isActuallyStartingAdmin) {
             renderMainControlPanel(chatId);
           } else {
             // Security Alert for non-admins trying to access control
             const username = msg.from?.username || msg.from?.first_name || "Unknown User";
             const startingAdminId = getPrimaryOwnerId();
             const alertMsg = `🚨 <b>Security Alert!</b>\n\nNon-admin user <b>${username}</b> with UserId: <code>${userId}</code> tried to access <code>/control</code> command.\n\nThis attempt has been blocked.`;
             await bot.sendMessage(startingAdminId, alertMsg, { parse_mode: "HTML" });
             await bot.sendMessage(chatId, `❌ <b>Access Denied.</b>\n\nThis command is restricted to the starting administrator of this bot.`, { parse_mode: "HTML" });
           }
        } else if (cmdName === "reload_config") {
           if (isAnyAdmin(userId)) {
             promptsConfig = loadPromptsConfig();
             await bot.sendMessage(chatId, "✅ <b>Configuration Reloaded!</b>\n\nAll prompts and bank settings have been refreshed from disk.", { parse_mode: "HTML" });
           } else {
             await bot.sendMessage(chatId, `❌ <b>Access Denied.</b>`, { parse_mode: "HTML" });
           }
        } else if (cmdName === "setadmin") {
           if (isActuallyStartingAdmin) {
             await renderSetAdminMenu(bot, chatId);
           } else {
             await bot.sendMessage(chatId, "❌ <b>Access Denied.</b>\n\nOnly the primary owner can manage administrators.", { parse_mode: "HTML" });
           }
        }
        return;
      }

      if (cmdName === "affiliate") {
        await checkRegisteredAndHandle(msg, async () => {
          try {
            // 1. Get unique user IDs from referral transactions
            const { data: refTx } = await supabase.from('transactions')
              .select('user_id')
              .eq('type', 'referral_link')
              .ilike('description', `Referred by ${userId}%`);
            
            const referredUserIds = new Set<string>();
            if (refTx) {
              refTx.forEach(tx => {
                if (tx.user_id) referredUserIds.add(tx.user_id);
              });
            }

            // 2. Also check the users table directly (for newer referrals)
            const { data: directUsers } = await supabase
              .from('users')
              .select('id')
              .eq('referrer_id', userId);

            if (directUsers) {
              directUsers.forEach(u => referredUserIds.add(u.id));
            }

            const totalReferrals = referredUserIds.size;

            const { data: earnTx } = await supabase.from('transactions')
              .select('amount, type, description')
              .eq('user_id', userId)
              .in('type', ['affiliate_commission', 'affiliate_withdrawal', 'reward', 'affiliate_payout_request']);
            
            let totalEarned = 0;
            let availableBalance = 0;
            if (earnTx) {
                earnTx.forEach(tx => {
                    const amt = Number(tx.amount || 0);
                    if (tx.type === 'affiliate_commission') {
                        totalEarned += amt;
                        availableBalance += amt;
                    } else if (tx.type === 'reward') {
                        // Only count if it's explicitly a referral/promoter reward
                        if (tx.description?.toLowerCase().includes('referral') || tx.description?.toLowerCase().includes('promoter')) {
                            totalEarned += amt;
                            availableBalance += amt;
                        }
                    } else {
                        // affiliate_withdrawal and affiliate_payout_request are negative
                        availableBalance += amt;
                    }
                });
            }

            availableBalance = Math.max(0, availableBalance);

            const msgText = `💰 <b>Your Affiliate Dashboard</b>\n\n👥 <b>Total Referrals:</b> ${totalReferrals}\n💵 <b>Total Commission Earned:</b> ${totalEarned.toLocaleString()} ETB\n💰 <b>Available to Withdraw:</b> ${availableBalance.toLocaleString()} ETB\n\n<i>To request a payout or view detailed logs, open the Mini App!\n\nShare your referral link using /referral to earn 1% on all your friends' bets!</i>`;
            await bot.sendMessage(chatId, msgText, { parse_mode: "HTML" });
          } catch (e: any) {
            logBot(`Error in affiliate stats: ${e.message}`);
            await bot.sendMessage(chatId, `❌ <b>Error loading affiliate stats:</b> ${e.message}`, { parse_mode: "HTML" });
          }
        });
        return;
      }
      if (cmdName === "balance") {
        await checkRegisteredAndHandle(msg, async () => {
          try {
            const { data, error } = await supabase.from('users').select('balance').eq('id', userId).single();
            if (error) {
              await bot.sendMessage(chatId, "⚠️ *Error retrieving balance.*", { parse_mode: "Markdown" });
              return;
            }
            const balanceVal = data ? Number(data.balance) : 0;
            const msgText = `💵 *Your Current Balance / የሂሳብዎ መጠን:*\n\n💰 *${balanceVal.toLocaleString()} ETB*\n\n🎮 _Play inside the web app and keep winning!_`;
            await bot.sendMessage(chatId, msgText, { parse_mode: "Markdown" });
          } catch (err: any) {
            logBot(`Error in /balance handler: ${err.message}`);
            await bot.sendMessage(chatId, "⚠️ *Error retrieving balance.*", { parse_mode: "Markdown" });
          }
        });
        return;
      }
      if (cmdName === "promoter_leaderboard") {
        await checkRegisteredAndHandle(msg, async () => {
          try {
            const stats = await fetchLeaderboardData(promptsConfig.weekly_jackpot_amount || 0);
            const dateStr = new Date(stats.startOfWeek).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
            
            const jackpotDisplay = stats.isJackpotAnnounced 
              ? `<b>${stats.announcedJackpotAmount.toLocaleString()} ETB</b>`
              : `<i>🤫 Suspense (To be announced)</i>`;

            let text = `🏆 <b>Weekly Promoter Leaderboard</b>\n\n📅 <b>Week of:</b> <code>${dateStr}</code> (Sunday UTC)\n💰 <b>Weekly Promoter Jackpot:</b> ${jackpotDisplay}\n\n👥 <b>Top 10 Active Promoters:</b>\n`;
            if (stats.leaderboard && stats.leaderboard.length > 0) {
                stats.leaderboard.forEach((entry, idx) => {
                    const name = entry.first_name || entry.username || `User ${entry.referrer_id.slice(0, 6)}`;
                    const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "•";
                    text += `${medal} <b>${name}</b> | New Referrals: <b>${entry.referral_count || entry.volume}</b>\n`;
                });
            } else {
                text += `<i>No new referrals found for this week yet.</i>\n`;
            }
            text += `\n📢 <i>Share your referral link using /referral to invite friends!</i>`;
            await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
          } catch (e: any) {
            logBot(`Error displaying promoter leaderboard: ${e.message}`);
            await bot.sendMessage(chatId, `❌ Error loading leaderboard: ${e.message}`);
          }
        });
        return;
      }
      if (customCmd) {
        try {
          const buttons = (customCmd.buttons || []).map(row => 
            row.map(btn => {
              const btnVal = btn.value === 'appUrl' ? globalAppUrl : btn.value;
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

    if (editState && (editState.step === 'awaiting_bal_add' || editState.step === 'awaiting_bal_sub')) {
      if (!isAnyAdmin(userId)) {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Only admins are authorized.");
        return;
      }

      if (text === "/cancel") {
        const targetId = editState.targetUserId;
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Setup cancelled.");
        if (targetId) {
          await processUserLookup(chatId, targetId);
        }
        return;
      }

      const val = parseFloat(text?.trim() || "");
      if (isNaN(val) || val <= 0) {
        await bot.sendMessage(chatId, "⚠️ እባክዎ ትክክለኛ ቁጥር ያስገቡ። (Please send a valid positive number)");
        return;
      }

      userStates.set(userId, { step: 'idle' });
      const targetUserId = editState.targetUserId;
      if (targetUserId) {
        const isAdd = editState.step === 'awaiting_bal_add';
        const amountChange = isAdd ? val : -val;

        const actionText = isAdd ? "ጭማሪ (Increase)" : "ቅናሽ (Deduction)";
        const txType = isAdd ? "deposit_adjustment" : "withdrawal_adjustment";
        const desc = `Manual balance adjustment (${actionText}) by Starting Admin (${userId})`;

        const result = await txManager.modifyBalance(targetUserId, amountChange, txType, desc);
        if (result.success) {
          const formattedChange = (isAdd ? "+" : "-") + val.toLocaleString() + " ETB";
          const successMsg = `✅ <b>የሂሳብ ማስተካከያ በተሳካ ሁኔታ ተጠናቋል!</b>\n\n` +
                             `👤 <b>ተጠቃሚ (User ID):</b> <code>${targetUserId}</code>\n` +
                             `📈 <b>ማስተካከያ:</b> <code>${formattedChange}</code>\n` +
                             `💳 <b>አዲስ ሂሳብ (New Balance):</b> <code>${result.newBalance.toLocaleString()} ETB</code>`;
          await bot.sendMessage(chatId, successMsg, { parse_mode: "HTML" });

        } else {
          await bot.sendMessage(chatId, `❌ ማስተካከያውን ማድረግ አልተቻለም: ${result.error || "Database error"}`, { parse_mode: "HTML" });
        }
        await processUserLookup(chatId, targetUserId);
      } else {
        await bot.sendMessage(chatId, "❌ Error: Target user not set in state.");
      }
      return;
    }

    if (editState && editState.step === 'awaiting_game_min_bet') {
      if (!isAnyAdmin(userId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }

      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Setup cancelled.");
        renderSingleGameSettings(chatId, editState.gameId);
        return;
      }

      const val = parseInt(text?.trim() || "");
      if (isNaN(val) || val < 0) {
        await bot.sendMessage(chatId, "⚠️ እባክዎ ትክክለኛ ቁጥር ያስገቡ። (Please send a valid positive number)");
        return;
      }

      userStates.set(userId, { step: 'idle' });
      const settings = getGameSettingsSync();
      const gameId = editState.gameId;
      if (settings[gameId]) {
        settings[gameId].minBet = val;
        await saveGameSettings(settings);
        await bot.sendMessage(chatId, `✅ <b>የ${settings[gameId].nameAm} አነስተኛ ገደብ ተቀይሯል!</b>\n\nአዲሱ ዋጋ: <code>${val.toLocaleString()} ETB</code>`, { parse_mode: "HTML" });
      }
      renderSingleGameSettings(chatId, gameId);
      return;
    }

    if (editState && editState.step === 'awaiting_game_max_bet') {
      if (!isAnyAdmin(userId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }

      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Setup cancelled.");
        renderSingleGameSettings(chatId, editState.gameId);
        return;
      }

      const val = parseInt(text?.trim() || "");
      if (isNaN(val) || val < 0) {
        await bot.sendMessage(chatId, "⚠️ እባክዎ ትክክለኛ ቁጥር ያስገቡ። (Please send a valid positive number)");
        return;
      }

      userStates.set(userId, { step: 'idle' });
      const settings = getGameSettingsSync();
      const gameId = editState.gameId;
      if (settings[gameId]) {
        settings[gameId].maxBet = val;
        await saveGameSettings(settings);
        await bot.sendMessage(chatId, `✅ <b>የ${settings[gameId].nameAm} ከፍተኛ ገደብ ተቀይሯል!</b>\n\nአዲሱ ዋጋ: <code>${val.toLocaleString()} ETB</code>`, { parse_mode: "HTML" });
      }
      renderSingleGameSettings(chatId, gameId);
      return;
    }

    if (editState && editState.step === 'awaiting_game_multiplier') {
      if (!isAnyAdmin(userId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }

      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Setup cancelled.");
        renderSingleGameSettings(chatId, editState.gameId);
        return;
      }

      const val = parseFloat(text?.trim() || "");
      if (isNaN(val) || val <= 0) {
        await bot.sendMessage(chatId, "⚠️ እባክዎ ትክክለኛ ቁጥር ያስገቡ። (Please send a valid positive multiplier/ratio)");
        return;
      }

      userStates.set(userId, { step: 'idle' });
      const settings = getGameSettingsSync();
      const gameId = editState.gameId;
      if (settings[gameId]) {
        settings[gameId].multiplier = val;
        await saveGameSettings(settings);
        const label = gameId.startsWith("bingo_") ? "የአሸናፊነት ክፍያ ስርጭት" : "የአሸናፊነት ማባዣ";
        await bot.sendMessage(chatId, `✅ <b>የ${settings[gameId].nameAm} ${label} ተቀይሯል!</b>\n\nአዲሱ ማባዣ: <code>${val}x</code>`, { parse_mode: "HTML" });
      }
      renderSingleGameSettings(chatId, gameId);
      return;
    }

    if (editState && editState.step === 'awaiting_new_app_url_config') {
      if (!isAnyAdmin(userId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }

      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Setup cancelled.");
        await renderMainControlPanel(chatId);
        return;
      }

      const newAppUrl = text?.trim().replace(/\/$/, "");
      if (!newAppUrl || !newAppUrl.startsWith("http")) {
        await bot.sendMessage(chatId, "⚠️ Invalid URL. It must start with http:// or https://", { parse_mode: "HTML" });
        return;
      }

      userStates.set(userId, { step: 'idle' });
      globalAppUrl = newAppUrl;
      
      // Update the bot menu button immediately
      try {
        await (bot as any).setChatMenuButton({
          menu_button: {
            type: "web_app",
            text: "Play Game 🎮",
            web_app: { url: globalAppUrl }
          }
        });
        logBot("Telegram Bot menu button updated with new APP_URL.");
      } catch (btnErr: any) {
        logBot(`Couldn't update Telegram WebApp menu button: ${btnErr.message || btnErr}`);
      }

      // Sync to Supabase
      saveAppUrlToSupabase(globalAppUrl).catch(err => logBot(`[ERROR] Supabase app_url sync failed: ${err}`));

      await bot.sendMessage(chatId, `✅ <b>App URL Updated!</b>\n\nNew URL: <code>${globalAppUrl}</code>\n\n<i>The main bot menu button and game links will now use this URL.</i>`, { parse_mode: "HTML" });
      await renderMainControlPanel(chatId);
      return;
    }

    // Process User Lookup
    if (editState && editState.step === 'waiting_for_lookup_id') {
      if (!numUserId || !isAnyAdmin(userId)) {
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

    if (editState && editState.step === 'awaiting_channel_id') {
      if (!isAnyAdmin(userId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }

      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Setup cancelled.");
        await renderMainControlPanel(chatId);
        return;
      }

      const newChannelId = text?.trim();
      if (!newChannelId || (!newChannelId.startsWith("-100") && isNaN(Number(newChannelId)))) {
        await bot.sendMessage(chatId, "⚠️ Invalid Channel ID. It should typically start with <code>-100</code> (e.g., <code>-1001234567890</code>).", { parse_mode: "HTML" });
        return;
      }

      userStates.set(userId, { step: 'idle' });
      
      // Save to dedicated file (Local Cache)
      try {
        fs.writeFileSync(CHANNEL_ID_FILE_PATH, newChannelId, "utf8");
      } catch (e) {
        logBot(`[ERROR] Failed to save channel ID file: ${e}`);
      }

      // Sync to Supabase
      saveChannelIdToSupabase(newChannelId).catch(err => logBot(`[ERROR] Supabase channel sync failed: ${err}`));

      // Also update promptsConfig for double persistence
      const currentConfig = loadPromptsConfig();
      currentConfig.channel_id = newChannelId;
      savePromptsConfig(currentConfig);
      promptsConfig = currentConfig;

      await bot.sendMessage(chatId, `✅ <b>Target Channel ID Saved!</b>\n\nNew ID: <code>${newChannelId}</code>\n\n<i>This setting is now permanent and will persist through updates.</i>`, { parse_mode: "HTML" });
      await renderMainControlPanel(chatId);
      return;
    }

    // Process AI Instructions Editing
    if (editState && editState.step === 'editing_ai_instructions') {
      if (!numUserId || !isAnyAdmin(userId)) {
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

    if (editState && editState.step === 'editing_kb_chunk') {
      if (!isAnyAdmin(userId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }
      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Cancelled.");
        await renderKBPanel(chatId);
        return;
      }
      
      await bot.sendMessage(chatId, "⏳ Processing and embedding...");
      const res = await addKnowledgeChunk(text || "", { added_by: userId, timestamp: new Date().toISOString() });
      
      if (res.success) {
        await bot.sendMessage(chatId, "✅ Information added to Knowledge Base!");
      } else {
        await bot.sendMessage(chatId, `❌ Failed to add: ${res.error}`);
      }
      userStates.set(userId, { step: 'idle' });
      await renderKBPanel(chatId);
      return;
    }

    if (editState && editState.step === 'searching_kb') {
      if (!isAnyAdmin(userId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }
      if (text === "/cancel") {
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, "❌ Cancelled.");
        await renderKBPanel(chatId);
        return;
      }
      
      await bot.sendMessage(chatId, "🔍 <b>Searching Knowledge Base...</b>", { parse_mode: "HTML" });
      const results = await searchKnowledgeBase(text || "");
      await bot.sendMessage(chatId, `📖 <b>Top Matches for "${text}":</b>\n\n${results}`, { parse_mode: "HTML" });
      userStates.set(userId, { step: 'idle' });
      await renderKBPanel(chatId);
      return;
    }

    // --- ANNOUNCEMENT EDIT/CREATE STATE FLOWS ---

    // 1. Edit custom interval
    if (editState && editState.step === 'waiting_for_ann_interval' && editState.editingKey) {
      if (!numUserId || !isAnyAdmin(userId)) {
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
      if (!numUserId || !isAnyAdmin(userId)) {
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
      if (!numUserId || !isAnyAdmin(userId)) {
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
        // Just save the fileId directly. Telegram keeps files for a long time,
        // and this is much more reliable than local disk storage which gets wiped on restart.
        photoUrl = msg.photo[msg.photo.length - 1].file_id;
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
      if (!numUserId || !isAnyAdmin(userId)) {
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
      if (!numUserId || !isAnyAdmin(userId)) {
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
      if (!numUserId || !isAnyAdmin(userId)) {
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
        photoUrl = msg.photo[msg.photo.length - 1].file_id;
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
      if (!numUserId || !isAnyAdmin(userId)) {
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

    if (editState && editState.step === 'awaiting_new_bank_id') {
      if (!numUserId || !isAnyAdmin(userId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }
      const bankId = text.trim();
      if (bankId.includes(" ") || bankId.length === 0) {
        return bot.sendMessage(chatId, "❌ <b>Bank ID must be a single word without spaces.</b> Please try again:", { parse_mode: "HTML" });
      }
      if (promptsConfig.banks[bankId]) {
        return bot.sendMessage(chatId, `❌ <b>Bank ID "${bankId}" already exists.</b> Please choose a unique one:`, { parse_mode: "HTML" });
      }

      // Initialize new bank
      promptsConfig.banks[bankId] = {
        name: `🏦 ${bankId}`,
        account: "0000000000",
        owner_name: "Required",
        withdraw_prompt: ""
      };
      savePromptsConfig(promptsConfig);
      userStates.set(userId, { step: 'idle' });

      await bot.sendMessage(chatId, `✅ <b>New bank "${bankId}" added successfully!</b>\n\nYou can now edit its details.`, { parse_mode: "HTML" });
      
      // Show the bank's edit menu
      sendBankSettings(chatId, bankId);
      return;
    }

    if (editState && editState.step === 'edit_prompt_value' && editState.editingKey) {
      if (!numUserId || !isAnyAdmin(userId)) {
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
          sendBankSettings(chatId, bankId);
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
              [{ text: "💳 Payment Instructions", callback_data: "edit_key_deposit_payment_instructions_msg" }],
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
    if (numUserId && isAnyAdmin(userId)) {
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
    if (numUserId && isAnyAdmin(userId)) {
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
    if (isAnyAdmin(userId)) {
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

    // 0. ADMIN: SET JACKPOT AMOUNT
    if (state.step === 'waiting_for_jackpot_amount') {
      if (!numUserId || !isAnyAdmin(userId)) return;
      const cleanText = text.replace(/,/g, '');
      const amount = Math.floor(Math.abs(parseFloat(cleanText)));
      if (isNaN(amount) || amount < 0) {
        return bot.sendMessage(chatId, "❌ <b>Invalid Amount!</b>\nPlease enter a valid number, or /cancel.", { parse_mode: "HTML" });
      }

      promptsConfig.weekly_jackpot_amount = amount;
      savePromptsConfig(promptsConfig);
      
      userStates.set(userId, { step: 'idle' });
      bot.sendMessage(chatId, `✅ <b>Weekly Jackpot Amount Set!</b>\n\n` + 
        `The current pool is now officially <b>${amount.toLocaleString()} ETB</b>.\n` + 
        `You can now return to the Affiliate panel and Announce it.`, { parse_mode: "HTML" });
      return;
    }

    // 1. DEPOSIT: AMOUNT ENTRY
    if (state.step === 'deposit_amount') {
      await bot.sendChatAction(chatId, 'typing').catch(() => {});
      const cleanText = text.replace(/,/g, '');
      const amount = Math.floor(Math.abs(parseFloat(cleanText)));
      if (isNaN(amount) || amount < 10) {
        return bot.sendMessage(chatId, "❌ *ማስገባት የሚፈልጉትን መጠን ከ10 ብር ጀምሮ ያስገቡ።*\n\n_እባክዎን ከ 10 በላይ ቁጥር ብቻ ያስገቡ:_ ", { parse_mode: "Markdown" });
      }

      userStates.set(userId, {
        step: 'deposit_bank',
        amount
      });

      const bk = promptsConfig.banks;
      // Dynamically build bank selection keyboard
      const inline_keyboard: any[][] = [];
      const bankIds = Object.keys(bk);
      
      if (bankIds.length === 0) {
        logBot(`[WARNING] No banks configured for deposit! User: ${userId}`);
        return bot.sendMessage(chatId, "⚠️ <b>Currently no payment methods are available.</b>\n\nPlease contact support for manual deposit options.", { parse_mode: "HTML" });
      }

      for (let i = 0; i < bankIds.length; i += 2) {
        const row: any[] = [];
        row.push({ text: bk[bankIds[i]].name || bankIds[i], callback_data: `dep_bank_${bankIds[i]}` });
        if (i + 1 < bankIds.length) {
          row.push({ text: bk[bankIds[i + 1]].name || bankIds[i + 1], callback_data: `dep_bank_${bankIds[i + 1]}` });
        }
        inline_keyboard.push(row);
      }

      return bot.sendMessage(chatId, "እባክዎት ማስገባት የሚፈልጉበትን ባንክ ይምረጡ።", {
        reply_markup: {
          inline_keyboard
        }
      });
    }

    // 2. DEPOSIT: SMS RECEIPT COPY PASTE
    if (state.step === 'deposit_msg') {
      await bot.sendChatAction(chatId, 'typing').catch(() => {});
      const amount = state.amount || 10;
      const bank = state.bank || "Telebirr";
      const username = msg.from?.username || "no_username";
      const fullName = `${msg.from?.first_name || ""} ${msg.from?.last_name || ""}`.trim() || "Player";

      let progressMsg: any = null;
      try {
        progressMsg = await bot.sendMessage(chatId, "🔍 *የደረሰኝ ማረጋገጫ በራስ-ሰር በመካሄድ ላይ ነው። እባክዎ ጥቂት ሰኮንዶች ይጠብቁ...*\n\n_(Verifying your receipt automatically, please wait...)_", { parse_mode: "Markdown" });
      } catch (e) {}

      // Try Automatic Parsing & Verification
      const { parseReceiptSMS } = await import("./transactionManager.js");
      const { extractSenderName } = await import("./smsParser.js");

      const { txId, amount: parsedAmount } = parseReceiptSMS(text);
      const targetAmount = parsedAmount || Number(amount);
      logBot(`🔍 [Bot-Deposit] Parsed Receipt - Ref: ${txId}, Parsed Amount: ${parsedAmount}, Target Amount: ${targetAmount}`);

      const bankId = Object.keys(promptsConfig.banks || {}).find(k => k.toLowerCase() === bank.toLowerCase()) || bank;
      const bankConfig = promptsConfig.banks?.[bankId];

      let isReceiverVerified = false;
      if (bankConfig) {
        const ownerName = (bankConfig.owner_name || "").toLowerCase().trim();
        const accountNum = (bankConfig.account || "").toLowerCase().trim();
        const cleanReceiptText = text.toLowerCase();

        if (ownerName && cleanReceiptText.includes(ownerName)) {
          isReceiverVerified = true;
        } else if (accountNum && cleanReceiptText.includes(accountNum)) {
          isReceiverVerified = true;
        } else {
          // Check if last 4 digits of the account number are in the text
          const last4 = accountNum.length >= 4 ? accountNum.slice(-4) : "";
          if (last4 && cleanReceiptText.includes(last4)) {
            isReceiverVerified = true;
          }
        }
      } else {
        isReceiverVerified = true;
      }

      logBot(`🔍 [Bot-Deposit] Receiver/Merchant Name Match: ${isReceiverVerified}`);

      let isVerifiedBySMS = false;
      let nameVerificationMsg = "";
      let autoVerifyFailedReason = "";
      let smsRecordFound: any = null;

      if (!txId) {
        autoVerifyFailedReason = "Reference ID not found. Could not parse or locate a valid transaction reference ID from the receipt SMS.";
      } else if (!targetAmount || isNaN(targetAmount)) {
        autoVerifyFailedReason = `Amount not found. Could not parse the deposit amount from the receipt SMS (Target Amount: ${targetAmount}).`;
      } else {
        const cleanUserTxId = txId.trim().toUpperCase();

        // 1. Check if the reference ID has already been used in transactions list
        const { data: duplicateTxsCheck } = await supabase
          .from('transactions')
          .select('id')
          .ilike('description', `%${cleanUserTxId}%`)
          .limit(1);

        if (duplicateTxsCheck && duplicateTxsCheck.length > 0) {
          autoVerifyFailedReason = `Duplicate Reference ID. The transaction ID "${cleanUserTxId}" has already been processed and claimed.`;
        } else {
          // 2. Check if this reference ID is in deposit_pool but marked as 'used'
          const { data: usedPoolCheck } = await supabase
            .from('deposit_pool')
            .select('*')
            .ilike('transaction_id', cleanUserTxId)
            .eq('status', 'used')
            .maybeSingle();

          if (usedPoolCheck) {
            autoVerifyFailedReason = `Reference ID is already used. The gateway has already processed the SMS for transaction ID "${cleanUserTxId}".`;
          } else {
            // 3. Retry logic: Wait for the SMS gateway to receive and record the SMS for up to 45 seconds (15 attempts x 3s)
            for (let attempt = 0; attempt < 15; attempt++) {
              logBot(`🔍 [Bot-Deposit] Checking gateway for Ref: ${cleanUserTxId} (Attempt ${attempt + 1}/15)...`);
              
              const { data: smsRecord } = await supabase
                .from('deposit_pool')
                .select('*')
                .ilike('transaction_id', cleanUserTxId)
                .eq('status', 'unused')
                .maybeSingle();

              if (smsRecord) {
                smsRecordFound = smsRecord;
                const smsAmount = Number(smsRecord.amount);
                logBot(`📊 [Bot-Deposit] SMS found for ${cleanUserTxId}. SMS Amount: ${smsAmount}, Target Amount: ${targetAmount}`);
                
                // Trust the gateway bank SMS amount as the absolute source of truth
                isVerifiedBySMS = true;
                const realSenderName = smsRecord.sender_name || extractSenderName(smsRecord.raw_message);
                nameVerificationMsg = realSenderName ? `Payer Name: ${realSenderName}` : "Payer Name: Not Provided";
                
                // Update status in deposit_pool to avoid duplicate use
                await supabase.from('deposit_pool').update({ status: 'used' }).eq('transaction_id', smsRecord.transaction_id);
                logBot(`✅ [Bot-Deposit] Verified by gateway (reference matched) on attempt ${attempt + 1}. Payer: ${realSenderName}`);
                break;
              }

              if (attempt < 14) {
                await new Promise(resolve => setTimeout(resolve, 3000));
              }
            }

            if (!smsRecordFound) {
              // Gateway didn't receive it (yet) - perform text mismatch validation for manual submission
              if (!isReceiverVerified) {
                const ownerName = bankConfig ? (bankConfig.owner_name || "") : "N/A";
                const accountNum = bankConfig ? (bankConfig.account || "") : "N/A";
                autoVerifyFailedReason = `Receiver detail mismatch. The receipt text does not match the system's receiver name ("${ownerName}") or account number ("${accountNum}").`;
              } else {
                autoVerifyFailedReason = `Reference ID not found in gateway. The system hasn't received the official bank SMS for "${cleanUserTxId}" from the gateway (yet), or the reference number is incorrect/fake.`;
              }
            }
          }
        }
      }

      // 4. Auto-approve ONLY if verified by real SMS Gateway (SMS Webhook)
      if (isVerifiedBySMS && txId && smsRecordFound) {
        const creditAmount = Number(smsRecordFound.amount) || targetAmount;

        // Double-check duplicates in DB just to be absolutely sure
        const { data: duplicateTxsCheck } = await supabase
          .from('transactions')
          .select('id')
          .ilike('description', `%${txId}%`)
          .limit(1);

        if (duplicateTxsCheck && duplicateTxsCheck.length > 0) {
          if (progressMsg) {
            await bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
          }
          await bot.sendMessage(chatId, "❌ This transaction ID has already been verified and claimed.");
          userStates.set(userId, { step: 'idle' });
          return;
        }

        // Auto approve!
        const result = await txManager.modifyBalance(
          userId,
          creditAmount,
          'reward',
          `Deposit Auto-Approved (Ref: ${txId})`
        );

        if (result.success) {
          if (progressMsg) {
            await bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
          }

          // Clear user's cache and emit socket updates
          userBalanceCache.delete(userId);
          io.emit('balanceUpdated', { userId, balance: result.newBalance });

          const escapedUsername = escapeHTML(username);
          const gatewayBadge = " [Gateway ✅]";
          await postToChannel(`✅ <b>Auto-Deposit Verified!</b>${gatewayBadge}\n\n👤 <b>User:</b> @${escapedUsername}\n💰 <b>Amount:</b> <code>${creditAmount.toLocaleString()} ETB</code>\n🧾 <b>Ref:</b> <code>${txId}</code>\n👤 <b>Sender Name:</b> <code>${nameVerificationMsg}</code>`);

          // Notify admins of success
          const verificationBadge = `🛡️ <b>VERIFIED BY SMS GATEWAY</b>\n👤 <b>Depositor Match:</b> ${nameVerificationMsg}`;
          const adminMsg = `⚡ <b>AUTO-VERIFIED DEPOSIT</b>\n\n` +
            `👤 <b>User:</b> @${escapedUsername} (${escapeHTML(fullName)})\n` +
            `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
            `💰 <b>Amount:</b> <b>${creditAmount.toLocaleString()} ETB</b>\n` +
            `🏦 <b>Bank:</b> <b>${escapeHTML(bank)}</b>\n` +
            `🧾 <b>Ref ID:</b> <code>${txId}</code>\n` +
            `${verificationBadge}\n\n` +
            `🟢 <i>Credited instantly to user's wallet!</i>`;

          const primaryId = getPrimaryOwnerId();
          adminChatIds.add(primaryId);
          adminChatIds.forEach(async (adminId) => {
            try {
              await bot.sendMessage(adminId, adminMsg, { parse_mode: "HTML" });
            } catch (e) {}
          });

          // Send confirmation message to the user
          const userApprovedMsg = (promptsConfig.deposit_approved_msg || "✅ *ማስገባትዎ ተረጋግጧል!*\n\n💰 *{amount} ብር* በWalletዎ ውስጥ ገብቷል።\n🧾 *Ref:* `{ref}`")
            .replace(/{amount}/g, creditAmount.toLocaleString())
            .replace(/{ref}/g, txId);
          await bot.sendMessage(chatId, userApprovedMsg, { parse_mode: "Markdown" });

          // Clear state
          userStates.set(userId, { step: 'idle' });
          return;
        }
      }

      // Fallback to manual admin approval
      if (progressMsg) {
        await bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
      }

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
        chatId,
        rejectReason: autoVerifyFailedReason || "Unknown Reason"
      });
      await savePendingRequestsToDB().catch(e => logBot(`Error saving pending request: ${e.message}`));

      // Send Confirmation to User
      bot.sendMessage(chatId, "✅ *የማስገባት ጥያቄዎ ለአስተዳዳሪዎች ተልኳል። እባክዎ 1 ደቂቃ ይጠብቁ።*\n\n_(Your deposit Request have been sent to admins please wait 1 min.)_", { parse_mode: "Markdown" });

      // Clear state
      userStates.set(userId, { step: 'idle' });

      // Notify starting admin if admin list is empty (failsafe)
      if (adminChatIds.size === 0) {
        adminChatIds.add(getPrimaryOwnerId());
      }

      // Notify Admins
      const escapedUsername = escapeHTML(username);
      const escapedFullName = escapeHTML(fullName);
      const escapedText = escapeHTML(text);
      const escapedBank = escapeHTML(bank);
      const escapedReason = escapeHTML(autoVerifyFailedReason || "Unknown Reason / No Match Found");

      const adminMsg = `📥 <b>NEW DEPOSIT REQUEST (Manual Review Required)</b>\n\n` +
        `👤 <b>User:</b> @${escapedUsername} (${escapedFullName})\n` +
        `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
        `💰 <b>Amount:</b> <b>${amount.toLocaleString()} ETB</b>\n` +
        `🏦 <b>Bank:</b> <b>${escapedBank}</b>\n\n` +
        `⚠️ <b>Auto-Verification Failure Reason:</b>\n` +
        `🔴 <i>${escapedReason}</i>\n\n` +
        `📝 <b>Receipt SMS text:</b>\n` +
        `<pre>${escapedText}</pre>\n\n` +
        `<b>Request ID:</b> <code>${requestId}</code>`;

      const primaryOwnerId = getPrimaryOwnerId();
      adminChatIds.add(primaryOwnerId); // Ensure primary owner is always in the set

      logBot(`[ADMIN-NOTIFY] Notifying ${adminChatIds.size} admins of new manual deposit request ${requestId}. Admin IDs: ${Array.from(adminChatIds).join(', ')}`);
      adminChatIds.forEach(async (adminId) => {
        try {
          await bot.sendMessage(adminId, adminMsg, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "Approve ✅", callback_data: `approve_dep_${requestId}` },
                  { text: "Decline ❌", callback_data: `decline_dep_${requestId}` }
                ]
              ]
            }
          });
          logBot(`[ADMIN-NOTIFY] Successfully sent deposit notification to admin ${adminId}`);
        } catch (e: any) {
          logBot(`[ADMIN-NOTIFY] Failed to notify admin ${adminId} of deposit: ${e.message}`);
          if (e.message.includes('bot was blocked') || e.message.includes('chat not found')) {
            logBot(`[ADMIN-NOTIFY] CRITICAL: Admin ${adminId} has not started the bot or has blocked it.`);
          }
        }
      });
      return;
    }

    // 3. WITHDRAWAL: AMOUNT ENTRY
    if (state.step === 'withdraw_amount') {
      await bot.sendChatAction(chatId, 'typing').catch(() => {});
      const cleanText = text.replace(/,/g, '');
      const amount = Math.floor(Math.abs(parseFloat(cleanText)));
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

        // Dynamically build bank selection keyboard
        const bk = promptsConfig.banks;
        const inline_keyboard: any[][] = [];
        const bankIds = Object.keys(bk);

        if (bankIds.length === 0) {
          logBot(`[WARNING] No banks configured for withdrawal! User: ${userId}`);
          return bot.sendMessage(chatId, "⚠️ <b>Currently no withdrawal methods are available.</b>\n\nPlease contact support.", { parse_mode: "HTML" });
        }

        for (let i = 0; i < bankIds.length; i += 2) {
          const row: any[] = [];
          row.push({ text: bk[bankIds[i]].name || bankIds[i], callback_data: `wd_bank_${bankIds[i]}` });
          if (i + 1 < bankIds.length) {
            row.push({ text: bk[bankIds[i + 1]].name || bankIds[i + 1], callback_data: `wd_bank_${bankIds[i + 1]}` });
          }
          inline_keyboard.push(row);
        }

        return bot.sendMessage(chatId, "እባክዎን የሚያወጡበትን ባንክ ይምረጡ።", {
          reply_markup: {
            inline_keyboard
          }
        });

      } catch (err) {
        console.error("Balance lookup failed:", err);
        return bot.sendMessage(chatId, "An error occurred lookup your balance. Try again.");
      }
    }

// Simple in-memory maps for rate limiting
const withdrawalCooldowns = new Map<string, number>();

    // 4. WITHDRAWAL: ACCOUNT / PHONE ENTRY
    if (state.step === 'withdraw_account') {
      await bot.sendChatAction(chatId, 'typing').catch(() => {});
      const lastWithdraw = withdrawalCooldowns.get(userId) || 0;
      if (Date.now() - lastWithdraw < 10000) {
        return bot.sendMessage(chatId, "⚠️ *እባክዎን ትንሽ ይጠብቁ!* በየ 10 ሴኮንዱ አንድ ጊዜ ብቻ ማውጣት ይችላሉ።\n\n_(Please wait 10 seconds between requests)_", { parse_mode: "Markdown" });
      }
      withdrawalCooldowns.set(userId, Date.now());

      const amount = state.amount || 100;
      const bank = state.bank || "Telebirr";
      const username = msg.from?.username || "no_username";
      const fullName = `${msg.from?.first_name || ""} ${msg.from?.last_name || ""}`.trim() || "Player";

      try {
        // Generate unique request code
        const requestId = "WD_" + generateRef(8);

        // Prevent double spending by deducting balance IMMEDIATELY upon request using atomic transaction queue
        const result = await txManager.modifyBalance(
          userId,
          -amount,
          'bet',
          `Withdrawal Pending (Ref: ${requestId})`
        );

        if (!result.success) {
          userStates.set(userId, { step: 'idle' });
          return bot.sendMessage(chatId, `❌ *ባላንስ መቀነስ አልተቻለም!* ${result.error || "በቂ ባላንስ የለዎትም ወይም ሌላ ስህተት አጋጥሟል።"}`, { parse_mode: "Markdown" });
        }

        const newBalance = result.newBalance;

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
        savePendingRequestsToDB().catch(e => logBot(`Error saving pending request: ${e.message}`));

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
        const escapedUsername = escapeHTML(username);
        const escapedFullName = escapeHTML(fullName);
        const escapedBank = escapeHTML(bank);
        const escapedAccount = escapeHTML(text);

        const adminMsg = `📤 <b>NEW WITHDRAWAL REQUEST</b>\n\n` +
          `👤 <b>User:</b> @${escapedUsername} (${escapedFullName})\n` +
          `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
          `💰 <b>Amount:</b> <b>${amount.toLocaleString()} ETB</b>\n` +
          `🏦 <b>Bank:</b> <b>${escapedBank}</b>\n` +
          `💳 <b>Account/Phone:</b> <code>${escapedAccount}</code>\n\n` +
          `<b>Request ID:</b> <code>${requestId}</code>`;

        const primaryOwnerId = getPrimaryOwnerId();
        adminChatIds.add(primaryOwnerId); // Ensure primary owner is always in the set

        logBot(`[ADMIN-NOTIFY] Notifying ${adminChatIds.size} admins of new withdrawal request ${requestId}. Admin IDs: ${Array.from(adminChatIds).join(', ')}`);
        adminChatIds.forEach(async (adminId) => {
          try {
            await bot.sendMessage(adminId, adminMsg, {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "Approve ✅", callback_data: `approve_wd_${requestId}` },
                    { text: "Decline ❌", callback_data: `decline_wd_${requestId}` }
                  ]
                ]
              }
            });
            logBot(`[ADMIN-NOTIFY] Successfully sent withdrawal notification to admin ${adminId}`);
          } catch (e: any) {
            logBot(`[ADMIN-NOTIFY] Failed to notify admin ${adminId} of withdrawal: ${e.message}`);
            if (e.message.includes('bot was blocked') || e.message.includes('chat not found')) {
              logBot(`[ADMIN-NOTIFY] CRITICAL: Admin ${adminId} has not started the bot or has blocked it.`);
            }
          }
        });

      } catch (err) {
        console.error("Deducting balance for withdrawal request failed:", err);
        bot.sendMessage(chatId, "⚠️ Failed to submit withdrawal request. Please retry.");
      }
    }

    // 5. WELCOME BUTTON: EDIT LABEL
    if (state.step === 'awaiting_wbtn_label_change') {
      if (!numUserId || !isAnyAdmin(userId)) return;
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
      if (!numUserId || !isAnyAdmin(userId)) return;
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
      if (!numUserId || !isAnyAdmin(userId)) return;
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
      if (!numUserId || !isAnyAdmin(userId)) return;
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
      if (!numUserId || !isAnyAdmin(userId)) return;
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
      if (!numUserId || !isAnyAdmin(userId)) return;
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
      if (!numUserId || !isAnyAdmin(userId)) return;
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
      if (!numUserId || !isAnyAdmin(userId)) return;
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
      if (!numUserId || !isAnyAdmin(userId)) return;
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
      if (!numUserId || !isAnyAdmin(userId)) return;
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
      if (!numUserId || !isAnyAdmin(userId)) return;
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
      if (!numUserId || !isAnyAdmin(userId)) return;
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
      if (!numUserId || !isAnyAdmin(userId)) return;
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

    } catch (err: any) {
      logBot(`Unexpected error in message dispatcher for ${userId}: ${err.message}`);
      bot.sendMessage(chatId, "❌ An unexpected error occurred. Please try again.", { parse_mode: "HTML" });
    } finally {
      processingUsers.delete(userId);
    }
  });

  // --- CONTACT REGISTER HANDLER ---
  bot.on("contact", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    const contact = msg.contact;

    if (!userId || !contact) return;

    try {
      // Validate that the shared contact is actually their own
    if (contact.user_id && contact.user_id.toString() !== userId) {
      return bot.sendMessage(chatId, "⚠️ <b>Validation Error:</b> Please share your own contact to register.", { parse_mode: "HTML" });
    }

    const username = msg.from?.username || "";
    const firstName = msg.from?.first_name || "";
    const lastName = msg.from?.last_name || "";
    const phoneNumber = contact.phone_number;

    let photoUrl = "";
    const photosRes = await bot.getUserProfilePhotos(msg.from.id, { limit: 1 });
      if (photosRes && photosRes.total_count > 0 && photosRes.photos.length > 0) {
        const fileId = photosRes.photos[0][0].file_id;
        const file = await bot.getFile(fileId);
        if (file && file.file_path) {
          photoUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        }
      }

    // Create user record in Supabase
    const upsertData: any = {
        id: userId,
        username: username || null,
        first_name: firstName || null,
        last_name: lastName || null,
        phone: phoneNumber || null,
        photo_url: photoUrl || null,
        balance: 0 // Starting balance
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
      const welcomeMsgPattern = promptsConfig.welcome_msg || DEFAULT_PROMPTS_CONFIG.welcome_msg;
        
      const greetingMsg = welcomeMsgPattern
        .replace(/{name}/g, firstName)
        .replace(/{balance}/g, "100,000 ETB");

      const welcomeButtonsRows = ((promptsConfig.welcome_buttons && promptsConfig.welcome_buttons.length > 0) 
        ? promptsConfig.welcome_buttons 
        : DEFAULT_PROMPTS_CONFIG.welcome_buttons).map(row => 
        row.map(btn => {
          const btnVal = btn.value === 'appUrl' ? globalAppUrl : btn.value;
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
    const userId = query.from.id.toString();
    const data = query.data;
    const messageId = query.message?.message_id;
    logBot(`callback_query received: userId=${userId}, chatId=${chatId}, data=${data}`);

    // Deduplicate callback queries to prevent duplicate responses
    if (processedCallbacks.has(query.id)) {
      return;
    }
    processedCallbacks.add(query.id);
    if (processedCallbacks.size > 1000) {
      const first = processedCallbacks.values().next().value;
      if (first !== undefined) processedCallbacks.delete(first);
    }

    if (blockedUsersCache.has(userId)) {
      const isStartingAdm = isAnyAdmin(userId);
      if (!isStartingAdm) {
        try {
          await bot.answerCallbackQuery(query.id, { text: "❌ You are blocked from using this bot.", show_alert: true });
        } catch (e) {}
        return;
      }
    }

    // Common Admin check for sensitive data prefixes
    const ownerOnlyPrefixes = ['edit_section_', 'edit_bank', 'edit_key_', 'setadmin_'];
    const generalAdminPrefixes = ['analysis_', 'broadcast_'];

    const isControlCallback = data?.startsWith("control_") || 
                              data?.startsWith("game_set_") ||
                              data?.startsWith("autocamp_") ||
                              data?.startsWith("cmd_") ||
                              ownerOnlyPrefixes.some(p => data?.startsWith(p)) ||
                              generalAdminPrefixes.some(p => data?.startsWith(p));

    if (isControlCallback) {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        try {
          await bot.answerCallbackQuery(query.id, { text: "❌ ይህ ፈቃድ ለዋናው አድሚን ብቻ የተፈቀደ ነው! (Only starting admin is authorized!)", show_alert: true });
        } catch (e) {}
        return;
      }
    }

    if (data === "control_game_settings" || data === "game_set_back_list") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied", show_alert: true });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      renderGameSettingsPanel(chatId, messageId);
      return;
    }

    if (data === "game_set_back_main") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied", show_alert: true });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      renderMainControlPanel(chatId, messageId);
      return;
    }

    if (data?.startsWith("game_set_select:")) {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied", show_alert: true });
        return;
      }
      const gameId = data.substring("game_set_select:".length);
      await bot.answerCallbackQuery(query.id);
      renderSingleGameSettings(chatId, gameId, messageId);
      return;
    }

    if (data?.startsWith("game_set_toggle:")) {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied", show_alert: true });
        return;
      }
      const gameId = data.substring("game_set_toggle:".length);
      const settings = getGameSettingsSync();
      if (settings[gameId]) {
        settings[gameId].enabled = !settings[gameId].enabled;
        const saved = await saveGameSettings(settings);
        if (saved) {
          await bot.answerCallbackQuery(query.id, { text: `✅ ${settings[gameId].nameAm} ${settings[gameId].enabled ? "ተከፍቷል (Enabled)" : "ተዘግቷል (Disabled)"}` });
        } else {
          await bot.answerCallbackQuery(query.id, { text: "❌ ማስቀመጥ አልተቻለም (Failed to save)", show_alert: true });
        }
        renderSingleGameSettings(chatId, gameId, messageId);
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ ጨዋታው አልተገኘም (Game not found)", show_alert: true });
      }
      return;
    }

    if (data?.startsWith("game_set_min:")) {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied", show_alert: true });
        return;
      }
      const gameId = data.substring("game_set_min:".length);
      const g = getGameConfig(gameId);
      if (!g) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Game not found", show_alert: true });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      userStates.set(userId, { step: "awaiting_game_min_bet", gameId });
      
      const isSlotOrBingo = gameId.startsWith("jackpot_") || gameId.startsWith("bingo_");
      const label = isSlotOrBingo ? "የቲኬት መግቢያ ዋጋ (Ticket Entry Fee)" : "ዝቅተኛ ውርርድ (Min Bet Limit)";

      await bot.sendMessage(chatId, 
        `📉 <b>የ${g.nameAm} ${label} ማስተካከያ</b>\n\n` +
        `እባክዎ አዲሱን <b>${label}</b> በቁጥር ይላኩ።\n` +
        `የአሁኑ ዋጋ: <code>${g.minBet.toLocaleString()} ETB</code>\n\n` +
        `<i>ለማቋረጥ /cancel ብለው ይላኩ።</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (data?.startsWith("game_set_max:")) {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied", show_alert: true });
        return;
      }
      const gameId = data.substring("game_set_max:".length);
      const g = getGameConfig(gameId);
      if (!g) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Game not found", show_alert: true });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      userStates.set(userId, { step: "awaiting_game_max_bet", gameId });
      
      const isSlotOrBingo = gameId.startsWith("jackpot_") || gameId.startsWith("bingo_");
      const label = isSlotOrBingo ? "ከፍተኛ የቲኬት ገደብ (Max Limit)" : "ከፍተኛ ውርርድ (Max Bet Limit)";

      await bot.sendMessage(chatId, 
        `📈 <b>የ${g.nameAm} ${label} ማስተካከያ</b>\n\n` +
        `እባክዎ አዲሱን <b>${label}</b> በቁጥር ይላኩ።\n` +
        `የአሁኑ ዋጋ: <code>${g.maxBet.toLocaleString()} ETB</code>\n\n` +
        `<i>ለማቋረጥ /cancel ብለው ይላኩ።</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (data?.startsWith("game_set_mult:")) {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied", show_alert: true });
        return;
      }
      const gameId = data.substring("game_set_mult:".length);
      const g = getGameConfig(gameId);
      if (!g) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Game not found", show_alert: true });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      userStates.set(userId, { step: "awaiting_game_multiplier", gameId });
      
      const label = gameId.startsWith("bingo_") ? "የአሸናፊነት ክፍያ ስርጭት (Payout Ratio)" : "የአሸናፊነት ማባዣ (Payout Multiplier)";

      await bot.sendMessage(chatId, 
        `✖️ <b>የ${g.nameAm} ${label} ማስተካከያ</b>\n\n` +
        `እባክዎ አዲሱን <b>${label}</b> በቁጥር (ለምሳሌ: 2.0 ወይም 0.8) ይላኩ።\n` +
        `የአሁኑ ማባዣ: <code>${g.multiplier}x</code>\n\n` +
        `<i>ለማቋረጥ /cancel ብለው ይላኩ።</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Provide immediate "typing..." status for better responsiveness
    bot.sendChatAction(chatId, 'typing').catch(() => {});

    // Answer immediately to stop button spinner for better UX
    try {
      // Provide immediate "Processing..." toast for sensitive interactions
      const sensitiveActions = ['withdraw', 'deposit', 'confirm', 'exec', 'save', 'delete', 'update', 'edit', 'analysis', 'broadcast', 'admin', 'approve', 'decline'];
      const isSensitive = sensitiveActions.some(action => data?.toLowerCase().includes(action));
      
      if (isSensitive) {
        await bot.answerCallbackQuery(query.id, { text: "⏳ Processing... Please wait", show_alert: false });
      } else {
        await bot.answerCallbackQuery(query.id);
      }
    } catch (err) {
      // Ignore if already answered or expired
    }

    if (!data) return;

    try {
      logBot(`[Callback Query] data=${data} user=${userId} chat=${chatId}`);

    if (data?.startsWith("analysis_")) {
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner Only", show_alert: true });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      renderSetAdminMenu(bot, chatId);
      return;
    }

    if (data === "control_users_report") {
      if (!isAnyAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Access Denied", show_alert: true }).catch(() => {});
        return;
      }
      await bot.answerCallbackQuery(query.id).catch(() => {});
      const statusMsg = await bot.sendMessage(chatId, "⏳ <b>Generating Users Report...</b> Please wait a moment.", { parse_mode: "HTML" }).catch(() => null);
      try {
        await handleUsersReport(bot, chatId, supabase);
        if (statusMsg) {
          await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        }
        renderMainControlPanel(chatId);
      } catch (err: any) {
        console.error("Users report execution error:", err);
        if (statusMsg) {
          await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        }
        await bot.sendMessage(chatId, `❌ Error: ${err.message || err}`).catch(() => {});
      }
      return;
    }

    if (data === "control_financial_report") {
      if (!isAnyAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Access Denied", show_alert: true }).catch(() => {});
        return;
      }
      await bot.answerCallbackQuery(query.id).catch(() => {});
      const statusMsg = await bot.sendMessage(chatId, "⏳ <b>Generating Audited Financial Report...</b> Please wait a moment.", { parse_mode: "HTML" }).catch(() => null);
      try {
        await handleFinancialReport(bot, chatId, supabase);
        if (statusMsg) {
          await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        }
        renderMainControlPanel(chatId);
      } catch (err: any) {
        console.error("Financial report execution error:", err);
        if (statusMsg) {
          await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        }
        await bot.sendMessage(chatId, `❌ Error: ${err.message || err}`).catch(() => {});
      }
      return;
    }

    if (data === "control_analysis") {
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner Only", show_alert: true });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const composer: BroadcastComposer = { step: 'choose_target', target: 'all', template: 'none' };
      broadcastStates.set(userId, composer);
      await renderBroadcastDashboard(bot, chatId, userId, composer);
      return;
    }

    if (data === "control_announcement_menu") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      await renderAnnouncementCmdPanel(chatId, messageId);
      return;
    }

    if (data === "debug_list_users") {
        if (!isAnyAdmin(userId)) {
            bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
            return;
        }
        await bot.answerCallbackQuery(query.id);
        const { data: users, error } = await supabase.from('users').select('id, username, first_name').limit(50);
        if (error) {
            logBot(`Error fetching users: ${error.message}`);
            return bot.sendMessage(chatId, "❌ Error fetching users.");
        }
        let userList = `👥 <b>First 50 Users (Debug):</b>\n\n`;
        users?.forEach(u => {
            userList += `• ID: <code>${u.id}</code> | User: ${u.username || 'N/A'} | Name: ${u.first_name || 'N/A'}\n`;
        });
        await bot.sendMessage(chatId, userList, { parse_mode: "HTML" });
        return;
    }

    if (data === "debug_list_dummy_users") {
        if (!isAnyAdmin(userId)) {
            bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
            return;
        }
        await bot.answerCallbackQuery(query.id);
        
        // Query users matching dummy criteria
        const { data: users, error } = await supabase.from('users')
            .select('id, username, first_name')
            .or('first_name.eq.N/A,username.ilike.Player_%');
            
        if (error) {
            logBot(`Error fetching dummy users: ${error.message}`);
            return bot.sendMessage(chatId, "❌ Error fetching dummy users.");
        }
        
        if (!users || users.length === 0) {
            return bot.sendMessage(chatId, "✅ No dummy users found.");
        }

        let userList = `🗑️ <b>Dummy Users Found (${users.length}):</b>\n\n`;
        const displayedUsers = users.slice(0, 30);
        displayedUsers.forEach(u => {
            userList += `• ID: <code>${u.id}</code> | User: ${u.username || 'N/A'} | Name: ${u.first_name || 'N/A'}\n`;
        });
        if (users.length > 30) {
            userList += `\n...and ${users.length - 30} more.`;
        }
        userList += `\n\nDo you want to delete all ${users.length} of these users? (This action is irreversible)`;
        
        const keyboard = {
            inline_keyboard: [
                [{ text: `🔥 Confirm Delete All ${users.length} Dummy Users`, callback_data: "debug_delete_dummy_users_confirm" },
                 { text: "📊 Export to Excel", callback_data: "debug_export_dummy_users" }]
            ]
        };
        
        await bot.sendMessage(chatId, userList, { parse_mode: "HTML", reply_markup: keyboard });
        return;
    }

    if (data === "debug_export_dummy_users") {
        if (!isAnyAdmin(userId)) {
            bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
            return;
        }
        await bot.answerCallbackQuery(query.id, { text: "📊 Generating Excel..." });
        
        const { data: users, error } = await supabase.from('users')
            .select('id, username, first_name')
            .or('first_name.eq.N/A,username.ilike.Player_%');
            
        if (error || !users) {
            logBot(`Error fetching dummy users for export: ${error?.message}`);
            return bot.sendMessage(chatId, "❌ Error fetching dummy users for export.");
        }
        
        const excelBuf = await generateDummyUsersExcelBuffer(users);
        await bot.sendDocument(chatId, excelBuf, {}, {
            filename: `Dummy_Users_Report_${new Date().toISOString().split('T')[0]}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        return;
    }
    
    if (data === "debug_delete_dummy_users_confirm") {
        if (!isAnyAdmin(userId)) {
            bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
            return;
        }
        await bot.answerCallbackQuery(query.id, { text: "🔥 Deleting dummy users..." });
        
        // Query users matching dummy criteria
        const { data: users, error } = await supabase.from('users')
            .select('id, first_name')
            .or('first_name.eq.N/A,username.ilike.Player_%');
            
        if (error) {
            logBot(`Error fetching dummy users for deletion: ${error.message}`);
            return bot.sendMessage(chatId, "❌ Error fetching dummy users for deletion.");
        }
        
        if (!users || users.length === 0) {
            return bot.sendMessage(chatId, "✅ No dummy users found to delete.");
        }
        
        // Filter out Dave / ሞላ/ጎደል (by name or other info if available)
        const dummyUsers = users.filter(u => u.first_name !== 'Dave' && u.first_name !== 'ሞላ/ጎደል');
        const idsToDelete = dummyUsers.map(u => u.id);
        
        if (idsToDelete.length === 0) {
            return bot.sendMessage(chatId, "✅ No dummy users found to delete (after excluding protected users).");
        }
        
        // Delete related transactions first
        const { error: deleteTransactionsError } = await supabase.from('transactions')
            .delete()
            .in('user_id', idsToDelete);
            
        if (deleteTransactionsError) {
            logBot(`Error deleting transactions for dummy users: ${deleteTransactionsError.message}`);
            return bot.sendMessage(chatId, `❌ Error deleting transactions: ${deleteTransactionsError.message}`);
        }

        // Delete
        const { error: deleteError } = await supabase.from('users')
            .delete()
            .in('id', idsToDelete);
            
        if (deleteError) {
            logBot(`Error deleting dummy users: ${deleteError.message}`);
            return bot.sendMessage(chatId, `❌ Error deleting dummy users: ${deleteError.message}`);
        }
        
        await bot.sendMessage(chatId, `✅ Successfully deleted ${idsToDelete.length} dummy users.`);
        return;
    }
    if (data === "control_unpin_all") {
      logBot(`Unpin all requested by chatId=${chatId}, userId=${userId}`);
      if (!isStartingAdmin(Number(chatId))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      const channelId = getChannelId();
      logBot(`DEBUG: Unpinning all messages in Channel ID: '${channelId}' (type: ${typeof channelId})`);
      if (!channelId || channelId === "⚠️ <b>NOT CONFIGURED</b>") {
         bot.answerCallbackQuery(query.id, { text: "❌ Channel not configured" });
         return;
      }
      try {
        await bot.unpinAllChatMessages(channelId);
        logBot(`DEBUG: Successfully unpinned all messages in Channel ID: '${channelId}'`);
        await bot.answerCallbackQuery(query.id, { text: "✅ All messages unpinned" });
      } catch (e) {
        logBot(`Error unpinning: ${e}`);
        await bot.answerCallbackQuery(query.id, { text: `❌ Error unpinning: ${e}` });
      }
      return;
    }

    if (data === "control_autocamp") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      await renderAutoCampaignDashboard(chatId, messageId);
      return;
    }

    if (data === "control_ai_instructions") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      await renderAIInstructionsPanel(chatId, messageId);
      return;
    }

    if (data === "control_ai_edit") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      userStates.set(userId, { step: "editing_ai_instructions" });
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, "📝 <b>Edit AI System Instructions</b>\n\nPlease send the new system instructions for the AI Support Assistant.\n\n<i>This will define how the AI behaves, what it knows about the game, and its safety rules.</i>\n\nType /cancel to abort.", { parse_mode: "HTML" });
      return;
    }

    if (data === "control_kb_main") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      await renderKBPanel(chatId, messageId);
      return;
    }

    if (data === "control_kb_add") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      userStates.set(userId, { step: "editing_kb_chunk" });
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, "📝 <b>Add to Knowledge Base</b>\n\nPlease send the text you want the AI to remember.\n\nType /cancel to abort.", { parse_mode: "HTML" });
      return;
    }

    if (data === "control_kb_search") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      userStates.set(userId, { step: "searching_kb" });
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, "🔍 <b>Test Knowledge Base Search</b>\n\nPlease send a question or keyword to test what the AI finds in the database.\n\nType /cancel to abort.", { parse_mode: "HTML" });
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
      await processUserLookup(chatId, targetId, messageId);
      return;
    }

    if (data?.startsWith("lookup_toggle_admin_")) {
      if (!isAnyAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: "❌ ይህ ፈቃድ ለአድሚን ብቻ የተፈቀደ ነው! (Only admins are authorized!)", show_alert: true });
        return;
      }
      const targetId = data.substring("lookup_toggle_admin_".length);
      
      const { data: user } = await supabase.from('users').select('is_admin').eq('id', targetId).maybeSingle();
      if (user) {
        const newAdminStatus = !user.is_admin;
        const { error: updateError } = await supabase.from('users').update({ is_admin: newAdminStatus }).eq('id', targetId);
        if (!updateError) {
          if (newAdminStatus) {
            adminChatIds.add(parseInt(targetId, 10));
          } else {
            adminChatIds.delete(parseInt(targetId, 10));
          }
          await bot.answerCallbackQuery(query.id, { text: `Success: Admin status set to ${newAdminStatus}`, show_alert: true });
          await processUserLookup(chatId, targetId, messageId);
        } else {
          await bot.answerCallbackQuery(query.id, { text: `Error: ${updateError.message}`, show_alert: true });
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "User not found", show_alert: true });
      }
      return;
    }

    if (data?.startsWith("lookup_toggle_block_")) {
      if (!isAnyAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: "❌ ይህ ፈቃድ ለአድሚን ብቻ የተፈቀደ ነው! (Only admins are authorized!)", show_alert: true });
        return;
      }
      const targetId = data.substring("lookup_toggle_block_".length);
      
      const { data: user } = await supabase.from('users').select('is_blocked_bot').eq('id', targetId).maybeSingle();
      if (user) {
        const newBlockStatus = !user.is_blocked_bot;
        const { error: updateError } = await supabase.from('users').update({ is_blocked_bot: newBlockStatus }).eq('id', targetId);
        if (!updateError) {
          if (newBlockStatus) {
            blockedUsersCache.add(targetId);
          } else {
            blockedUsersCache.delete(targetId);
          }
          await bot.answerCallbackQuery(query.id, { text: `Success: User blocked status set to ${newBlockStatus}`, show_alert: true });
          await processUserLookup(chatId, targetId, messageId);
        } else {
          await bot.answerCallbackQuery(query.id, { text: `Error: ${updateError.message}`, show_alert: true });
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "User not found", show_alert: true });
      }
      return;
    }

    if (data?.startsWith("lookup_toggle_affiliate_")) {
      if (!isAnyAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: "❌ ይህ ፈቃድ ለአድሚን ብቻ የተፈቀደ ነው! (Only admins are authorized!)", show_alert: true });
        return;
      }
      const targetId = data.substring("lookup_toggle_affiliate_".length);
      
      const { data: txs } = await supabase.from('transactions').select('*').eq('user_id', targetId);
      const isBanned = txs?.some(t => t.type === 'affiliate_flag' && t.description?.includes('Banned by Admin'));
      
      if (isBanned) {
        const { error } = await supabase.from('transactions').delete().eq('user_id', targetId).eq('type', 'affiliate_flag');
        if (!error) {
          await bot.answerCallbackQuery(query.id, { text: "Success: Affiliate unbanned!", show_alert: true });
          await processUserLookup(chatId, targetId, messageId);
        } else {
          await bot.answerCallbackQuery(query.id, { text: `Error: ${error.message}`, show_alert: true });
        }
      } else {
        const { error } = await supabase.from('transactions').insert({
          user_id: targetId,
          type: 'affiliate_flag',
          amount: 0,
          description: 'Banned by Admin (Abuse Prevention)'
        });
        if (!error) {
          await bot.answerCallbackQuery(query.id, { text: "Success: Affiliate banned!", show_alert: true });
          await processUserLookup(chatId, targetId, messageId);
        } else {
          await bot.answerCallbackQuery(query.id, { text: `Error: ${error.message}`, show_alert: true });
        }
      }
      return;
    }

    if (data?.startsWith("lookup_adjust_bal_")) {
      if (!isAnyAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: "❌ ይህ ፈቃድ ለአድሚን ብቻ የተፈቀደ ነው! (Only admins are authorized!)", show_alert: true });
        return;
      }
      const targetId = data.substring("lookup_adjust_bal_".length);
      await bot.answerCallbackQuery(query.id);
      
      const { data: targetUser } = await supabase.from('users').select('*').eq('id', targetId).maybeSingle();
      if (!targetUser) {
        await bot.sendMessage(chatId, "❌ ተጠቃሚው አልተገኘም (User not found).");
        return;
      }

      const text = `💰 <b>የሂሳብ ማስተካከያ (Balance Adjustment Panel)</b>\n\n` +
                   `👤 <b>ተጠቃሚ (User ID):</b> <code>${targetId}</code>\n` +
                   `👤 <b>የተጠቃሚ ስም (Username):</b> @${targetUser.username || 'N/A'}\n` +
                   `💳 <b>የአሁኑ ሂሳብ (Current Balance):</b> <code>${Number(targetUser.balance).toLocaleString()} ETB</code>\n\n` +
                   `👉 <b>እባክዎ ምን ማድረግ እንደሚፈልጉ ይምረጡ:</b>\n` +
                   `<i>⚠️ ማሳሰቢያ: ይህ ማስተካከያ ከፍተኛ ጥንቃቄ ስለሚያስፈልገው እባክዎ በትክክል ያረጋግጡ!</i>`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: "➕ ገንዘብ ጨምር (Increase Balance)", callback_data: `lookup_bal_add:${targetId}` }
          ],
          [
            { text: "➖ ገንዘብ ቀንስ (Decrease Balance)", callback_data: `lookup_bal_sub:${targetId}` }
          ],
          [
            { text: "🔙 ወደ ተጠቃሚው መረጃ (Back)", callback_data: `lookup_user:${targetId}` }
          ]
        ]
      };

      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard })
          .catch(() => bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard }));
      } else {
        await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data?.startsWith("lookup_bal_add:") || data?.startsWith("lookup_bal_sub:")) {
      if (!isAnyAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Only admins are authorized!", show_alert: true });
        return;
      }
      const isAdd = data.startsWith("lookup_bal_add:");
      const targetId = data.substring(isAdd ? "lookup_bal_add:".length : "lookup_bal_sub:".length);
      await bot.answerCallbackQuery(query.id);

      userStates.set(userId, { step: isAdd ? "awaiting_bal_add" : "awaiting_bal_sub", targetUserId: targetId });

      const actionText = isAdd ? "ገንዘብ ለመጨመር (Increase Balance)" : "ገንዘብ ለመቀነስ (Decrease Balance)";
      const actionSymbol = isAdd ? "➕" : "➖";

      const { data: targetUser } = await supabase.from('users').select('*').eq('id', targetId).maybeSingle();
      const currentBal = targetUser ? Number(targetUser.balance).toLocaleString() : "0";

      await bot.sendMessage(chatId,
        `${actionSymbol} <b>የተጠቃሚ ሂሳብ ማስተካከያ (${actionText})</b>\n\n` +
        `👤 <b>ተጠቃሚ (User ID):</b> <code>${targetId}</code>\n` +
        `💳 <b>የአሁኑ ሂሳብ (Current Balance):</b> <code>${currentBal} ETB</code>\n\n` +
        `እባክዎ <b>የሚጨመረውን/የሚቀነሰውን መጠን በቁጥር</b> ይላኩ:\n` +
        `<i>(ለምሳሌ: 250)</i>\n\n` +
        `<i>ለማቋረጥ /cancel ብለው ይላኩ።</i>`,
        { parse_mode: "HTML" }
      );
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
      if (!isAnyAdmin(userId)) return;
      const config = loadAutoCampaignConfig();
      config.isEnabled = !config.isEnabled;
      saveAutoCampaignConfig(config);
      await bot.answerCallbackQuery(query.id, { text: config.isEnabled ? "🟢 Activated!" : "🔴 Paused!" });
      await renderAutoCampaignDashboard(chatId, messageId);
      return;
    }

    if (data === "autocamp_prompts_list" || data === "autocamp_edit_msg") {
      if (!isAnyAdmin(userId)) return;
      await bot.answerCallbackQuery(query.id);
      await renderPromptsListDashboard(chatId, messageId);
      return;
    }

    if (data === "autocamp_p_add") {
      if (!isAnyAdmin(userId)) return;
      await bot.answerCallbackQuery(query.id);
      userStates.set(userId, { step: "autocamp_await_add_prompt" });
      await bot.sendMessage(chatId, "📝 <b>Please type and send your new campaign prompt:</b>\n\n<i>Use placeholders like {name} and {balance}.</i>\n\nType /cancel to abort.", { parse_mode: "HTML" });
      return;
    }

    if (data?.startsWith("autocamp_p_view_")) {
      if (!isAnyAdmin(userId)) return;
      const pId = data.replace("autocamp_p_view_", "");
      await bot.answerCallbackQuery(query.id);
      await renderPromptDetailsDashboard(chatId, pId, messageId);
      return;
    }

    if (data?.startsWith("autocamp_p_activate_")) {
      if (!isAnyAdmin(userId)) return;
      const pId = data.replace("autocamp_p_activate_", "");
      const config = loadAutoCampaignConfig();
      config.activePromptId = pId;
      saveAutoCampaignConfig(config);
      await bot.answerCallbackQuery(query.id, { text: "🎯 Activated template!" });
      await renderPromptDetailsDashboard(chatId, pId, messageId);
      return;
    }

    if (data?.startsWith("autocamp_p_edit_")) {
      if (!isAnyAdmin(userId)) return;
      const pId = data.replace("autocamp_p_edit_", "");
      await bot.answerCallbackQuery(query.id);
      userStates.set(userId, { step: "autocamp_await_edit_prompt_text", editingPromptId: pId });
      await bot.sendMessage(chatId, "📝 <b>Type and send the updated text content for this prompt template:</b>\n\nType /cancel to abort.", { parse_mode: "HTML" });
      return;
    }

    if (data?.startsWith("autocamp_p_delete_")) {
      if (!isAnyAdmin(userId)) return;
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
      if (!isAnyAdmin(userId)) return;
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
      if (!isAnyAdmin(userId)) return;
      const target = data.replace("autocamp_target_", "");
      const config = loadAutoCampaignConfig();
      config.targetCategory = target;
      saveAutoCampaignConfig(config);
      await bot.answerCallbackQuery(query.id, { text: `Target set to: ${target}` });
      await renderAutoCampaignDashboard(chatId, messageId);
      return;
    }

    if (data === "autocamp_set_days") {
      if (!isAnyAdmin(userId)) return;
      await bot.answerCallbackQuery(query.id);
      userStates.set(userId, { step: "autocamp_await_days" });
      await bot.sendMessage(chatId, "💤 <b>Type and send the minimum number of inactive days:</b>\n\n<i>Example: type <code>3</code> to target players who haven't visited for 3+ days. (0 for no limit)</i>", { parse_mode: "HTML" });
      return;
    }

    if (data === "autocamp_set_bal") {
      if (!isAnyAdmin(userId)) return;
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
      if (!isAnyAdmin(userId)) return;
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
      if (!isAnyAdmin(userId)) return;
      await bot.answerCallbackQuery(query.id);
      userStates.set(userId, { step: "autocamp_await_hours" });
      await bot.sendMessage(chatId, "⏱️ <b>Type and send the send interval frequency in Hours:</b>\n\n<i>Example: type <code>24</code> to check and send campaigns once every day.</i>", { parse_mode: "HTML" });
      return;
    }

    if (data === "autocamp_test") {
      if (!isAnyAdmin(userId)) return;
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
              [{ text: "🎮 Play Game Hub 🚀", web_app: { url: globalAppUrl } }]
            ]
          }
        }).catch(async (e: any) => {
          // Fallback to plain text for test
          await bot.sendMessage(chatId, `🧪 <b>TEST PREVIEW (Plain Text Fallback):</b>\n\n${customizedText}`, {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🎮 Play Game Hub 🚀", web_app: { url: globalAppUrl } }]
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
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      sendEditPanelMenu(chatId, messageId);
      return;
    }

    if (data === "edit_section_commands") {
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
          [{ text: "🏦 Manage Banks (Add/Delete)", callback_data: "edit_section_banks" }],
          [{ text: "🔙 Back", callback_data: "control_edit" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data === "edit_section_withdrawal") {
      if (!isAnyAdmin(userId)) {
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
          [{ text: "🏦 Manage Banks (Add/Delete)", callback_data: "edit_section_banks" }],
          [{ text: "🔙 Back", callback_data: "control_edit" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data === "edit_section_banks") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      sendManageBanksMenu(chatId, messageId);
      return;
    }

    if (data === "edit_section_welcome") {
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      await renderAnnouncementsDashboard(chatId, messageId);
      return;
    }
    
    if (data === "control_test_announcement_all") {
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const annId = data.substring("ann_view:".length);
      await renderAnnouncementDetail(chatId, annId, messageId);
      return;
    }

    if (data === "cmd_ann_set_channel") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      userStates.set(userId, { step: "awaiting_channel_id" });
      await bot.sendMessage(chatId, 
        "🆔 <b>Set Telegram Channel ID</b>\n\n" +
        "Please send the <b>Target Channel ID</b> (e.g., <code>-1001234567890</code>).\n\n" +
        "<i>Tip: You can get your channel ID by forwarding a message from it to @userinfobot or @GetIDsBot.</i>\n\n" +
        "Type /cancel to abort.",
        { parse_mode: "HTML" }
      );
      return;
    }

    if (data === "cmd_set_app_url") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      userStates.set(userId, { step: "awaiting_new_app_url_config" });
      await bot.sendMessage(chatId, 
        "🌐 <b>Set Application URL (Web App)</b>\n\n" +
        "Please send the new <b>Application URL</b>.\n\n" +
        "Current URL: <code>" + globalAppUrl + "</code>\n\n" +
        "<i>Note: In AI Studio, use the 'Development App URL' from your metadata or the browser preview URL.</i>\n\n" +
        "Type /cancel to abort.",
        { parse_mode: "HTML" }
      );
      return;
    }

    if (data.startsWith("cmd_ann_toggle:")) {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      const annId = data.substring("cmd_ann_toggle:".length);
      const anns = loadAnnouncements();
      const ann = anns.find(a => a.id === annId);
      if (ann) {
        ann.enabled = !ann.enabled;
        saveAnnouncements(anns);
        await bot.answerCallbackQuery(query.id, { text: `Announcement is now ${ann.enabled ? 'Enabled 🟢' : 'Disabled 🔴'}` });
        await renderAnnouncementCmdPanel(chatId, messageId);
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Announcement not found." });
      }
      return;
    }

    if (data.startsWith("cmd_ann_send:")) {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      const annId = data.substring("cmd_ann_send:".length);
      await bot.answerCallbackQuery(query.id, { text: "⏳ Sending announcement..." });
      
      const channelId = getChannelId();
      if (!channelId) {
        await bot.sendMessage(chatId, "❌ <b>CHANNEL_ID</b> is not configured.\n\nYou can now set it directly in the <b>Announcements Control Panel</b> (under /control), or add it to AI Studio Secrets.", { parse_mode: "HTML" });
        return;
      }

      const anns = loadAnnouncements();
      const ann = anns.find(a => a.id === annId);
      if (ann) {
        try {
          const slotsInfo = {
            grand: formatEmojiNumbers(await generateSlotNumbers(100), 100),
            mini: formatEmojiNumbers(await generateSlotNumbers(50), 50),
            fast: formatEmojiNumbers(await generateSlotNumbers(20), 20)
          };

          const messageText = processAnnouncementText(ann, slotsInfo);
          const photo = ann.photoUrl;

          if (photo) {
            await downloadAndSendPhoto(bot, channelId, photo, { caption: messageText, parse_mode: "HTML" });
          } else {
            await bot.sendMessage(channelId, messageText, { parse_mode: "HTML" });
          }

          ann.lastRunTime = Date.now();
          saveAnnouncements(anns);

          await bot.sendMessage(chatId, `✅ Announcement <code>${annId}</code> successfully sent to the channel!`, { parse_mode: "HTML" });
          await renderAnnouncementCmdPanel(chatId, messageId);
        } catch (err: any) {
          logBot(`Failed to manually send single announcement ${annId}: ${err.message}`);
          await bot.sendMessage(chatId, `❌ Failed to send announcement: ${err.message}`);
        }
      } else {
        await bot.sendMessage(chatId, `❌ Announcement <code>${annId}</code> not found in the current list.`);
      }
      return;
    }

    if (data.startsWith("ann_toggle:")) {
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      const annId = data.substring("ann_send_single:".length);
      await bot.answerCallbackQuery(query.id, { text: "⏳ Sending announcement..." });
      
      const channelId = getChannelId();
      if (!channelId) {
        logBot("[Bot] ann_send_single: CHANNEL_ID is not configured.");
        await bot.sendMessage(chatId, "❌ <b>CHANNEL_ID</b> is not configured.\n\nYou can now set it directly in the <b>Announcements Control Panel</b> (under /control), or add it to AI Studio Secrets.", { parse_mode: "HTML" });
        return;
      }
      
      const anns = loadAnnouncements();
      const ann = anns.find(a => a.id === annId);
      if (ann) {
        try {
          let messageText = ann.text;
          let photo = ann.photoUrl;
          
          const slotsInfo = {
            grand: formatEmojiNumbers(await generateSlotNumbers(100), 100),
            mini: formatEmojiNumbers(await generateSlotNumbers(50), 50),
            fast: formatEmojiNumbers(await generateSlotNumbers(20), 20)
          };

          messageText = processAnnouncementText(ann, slotsInfo);

          if (ann.type === "high_withdrawal") {
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
              
              if (!ann.text || ann.text === "High Withdrawal placeholder") {
                messageText = `💸 <b>Massive Withdrawal Alert!</b> 💸\n\n` +
                  `🎉 Congratulations to <b>${name}</b> for withdrawing <b>${recentWd[0].amount.toLocaleString()} ETB</b>!\n\n` +
                  `🚀 Play now, win big, and get paid instantly.\n\n` +
                  `<i>Real winners, real money! See the screenshot proof.</i>`;
              } else {
                messageText = ann.text.replace("{name}", name).replace("{amount}", recentWd[0].amount.toLocaleString());
              }
              
              if (!ann.photoUrl) {
                photo = "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=800";
              }
            } else {
              // Only use real data, no mock fallbacks
              return; 
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
          }

          const botUsername = botInfo?.username || "Wheelgames_bot";
          const messageOptions = {
            parse_mode: "HTML" as const,
            reply_markup: {
              inline_keyboard: [
                [{ text: "🎮  ቁጥር ለመያዝ ይጫኑኝ  🚀", url: `https://t.me/${botUsername}?start=play` }]
              ]
            }
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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

    if (data === "ann_toggle_tx_posts") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      promptsConfig.tx_channel_posts_enabled = promptsConfig.tx_channel_posts_enabled !== false ? false : true;
      savePromptsConfig(promptsConfig);
      await bot.answerCallbackQuery(query.id, { text: `Transaction channel posts are now ${promptsConfig.tx_channel_posts_enabled ? 'Enabled 🟢' : 'Disabled 🔴'}` });
      await renderAnnouncementsDashboard(chatId, messageId);
      return;
    }

    if (data === "ann_create_start") {
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      renderManageAffiliate(chatId, messageId);
      return;
    }

    if (data === "affiliate_referrers_report") {
      if (!isAnyAdmin(userId)) {
        try { await bot.answerCallbackQuery(query.id, { text: "❌ Access Denied", show_alert: true }); } catch (e) {}
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      try {
        logBot(`[Affiliate Report] Started by admin ${userId}`);
        const { data: users, error } = await supabase.from('users').select('id, username, first_name, referrer_id');
        if (error) {
          logBot(`[Affiliate Report] Supabase Error: ${error.message}`);
          throw error;
        }
        
        logBot(`[Affiliate Report] Found ${users?.length || 0} users to analyze.`);
        
        const referrerCounts = new Map<string, number>();
        const userDetails = new Map<string, any>();
        const referredUserIds = new Set<string>(); // To prevent double counting
        
        users?.forEach(u => {
          userDetails.set(u.id, u);
          if (u.referrer_id) {
            referrerCounts.set(u.referrer_id, (referrerCounts.get(u.referrer_id) || 0) + 1);
            referredUserIds.add(u.id);
          }
        });

        // 2. Fetch legacy referrals from transactions table
        try {
          const { data: legacyRefs } = await supabase.from('transactions').select('user_id, description').eq('type', 'referral_link');
          if (legacyRefs && legacyRefs.length > 0) {
            logBot(`[Affiliate Report] Found ${legacyRefs.length} legacy referral transactions.`);
            legacyRefs.forEach(ref => {
              if (!referredUserIds.has(ref.user_id)) {
                // Extract referrer ID from description: "Referred by 12345678"
                const match = ref.description.match(/Referred by (\d+)/);
                const refId = match ? match[1] : ref.description.replace('Referred by ', '').trim();
                
                if (refId && refId !== ref.user_id) {
                  referrerCounts.set(refId, (referrerCounts.get(refId) || 0) + 1);
                  referredUserIds.add(ref.user_id);
                }
              }
            });
          }
        } catch (le) {
          logBot(`[Affiliate Report] Warning: Failed to fetch legacy referrals: ${le.message}`);
        }
        
        const reportRows: any[] = [];
        referrerCounts.forEach((count, refId) => {
          const u = userDetails.get(refId);
          reportRows.push({
            ReferrerID: refId,
            Username: u?.username ? `@${u.username}` : 'N/A',
            FirstName: u?.first_name || 'N/A',
            TotalReferred: count
          });
        });
        
        reportRows.sort((a, b) => b.TotalReferred - a.TotalReferred);
        logBot(`[Affiliate Report] Generated ${reportRows.length} report rows.`);
        
        if (reportRows.length === 0) {
          await bot.sendMessage(chatId, "ℹ️ <b>No referrals found.</b>\nNo users have been referred through the system yet.", { parse_mode: "HTML" });
          return;
        }
        
        logBot(`[Affiliate Report] Initializing ExcelJS Workbook...`);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Referrers Report');
        
        worksheet.columns = [
          { header: 'Referrer ID', key: 'ReferrerID', width: 20 },
          { header: 'Username', key: 'Username', width: 25 },
          { header: 'First Name', key: 'FirstName', width: 25 },
          { header: 'Total Referred Users', key: 'TotalReferred', width: 20 }
        ];
        
        worksheet.addRows(reportRows);
        
        // Style header
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE2E8F0' }
        };
        
        logBot(`[Affiliate Report] Writing XLSX to buffer...`);
        const buffer = await workbook.xlsx.writeBuffer() as Buffer;
        logBot(`[Affiliate Report] Buffer created: ${buffer.length} bytes. Sending document...`);
        
        const filename = `Referrers_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
        await bot.sendDocument(chatId, buffer, {
          caption: `📊 <b>Referrers Referee Report (Excel)</b>\n\nTotal Referrers: <b>${reportRows.length}</b>\nGenerated: <code>${new Date().toLocaleString()}</code>`,
          parse_mode: 'HTML'
        }, {
          filename: filename,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        
        logBot(`[Affiliate Report] Successfully sent report to ${userId}`);
      } catch (err: any) {
        logBot(`[Affiliate Report] CRITICAL ERROR: ${err.message}`);
        await bot.sendMessage(chatId, `❌ <b>Report Generation Error</b>\n<code>${err.message}</code>`, { parse_mode: "HTML" });
      }
      return;
    }

    if (data === "affiliate_set_jackpot") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const promptText = `💰 <b>Set Weekly Jackpot Amount</b>\n\n` +
        `Please send the amount (in ETB) you want to distribute for the Weekly Promoter Jackpot.\n\n` +
        `<i>Send a number, or /cancel to abort.</i>`;
        
      userStates.set(String(chatId), { step: 'waiting_for_jackpot_amount' });
      bot.sendMessage(chatId, promptText, { parse_mode: "HTML" });
      return;
    }

    if (data === "affiliate_toggle_auto_broadcast") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      promptsConfig.automated_jackpot_broadcast_enabled = !promptsConfig.automated_jackpot_broadcast_enabled;
      savePromptsConfig(promptsConfig);
      await bot.answerCallbackQuery(query.id, { text: promptsConfig.automated_jackpot_broadcast_enabled ? "🟢 Auto Broadcast Enabled" : "🔴 Auto Broadcast Disabled" });
      renderManageAffiliate(chatId, messageId);
      return;
    }

    if (data === "affiliate_retract_broadcasts") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      renderRetractMenu(chatId, messageId);
      return;
    }

    if (data === "affiliate_retract_flood_jackpot") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id, { text: "🧹 Starting Jackpot Spam Clean-up..." });

      try {
        const statusMsg = await bot.sendMessage(chatId, "⏳ <b>Scanning active player chats for duplicate jackpot alerts...</b>\n\nThis will scan all registered users, find duplicate jackpot alerts, and retract them to clean up their private inbox. This can take up to 30 seconds. Please wait.", { parse_mode: "HTML" });

        const { data: allUsers } = await supabase.from('users').select('id');
        if (!allUsers || allUsers.length === 0) {
          await bot.editMessageText("❌ No registered users found.", { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "HTML" });
          return;
        }

        let totalDeletedCount = 0;
        let processedUsers = 0;
        let activeUsersCount = 0;

        for (let i = 0; i < allUsers.length; i++) {
          const u = allUsers[i];
          if (!u.id || u.id === 'system_jackpot') continue;
          processedUsers++;
          try {
            // Send a silent message to get the current message reference ID
            const tempRef = await bot.sendMessage(u.id, "🧹 <i>Clearing duplicate announcements...</i>", { parse_mode: "HTML", disable_notification: true });
            const refMsgId = tempRef.message_id;

            // Delete the tracking message immediately
            await bot.deleteMessage(u.id, tempRef.message_id).catch(() => {});
            activeUsersCount++;

            // Deep scan up to 100 preceding messages to find and delete the duplicate announcements.
            // This guarantees we hit all 34 duplicates even if other messages were received in between.
            for (let targetId = refMsgId - 1; targetId >= refMsgId - 100; targetId--) {
              // Skip deleting the admin status tracker message or active admin controls panel message if we are in admin's chat
              if (String(u.id) === String(chatId)) {
                if (targetId === statusMsg.message_id || (messageId && targetId === messageId)) {
                  continue;
                }
              }
              try {
                await bot.deleteMessage(u.id, targetId);
                totalDeletedCount++;
              } catch (delErr) {
                // Ignore errors (e.g. message doesn't exist, already deleted, or not sent by bot)
              }
            }
          } catch (userErr) {
            // Ignore individual user chat errors (e.g., bot blocked/not started)
          }

          // Update progress in admin screen every 15 users
          if (processedUsers % 15 === 0 || processedUsers === allUsers.length) {
            await bot.editMessageText(`⏳ <b>Scanning active player chats...</b>\n\n` +
              `• Processed: <code>${processedUsers}/${allUsers.length}</code> registered users\n` +
              `• Active Chats Reached: <code>${activeUsersCount}</code>\n` +
              `• Total Messages Deleted: <code>${totalDeletedCount}</code>`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "HTML" }).catch(() => {});
          }

          // Small sleep to prevent hitting Telegram rate limits
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        const successText = `✅ <b>Spam Clean-up Complete!</b>\n\n` +
          `• Total Registered Users Processed: <code>${processedUsers}</code>\n` +
          `• Active Chats Reached: <code>${activeUsersCount}</code> (users with active bot)\n` +
          `• Duplicate Jackpot Messages Retracted: <b>${totalDeletedCount}</b>\n\n` +
          `<i>Your player chats are now clean and spam-free!</i>`;

        try {
          await bot.editMessageText(successText, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "HTML" });
        } catch (editErr) {
          await bot.sendMessage(chatId, successText, { parse_mode: "HTML" });
        }
      } catch (err: any) {
        logBot(`Error in jackpot flood retract: ${err.message}`);
        bot.sendMessage(chatId, `❌ <b>Spam clean-up failed:</b> ${err.message}`);
      }
      return;
    }

    if (data.startsWith("affiliate_retract_range:")) {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      const rangeVal = parseInt(data.split(":")[1]) || 5;
      await bot.answerCallbackQuery(query.id, { text: `🧹 Retracting last ${rangeVal} messages...` });

      try {
        const statusMsg = await bot.sendMessage(chatId, `⏳ <b>Retracting last ${rangeVal} broadcasts...</b>\n\nThis scans all users and removes the last ${rangeVal} messages sent by the bot. Please wait.`, { parse_mode: "HTML" });

        const { data: allUsers } = await supabase.from('users').select('id');
        if (!allUsers || allUsers.length === 0) {
          await bot.editMessageText("❌ No registered users found.", { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "HTML" });
          return;
        }

        let totalDeletedCount = 0;
        let processedUsers = 0;
        let activeUsersCount = 0;

        for (const u of allUsers) {
          if (!u.id || u.id === 'system_jackpot') continue;
          processedUsers++;
          try {
            // Send a silent message to get the current message reference ID
            const tempRef = await bot.sendMessage(u.id, "🧹 <i>Clearing duplicate announcements...</i>", { parse_mode: "HTML", disable_notification: true });
            const refMsgId = tempRef.message_id;

            // Delete the tracking message immediately
            await bot.deleteMessage(u.id, refMsgId).catch(() => {});
            activeUsersCount++;

            // Delete up to rangeVal preceding messages to find and delete the duplicate announcements.
            // Since they were sent recently, they will have sequential message IDs just before the reference ID.
            for (let targetId = refMsgId - 1; targetId >= refMsgId - rangeVal; targetId--) {
              // Skip deleting the admin status tracker message or active admin controls panel message if we are in admin's chat
              if (String(u.id) === String(chatId)) {
                if (targetId === statusMsg.message_id || (messageId && targetId === messageId)) {
                  continue;
                }
              }
              try {
                await bot.deleteMessage(u.id, targetId);
                totalDeletedCount++;
              } catch (delErr) {
                // Ignore errors (e.g. message doesn't exist, already deleted, or not sent by bot)
              }
            }
          } catch (userErr) {
            // Ignore individual user chat errors (e.g., bot blocked)
          }
        }

        try {
          await bot.editMessageText(`✅ <b>Retraction Complete!</b>\n\nProcessed: <code>${processedUsers}</code> registered users\nActive chats reached: <code>${activeUsersCount}</code>\nTotal messages cleared: <code>${totalDeletedCount}</code>`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "HTML" });
        } catch (editErr) {
          await bot.sendMessage(chatId, `✅ <b>Retraction Complete!</b>\n\nProcessed: <code>${processedUsers}</code> registered users\nActive chats reached: <code>${activeUsersCount}</code>\nTotal messages cleared: <code>${totalDeletedCount}</code>`, { parse_mode: "HTML" });
        }
      } catch (err: any) {
        logBot(`Error in retract: ${err.message}`);
        bot.sendMessage(chatId, `❌ <b>Retraction failed:</b> ${err.message}`);
      }
      return;
    }

    if (data === "affiliate_payout_announce") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);

      try {
        const stats = await fetchLeaderboardData(promptsConfig.weekly_jackpot_amount || 0);
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
          `<i>(Distribution: 50% for 1st, 30% for 2nd, 20% for 3rd place)</i>\n\n` +
          `🏆 <b>Current Top Standings:</b>\n` +
          (stats.leaderboard && stats.leaderboard.length > 0 
            ? stats.leaderboard.slice(0, 3).map((entry, idx) => {
                const displayName = entry.first_name || entry.username || `User_${entry.referrer_id.slice(0, 6)}`;
                const prizeShare = idx === 0 ? 0.50 : idx === 1 ? 0.30 : 0.20;
                const shareAmount = Math.floor(totalJackpot * prizeShare);
                return `🏅 <b>Rank ${idx+1}:</b> ${displayName} — New Referrals: <b>${entry.referral_count || entry.volume}</b> (Est. Reward: <b>${shareAmount.toLocaleString()} ETB</b>)`;
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
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);

      try {
        const stats = await fetchLeaderboardData(promptsConfig.weekly_jackpot_amount || 0);
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

          // 1. Fetch user info
          const { data: userProfile } = await supabase.from('users').select('username, first_name').eq('id', entry.referrer_id).single();
          
          if (userProfile) {
            // Per user request: Referral bonuses should NOT credit the main balance.
            // We insert it as an 'affiliate_commission' so it appears in their Affiliate Dashboard.

            // 2. Insert transaction (Affiliate balance is derived from transactions table, not users.balance)
            await supabase.from('transactions').insert({
              user_id: entry.referrer_id,
              amount: shareAmt,
              type: 'affiliate_commission',
              description: `🏆 Weekly Promoter Jackpot - Rank ${rank} Winner (Week of ${startOfWeekISO.slice(0, 10)})`
            });

            const winnerName = userProfile.first_name || userProfile.username || `User ${entry.referrer_id}`;
            report += `🏅 <b>Rank ${rank}:</b> ${winnerName} (ID: <code>${entry.referrer_id}</code>)\n`;
            report += `  - New Referrals: <b>${entry.referral_count || entry.volume}</b>\n`;
            report += `  - Prize Credited to Affiliate Balance: <b>${shareAmt.toLocaleString()} ETB</b>\n\n`;

            // Send notification to the winner
            bot.sendMessage(entry.referrer_id, 
              `🎉 <b>Congratulations!</b>\n\n` +
              `You achieved <b>Rank ${rank}</b> on the Weekly Promoter Leaderboard with <b>${entry.referral_count || entry.volume}</b> new referrals!\n\n` +
              `🏆 Your prize share of <b>${shareAmt.toLocaleString()} ETB</b> has been credited to your <b>Affiliate Balance</b>.\n\n` +
              `You can request a withdrawal to your bank account from the Affiliate Dashboard in the app! 🎮`, 
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
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Admin Access Only", show_alert: true });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      renderMainControlPanel(chatId, messageId);
      return;
    }

    if (data && data.startsWith("affiliate_review_")) {
        if (!isAnyAdmin(userId)) {
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
          `<b>Requested Amount:</b> ${Math.abs(req.amount)} ETB\n` +
          `<b>Details:</b> ${req.description || 'N/A'}\n\n` +
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
        if (!isAnyAdmin(userId)) return;
        const reqId = data.replace("affiliate_approve_", "");
        const { data: req } = await supabase.from('transactions').select('*').eq('id', reqId).single();
        if (req) {
            // Convert request to an actual withdrawal transaction
            // We change the type to affiliate_withdrawal which effectively "consumes" the bonus balance
            await supabase.from('transactions').update({ 
                type: 'affiliate_withdrawal', 
                description: `Approved Affiliate Payout: ${Math.abs(req.amount)} ETB (Manual Bank Transfer)`, 
                amount: -Math.abs(req.amount) 
            }).eq('id', reqId);
            
            // Per user request: Affiliate payouts should NOT credit the main balance.
            // The admin is expected to pay the user manually via bank transfer.
            bot.sendMessage(req.user_id, `✅ <b>Affiliate Payout Approved!</b>\n\nYour request for ${Math.abs(req.amount)} ETB has been processed and approved. The funds have been sent to your registered bank account manually by admin.`, { parse_mode: "HTML" }).catch(()=>{});
        }
        bot.answerCallbackQuery(query.id, { text: "Approved!" });
        bot.sendMessage(chatId, "Payout marked as Approved. User notified.");
        return;
    }
    
    if (data && data.startsWith("affiliate_reject_")) {
        if (!isAnyAdmin(userId)) return;
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
        if (!isAnyAdmin(userId)) return;
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
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      renderCommandLinks(chatId, messageId);
      return;
    }

    if (data.startsWith("edit_wbtn_click_")) {
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const cmdName = data.replace("ccmd_edit_", "");
      await sendCustomCommandEditMenu(chatId, cmdName, messageId);
      return;
    }

    if (data.startsWith("ccmd_val_")) {
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
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

    if (data === "add_bank_start") {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      userStates.set(userId, { step: 'awaiting_new_bank_id' });
      await bot.sendMessage(chatId, "✍️ <b>Enter a unique ID for the new bank:</b>\n(e.g., <code>ZemenBank</code> - NO spaces allowed)", { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("delete_bank_confirm_")) {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const bankId = data.replace("delete_bank_confirm_", "");
      const text = `⚠️ <b>Are you sure you want to delete bank: ${bankId}?</b>\n\nThis action cannot be undone. All settings for this bank will be removed.`;
      const keyboard = {
        inline_keyboard: [
          [{ text: "✅ Yes, Delete", callback_data: `delete_bank_exec_${bankId}` }],
          [{ text: "❌ No, Cancel", callback_data: `edit_bank_${bankId}` }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("delete_bank_exec_")) {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      const bankId = data.replace("delete_bank_exec_", "");
      if (promptsConfig.banks[bankId]) {
        delete promptsConfig.banks[bankId];
        savePromptsConfig(promptsConfig);
        await bot.answerCallbackQuery(query.id, { text: "✅ Bank Deleted Permanently", show_alert: true });
        
        // Ensure we show the updated menu
        sendManageBanksMenu(chatId, messageId);
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Bank not found" });
        sendManageBanksMenu(chatId, messageId);
      }
      return;
    }

    if (data.startsWith("edit_bank_")) {
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const bankId = data.replace("edit_bank_", "");
      sendBankSettings(chatId, bankId, messageId);
      return;
    }

    if (data.startsWith("edit_key_")) {
      if (!isAnyAdmin(userId)) {
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
      if (!isAnyAdmin(userId)) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const parts = data.replace("edit_bankval_", "").split("_");
      const bankId = parts[0];
      const prop = parts.slice(1).join("_"); // 'name' | 'account' | 'owner_name'
      const bank: BankConfig = promptsConfig.banks[bankId] || { name: bankId, account: "", owner_name: "", withdraw_prompt: "" };
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

    if (data === "reload_config_silent") {
      if (!isAnyAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Access Denied", show_alert: true });
        return;
      }
      promptsConfig = loadPromptsConfig();
      await bot.answerCallbackQuery(query.id, { text: "✅ Configuration Refreshed!" });
      sendManageBanksMenu(chatId, messageId);
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
      if (!adminChatIds.has(clickerId) && !isAnyAdmin(clickerId)) {
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
      // Auto-initialize state if missing to prevent unresponsive buttons
      if (!broadcastStates.has(clickerId)) {
        broadcastStates.set(clickerId, { step: 'choose_target', target: 'all', template: 'none' });
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
        const playerButtons = buildCampaignReplyMarkup(composer, globalAppUrl);
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
      if (isAnyAdmin(clickerId)) {
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
      if (isAnyAdmin(clickerId)) {
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
      if (isAnyAdmin(clickerId)) {
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
      if (isAnyAdmin(clickerId)) {
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
      if (isAnyAdmin(clickerId)) {
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
      if (isAnyAdmin(clickerId)) {
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
      if (isAnyAdmin(clickerId)) {
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
      const bankConfig = promptsConfig.banks[bank] || { name: bank, account: "N/A", owner_name: "N/A" };
      const supportTxt = promptsConfig.support_text;

      let paymentInstructions = promptsConfig.deposit_payment_instructions_msg || 
        `1. ከታች ባለው የ*{bank_name}* አካውንት *{amount} ብር* ያስገቡ\n` +
        `    *Account/Phone:* \`{account}\`\n` +
        `    *Name:* \`{owner_name}\`\n\n` +
        `2. የከፈሉበትን አጭር የጹሁፍ መልዕክት(message) copy በማድረግ እዚ ላይ Past አድረገው ያስገቡና ይላኩት👇👇👇\n\n` +
        `_(Please copy and paste the SMS transaction receipt text as response)_`;

      paymentInstructions = paymentInstructions
        .replace(/{bank_name}/g, bankConfig.name || bank)
        .replace(/{amount}/g, amount.toLocaleString())
        .replace(/{account}/g, bankConfig.account)
        .replace(/{owner_name}/g, bankConfig.owner_name)
        .replace(/{support_text}/g, supportTxt);

      // Prepend support text if it's not explicitly in the instructions
      if (supportTxt && !paymentInstructions.includes(supportTxt)) {
        paymentInstructions = `${supportTxt}\n\n${paymentInstructions}`;
      }

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

      const bankConfig = promptsConfig.banks[bank];
      if (bankConfig && bankConfig.withdraw_prompt) {
        return bot.sendMessage(chatId, bankConfig.withdraw_prompt, { parse_mode: "Markdown" });
      }

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
        bot.answerCallbackQuery(query.id, { text: "❌ Request not found or already processed." }).catch(() => {});
        return;
      }

      // Instant feedback to admin
      bot.answerCallbackQuery(query.id, { text: "⏳ Processing Deposit Approval..." }).catch(() => {});

      try {
        // Update user balance and insert transaction record atomically through txManager
        const result = await txManager.modifyBalance(
          request.userId,
          request.amount,
          'reward',
          `Deposit Approved (Ref: ${requestId})`
        );

        if (!result.success) {
          bot.sendMessage(chatId, `❌ Failed to approve deposit for user ${request.userId}: ${result.error || 'Database error'}`);
          return;
        }

        const newBalance = result.newBalance;
        // Invalidate local cache for this user
        userBalanceCache.delete(request.userId);

        // Unique verification Ref
        const refCode = "DEP_" + generateRef(10);
        const escapedUsername = escapeHTML(request.username);

        // Send confirmation to User
        const successMsg = (promptsConfig.deposit_approved_msg || "✅ *Your deposit of {amount} ETB is confirmed.*\n🧾 *Ref:* `{ref}`")
          .replace(/{amount}/g, request.amount.toLocaleString())
          .replace(/{ref}/g, refCode);
        await bot.sendMessage(request.chatId, successMsg, { parse_mode: "Markdown" });
        await postToChannel(`✅ <b>New Deposit Confirmed!</b>\n\n👤 <b>User:</b> @${escapedUsername}\n💰 <b>Amount:</b> <code>${request.amount.toLocaleString()} ETB</code>\n🧾 <b>Ref:</b> <code>${refCode}</code>`);

        // Update Client App UI Instantly via socket
        io.emit('balanceUpdated', { userId: request.userId, balance: newBalance });

        // Delete from pending store and sync
        pendingRequests.delete(requestId);
        savePendingRequestsToDB().catch(e => logBot(`Error saving pending requests: ${e.message}`));

        // Update Admin inline message
        const rawAdminUsername = query.from.username || query.from.first_name || "Admin";
        const adminUsername = escapeHTML(rawAdminUsername);
        const escapedFullName = escapeHTML(request.fullName);
        const escapedBank = escapeHTML(request.bank);
        const escapedReceipt = escapeHTML(request.receiptText || "");

        const updatedAdminMsg = `📥 <b>DEPOSIT APPROVED (Ref: ${refCode})</b>\n\n` +
          `👤 <b>User:</b> @${escapedUsername} (${escapedFullName})\n` +
          `🆔 <b>User ID:</b> <code>${request.userId}</code>\n` +
          `💰 <b>Amount:</b> <b>${request.amount.toLocaleString()} ETB</b>\n` +
          `🏦 <b>Bank:</b> <b>${escapedBank}</b>\n` +
          `📝 <b>Pasted Receipt SMS:</b>\n<blockquote>${escapedReceipt}</blockquote>\n\n` +
          `✅ <b>Approved by admin:</b> @${adminUsername}`;

        if (messageId) {
          bot.editMessageText(updatedAdminMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML"
          }).catch(e => console.error("Admin msg update failed:", e));
        }

      } catch (err) {
        console.error("Failed to approve deposit:", err);
        bot.answerCallbackQuery(query.id, { text: "⚠️ Error processing deposit." }).catch(() => {});
      }
      return;
    }

    // --- ADMIN ACTION: DECLINE DEPOSIT ---
    if (data.startsWith("decline_dep_")) {
      const requestId = data.replace("decline_dep_", "");
      const request = pendingRequests.get(requestId);

      if (!request) {
        bot.answerCallbackQuery(query.id, { text: "❌ Request not found or already processed." }).catch(() => {});
        return;
      }

      try {
        // Send decline notification to User
        const declineMsg = (promptsConfig.deposit_declined_msg || "❌ *Your deposit of {amount} ETB is Declined.*")
          .replace(/{amount}/g, request.amount.toLocaleString());
        await bot.sendMessage(request.chatId, declineMsg, { parse_mode: "Markdown" });

        // Delete from pending store
        pendingRequests.delete(requestId);
        savePendingRequestsToDB().catch(e => logBot(`Error saving pending requests: ${e.message}`));

        // Acknowledge Admin click
        bot.answerCallbackQuery(query.id, { text: "❌ Deposit Declined" }).catch(() => {});

        // Update Admin inline message
        const rawAdminUsername = query.from.username || query.from.first_name || "Admin";
        const adminUsername = escapeHTML(rawAdminUsername);
        const escapedUsername = escapeHTML(request.username);
        const escapedFullName = escapeHTML(request.fullName);
        const escapedBank = escapeHTML(request.bank);
        const escapedReceipt = escapeHTML(request.receiptText || "");

        const updatedAdminMsg = `📥 <b>DEPOSIT DECLINED</b>\n\n` +
          `👤 <b>User:</b> @${escapedUsername} (${escapedFullName})\n` +
          `🆔 <b>User ID:</b> <code>${request.userId}</code>\n` +
          `💰 <b>Amount:</b> <b>${request.amount.toLocaleString()} ETB</b>\n` +
          `🏦 <b>Bank:</b> <b>${escapedBank}</b>\n` +
          `📝 <b>Pasted Receipt SMS:</b>\n<blockquote>${escapedReceipt}</blockquote>\n\n` +
          `❌ <b>Declined by admin:</b> @${adminUsername}`;

        if (messageId) {
          bot.editMessageText(updatedAdminMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML"
          }).catch(e => console.error("Admin msg update failed:", e));
        }

      } catch (err) {
        console.error("Failed to decline deposit:", err);
        bot.answerCallbackQuery(query.id, { text: "⚠️ Error processing decline." }).catch(() => {});
      }
      return;
    }

    // --- ADMIN ACTION: APPROVE WITHDRAWAL ---
    if (data.startsWith("approve_wd_")) {
      const requestId = data.replace("approve_wd_", "");
      const request = pendingRequests.get(requestId);

      if (!request) {
        bot.answerCallbackQuery(query.id, { text: "❌ Request not found or already processed." }).catch(() => {});
        return;
      }

      // Instant feedback to admin
      bot.answerCallbackQuery(query.id, { text: "⏳ Processing Withdrawal Approval..." }).catch(() => {});

      try {
        // Funds were already deducted and logged when they submitted.
        // Invalidate local cache for this user
        userBalanceCache.delete(request.userId);
        // We finalize the withdrawal by deleting from pending and notifying.

        // Unique Verification Ref
        const refCode = "WD_" + generateRef(10);
        const escapedUsername = escapeHTML(request.username);

        // Send confirmation to User
        const successMsg = (promptsConfig.withdraw_approved_msg || "✅ *Your withdrawal of {amount} ETB is confirmed.*\n🧾 *Ref:* `{ref}`")
          .replace(/{amount}/g, request.amount.toLocaleString())
          .replace(/{ref}/g, refCode);
        await bot.sendMessage(request.chatId, successMsg, { parse_mode: "Markdown" });
        await postToChannel(`📤 <b>New Withdrawal Processed!</b>\n\n👤 <b>User:</b> @${escapedUsername}\n💰 <b>Amount:</b> <code>${request.amount.toLocaleString()} ETB</code>\n🧾 <b>Ref:</b> <code>${refCode}</code>`);

        // Delete from pending store and sync
        pendingRequests.delete(requestId);
        savePendingRequestsToDB().catch(e => logBot(`Error saving pending requests: ${e.message}`));

        bot.answerCallbackQuery(query.id, { text: "✅ Withdrawal Approved!" }).catch(() => {});

        // Update Admin inline message
        const rawAdminUsername = query.from.username || query.from.first_name || "Admin";
        const adminUsername = escapeHTML(rawAdminUsername);
        const escapedFullName = escapeHTML(request.fullName);
        const escapedBank = escapeHTML(request.bank);
        const escapedAccount = escapeHTML(request.account || "");

        const updatedAdminMsg = `📤 <b>WITHDRAWAL APPROVED (Ref: ${refCode})</b>\n\n` +
          `👤 <b>User:</b> @${escapedUsername} (${escapedFullName})\n` +
          `🆔 <b>User ID:</b> <code>${request.userId}</code>\n` +
          `💰 <b>Amount:</b> <b>${request.amount.toLocaleString()} ETB</b>\n` +
          `🏦 <b>Bank:</b> <b>${escapedBank}</b>\n` +
          `💳 <b>Account/Phone:</b> <code>${escapedAccount}</code>\n\n` +
          `✅ <b>Approved by admin:</b> @${adminUsername}`;

        if (messageId) {
          bot.editMessageText(updatedAdminMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML"
          }).catch(e => console.error("Admin msg update failed:", e));
        }

      } catch (err) {
        console.error("Failed to approve withdrawal:", err);
        bot.answerCallbackQuery(query.id, { text: "⚠️ Error processing approval." }).catch(() => {});
      }
      return;
    }

    // --- ADMIN ACTION: DECLINE WITHDRAWAL ---
    if (data.startsWith("decline_wd_")) {
      const requestId = data.replace("decline_wd_", "");
      const request = pendingRequests.get(requestId);

      if (!request) {
        bot.answerCallbackQuery(query.id, { text: "❌ Request not found or already processed." }).catch(() => {});
        return;
      }

      try {
        // Refund back to user's balance because it was deducted upon request using txManager
        const result = await txManager.modifyBalance(
          request.userId,
          request.amount,
          'reward',
          `Withdrawal Declined & Refunded (Ref: ${requestId})`
        );

        if (!result.success) {
          bot.answerCallbackQuery(query.id, { text: `❌ Refund failed: ${result.error || 'Database error'}` }).catch(() => {});
          return;
        }

        const refundedBalance = result.newBalance;

        // Send detailed Decline & Refund message to user
        const declineMsg = (promptsConfig.withdraw_declined_msg || "❌ *Withdrawal Declined*\n\nYour withdrawal of *{amount} Birr* was declined and refunded.")
          .replace(/{amount}/g, request.amount.toLocaleString())
          .replace(/{balance}/g, refundedBalance.toLocaleString());
        await bot.sendMessage(request.chatId, declineMsg, { parse_mode: "Markdown" });

        // Update Client App UI instantly via socket
        io.emit('balanceUpdated', { userId: request.userId, balance: refundedBalance });

        // Delete from pending store and sync
        pendingRequests.delete(requestId);
        savePendingRequestsToDB().catch(e => logBot(`Error saving pending requests: ${e.message}`));

        bot.answerCallbackQuery(query.id, { text: "❌ Withdrawal Declined" }).catch(() => {});

        // Update Admin inline message
        const rawAdminUsername = query.from.username || query.from.first_name || "Admin";
        const adminUsername = escapeHTML(rawAdminUsername);
        const escapedUsername = escapeHTML(request.username);
        const escapedFullName = escapeHTML(request.fullName);
        const escapedBank = escapeHTML(request.bank);
        const escapedAccount = escapeHTML(request.account || "");

        const updatedAdminMsg = `📤 <b>WITHDRAWAL DECLINED & REFUNDED</b>\n\n` +
          `👤 <b>User:</b> @${escapedUsername} (${escapedFullName})\n` +
          `🆔 <b>User ID:</b> <code>${request.userId}</code>\n` +
          `💰 <b>Amount:</b> <b>${request.amount.toLocaleString()} ETB</b>\n` +
          `🏦 <b>Bank:</b> <b>${escapedBank}</b>\n` +
          `💳 <b>Account/Phone:</b> <code>${escapedAccount}</code>\n\n` +
          `❌ <b>Declined by admin:</b> @${adminUsername}`;

        if (messageId) {
          bot.editMessageText(updatedAdminMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML"
          }).catch(e => console.error("Admin msg update failed:", e));
        }

      } catch (err) {
        console.error("Failed to decline and refund withdrawal:", err);
        bot.answerCallbackQuery(query.id, { text: "⚠️ Error processing withdrawal refund." }).catch(() => {});
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
  
  // Start automated weekly promoter jackpot scheduler
  startAutomatedJackpotScheduler(bot);

  return botInfo?.username || null;
}

export function getBotUsername() {
  return botInfo?.username || null;
}

const lastFlowTrigger = new Map<string, number>();
const processingUsers = new Set<string>();

export async function triggerBotFlow(userId: string, flowType: 'deposit' | 'withdraw'): Promise<boolean> {
  logBot(`triggerBotFlow called for userId=${userId}, flowType=${flowType}`);
  const chatId = parseInt(userId, 10);
  if (isNaN(chatId)) {
    logBot(`Invalid userId for triggerBotFlow: ${userId}`);
    return false;
  }

  // Anti-duplication: Prevent triggering the same flow twice within 10 seconds
  const now = Date.now();
  const lastTime = lastFlowTrigger.get(`${userId}_${flowType}`) || 0;
  if (now - lastTime < 10000) {
    logBot(`Skipping duplicate flow trigger for userId=${userId}, flowType=${flowType} (last triggered ${now - lastTime}ms ago)`);
    return true; // Return true as if handled to avoid redundant redirects
  }
  lastFlowTrigger.set(`${userId}_${flowType}`, now);

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
    const jsonStr = JSON.stringify(config, null, 2);
    fs.writeFileSync(AUTO_CAMPAIGN_FILE, jsonStr, "utf-8");
    saveAutoCampaignToSupabase(config).catch(err => logBot(`[ERROR] Supabase campaign sync failed: ${err}`));
    logBot("[CONFIG] Auto Campaign saved and sync started.");
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

  const announcedWeeks = new Set<string>();

  // Ensure system_jackpot user row exists to prevent foreign key constraint errors when recording announcements
  if (supabase) {
    supabase.from('users').upsert({
      id: 'system_jackpot',
      username: 'system_jackpot',
      first_name: 'System',
      last_name: 'Jackpot',
      balance: 0
    }, { onConflict: 'id' }).then(({ error }) => {
      if (error) {
        logBot(`[AutomatedJackpot] Error initializing system_jackpot user row: ${error.message}`);
      } else {
        logBot(`[AutomatedJackpot] system_jackpot user initialized in users table.`);
      }
    });
  }

  setInterval(async () => {
    try {
      if (!supabase) return;

      // Respect the administrator switch to disable automatic weekly jackpot announcements
      if (promptsConfig.automated_jackpot_broadcast_enabled === false) {
        return;
      }

      const now = Date.now();
      const startOfWeek = getStartOfWeekUTC();
      const startOfWeekISO = startOfWeek.toISOString();

      if (announcedWeeks.has(startOfWeekISO)) {
        return;
      }

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

        if (annList && annList.length > 0) {
          announcedWeeks.add(startOfWeekISO);
          return;
        }

        if (!annList || annList.length === 0) {
          logBot(`[AutomatedJackpot] Time to announce jackpot for week starting ${startOfWeekISO}. Running...`);
          
          announcedWeeks.add(startOfWeekISO);
          
          const stats = await fetchLeaderboardData(promptsConfig.weekly_jackpot_amount || 0);
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
            `<i>(Distribution: 50% for 1st, 30% for 2nd, 20% for 3rd place)</i>\n\n` +
            `🏆 <b>Current Top Standings:</b>\n` +
            (stats.leaderboard && stats.leaderboard.length > 0 
              ? stats.leaderboard.slice(0, 3).map((entry, idx) => {
                  const displayName = entry.first_name || entry.username || `User_${entry.referrer_id.slice(0, 6)}`;
                  const prizeShare = idx === 0 ? 0.50 : idx === 1 ? 0.30 : 0.20;
                  const shareAmount = Math.floor(totalJackpot * prizeShare);
                  return `🏅 <b>Rank ${idx+1}:</b> ${displayName} — New Referrals: <b>${entry.referral_count || entry.volume}</b> (Est. Reward: <b>${shareAmount.toLocaleString()} ETB</b>)`;
                }).join('\n')
              : `<i>No qualified referrers recorded yet this week.</i>`) +
            `\n\n📢 Promote your referral link <code>/referral</code> now to secure or upgrade your ranking before distribution! 🎮`;

          // Broadcast to all users
          const { data: allUsers } = await supabase.from('users').select('id');
          let successCount = 0;
          const sentMessagesList: CampaignMessage[] = [];
          if (allUsers) {
            for (const u of allUsers) {
              if (!u.id || u.id === 'system_jackpot') continue;
              try {
                const sentMsg = await bot.sendMessage(u.id, msgText, { parse_mode: "HTML" });
                sentMessagesList.push({
                  chat_id: u.id,
                  message_id: sentMsg.message_id
                });
                successCount++;
              } catch (broadcastErr) {
                // Ignore blocked/deleted chats
              }
            }
          }
          logBot(`[AutomatedJackpot] Successfully broadcasted weekly jackpot announcement to ${successCount} users.`);

          // Save successfully sent message IDs to our persistent local campaign tracker
          if (sentMessagesList.length > 0) {
            saveCampaign({
              id: `auto_jackpot_${Date.now()}`,
              timestamp: Date.now(),
              type: 'Automated Jackpot Alert',
              target: 'All Users',
              template: 'jackpot_announcement',
              textSnippet: `🏆 Auto Jackpot Alert: ${totalJackpot.toLocaleString()} ETB`,
              sent_messages: sentMessagesList
            });
          }
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
