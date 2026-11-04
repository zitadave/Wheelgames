import { getDeterministicCard } from "../utils/bingo.js";
import { supabase } from "./supabase.js";
import { logBot } from "./logger.js";

export interface BingoBotSettings {
  enabled: boolean;
  botCount: number; // default 235 (dynamic 200-250 range)
  winProbability: number; // default 98.5 (98.5% AI win rate, ~1 human win per 65-75 games)
  minWinBall: number; // 15
  maxWinBall: number; // 33
  maleRatio: number; // 90 (90%)
  twoCardsRatio: number; // 55 (at least 50% select 2 cards)
}

export const DEFAULT_BINGO_BOT_SETTINGS: BingoBotSettings = {
  enabled: true,
  botCount: 235,
  winProbability: 98.5,
  minWinBall: 15,
  maxWinBall: 33,
  maleRatio: 90,
  twoCardsRatio: 55, // >= 50%
};

let cachedBotSettings: BingoBotSettings = { ...DEFAULT_BINGO_BOT_SETTINGS };
let isSettingsLoaded = false;

// Rich & diverse Ethiopian Male names, Amharic fidels, funny phrases, and mixed styles
export const MALE_NAMES = [
  // --- Pure Amharic Fidels (የተለያዩ የአማርኛ ስሞች) ---
  "ዳዊት", "ዮሐንስ", "ሰለሞን", "ናትናኤል", "ቢንያም", "ሮቤል", "ኤርምያስ", "ካሌብ", "በረከት", "እዮብ",
  "ቴዎድሮስ", "ሄኖክ", "ሱራፌል", "ብሩክ", "አማኑኤል", "ያሬድ", "ኪዱስ", "አቤል", "ናሆም", "ተመስገን",
  "ዘላለም", "ግርማ", "ሃይሌ", "ሳሙኤል", "ደስታ", "ሙሉጌታ", "ፍቅሩ", "ተስፋዬ", "አሸናፊ", "ዳንኤል",
  "ብስራት", "ታደሰ", "ወርቁ", "ያዕቆብ", "ነቢዩ", "ኤልያስ", "ታምራት", "አበበ", "ጌታቸው", "ሲሳይ",
  "መኮንን", "አዲሱ", "አንተነህ", "ፋሲካ", "ቸርነት", "በለጠ", "ሰናይ", "ፍጹም", "መለስ", "ማርቆስ",
  "ሀብታሙ", "ዮናስ", "መስፍን", "ዳኛቸው", "እንዳልካቸው", "በሻህ", "ዘውዱ", "ፍስሃ", "ሚሊዮን", "ልዑል",
  "ታሪኩ", "ጌትነት", "ወንድወሰን", "መላኩ", "አክሊሉ", "ደግሰው", "ገብሬ", "ንጉሤ", "ይድነቃቸው", "ጋሻው",
  "ደምሴ", "እሸቱ", "ተሾመ", "ወንድሙ", "አለሙ", "ፈቃዱ", "ብርሃኑ", "ጥላሁን", "ስዩም", "ካሳዬ",
  "ነጋሽ", "በዲሉ", "ይልማ", "ታዬ", "ሞገስ", "ክንፉ", "ዳጊ", "ሚኪ", "ሳሚ", "ቴዲ",
  "ዮኒ", "ናቲ", "ቢኒ", "ሮቢ", "እዩ", "ባሪ", "አሙ", "ቢሮ", "ዞላ", "ተሙ", "ጌቾ",

  // --- Amharic Place, Neighborhood & Character Nicknames ---
  "ዮኒ_ሸገር", "ሳሚ_ቦሌ", "ሚኪ_ጎንደር", "ዳዊት_አራዳ", "አቤ_መገናኛ", "በረከት_ፒያሳ", "ቴዲ_ላፍቶ",
  "ብሩክ_ሳሪስ", "ናቲ_ገርጂ", "ሮቤል_ቃሊቲ", "ሄኖክ_ኮተቤ", "ካሌብ_ቄራ", "ሱራፌል_አያት", "ያሬድ_ጦርሀይሎች",
  "አማን_ባህርዳር", "ተሙ_ሀዋሳ", "ዘላለም_ደብረዘይት", "ጌቾ_ናዝሬት", "ካሳ_ላሊበላ", "ዳዊት_ወሎ", "ኤርሚ_ጅማ", "ቢኒ_ደሴ",
  "ሸገር_አራዳ", "ጎንደር_ጀግና", "ላፍቶ_ቦይ", "ቦሌ_ባለሀብት", "መገናኛ_ፈጣን", "መርካቶ_ነጋዴ", "አዲስ_ከተማ",

  // --- Funny & Humorous Ethiopian Names (አስቂኝና ቀልድ ስሞች) ---
  "ሽንብራ_አሳ", "እንጀራ_በወጥ", "ስጋ_በቃሪያ", "ቦሌ_ፓስታ", "ቆሎ_ቆርጣሚ", "ሻይ_በዝንጅብል", "ቡና_ጠጪው",
  "ጫት_አላውቅም", "አያ_ጅቦ", "ተላላኪው", "ባንክ_ሰባሪ", "ኪስ_አውላቂ", "የኪስ_አዳኝ", "በህልሜ_አየሁት",
  "የኔ_ቢጤ", "ድሃ_ነኝ_አትብሉኝ", "የደራሽ_ጠንቋይ", "ቢንጎ_ወዳጅ", "ተረፈ_ኪራይ", "የቀበሌ_ሊቀመንበር",
  "ዶላር_አዳኝ", "ታክሲ_ጠባቂ", "ኮንትራት_ነኝ", "ያለኝ_አንድ_ካርድ", "መላጣው", "አቦ_ሸማኔ", "ጀለስ",
  "አራዳ_ጎረምሳ", "ገንዘብ_ፈላጊ", "ባለ_ሚስጥር", "የሰው_ሰው", "አባይ_ማዶ", "ጀግናው_ካሳ", "ድንቄም_አሸናፊ",
  "የእናቱ_ልጅ", "ባጃጅ_ነጂው", "አስመሳዩ", "ቁርስ_የለኝም", "የእድር_ፀሀፊ", "የቤት_አከራይ", "የሰፈር_አውራ",
  "ካርቴላ_ሌባ", "ዛሬስ_አሸንፋለሁ", "ኪሴ_ባዶ_ነው", "እዳ_አለብኝ", "የደላላው_ልጅ", "እንባ_አባሽ", "አረ_ባካችሁ",
  "የሻይ_ቤት_ወሬኛ", "አስኳላ_ያላየው", "ታክሲ_ረዳት", "ጥቁር_እንግዳ", "ባለ_2_ካርቴላ", "እድሌን_ልሞክር",
  "ስልክ_ቻርጅ_አድርጌ", "የገንዘብ_ማግኔት", "ደራሽ_ዘራፊ", "ካርድ_አከፋፋይ", "አንገት_ሰባሪ", "የሰላም_ሰው",
  "ተስፋ_አልቆርጥም", "እኔም_አላፈረም", "ጠላ_ጠጪ", "በርበሬ_ሻጭ", "ካቲካላ_ወዳጅ", "አይቀርልኝም", "ኪሴ_ሞላ",
  "ሳንቲም_አልባ", "የቦሌ_ጨዋ", "የሸገር_ኮረዳ", "ባለ_ታክሲ", "የደራሽ_አምሮት", "ብሬን_መልሱ", "ቆይ_አሳያችኋለሁ",

  // --- Mixed Amharic + Latin / Gaming / Casual Handles ---
  "ቢንጎ_King", "ብር_Lover", "ደራሽ_Hunter", "አሸናፊ_Pro", "ዘመናይ_Boy", "አራዳ_Player",
  "Boss_ጋሼ", "Ethio_ጀግና", "Lucky_ዕድለኛ", "ጎበዙ_Ace", "ፈጣኑ_Flash", "አንበሳ_Lion",
  "ሸገር_VIP", "ደራሽ_Master", "Abebe_አበበ", "Miki_ሚኪ", "Teddy_ቴዲ", "Yoni_ዮኒ",
  "Sami_ሳሚ", "Dagi_ዳጊ", "Bini_ቢኒ", "Robel_ሮቤል", "Kidus_ኪዱስ", "Abel_አቤል",

  // --- Realistic Telegram Handles & Latin Casings ---
  "yoni_gondar", "miki.addis", "dawit_77", "sami_boy", "dagi_sheger", "sol_ethio",
  "tedros_b", "bini.pro", "heno_k", "robel_99", "kassahun.e", "elias_finfine",
  "natty_100k", "beki_winner", "surafel_x", "yonas.kelem", "kassahun_99", "aman_d",
  "kidus.m", "yared_sound", "abel_shewa", "nahom_star", "temu_king", "zelalem_eth",
  "dany_fast", "bisrat_gold", "tad_k", "worku_b", "tamirat_7", "getch_top",
  "IAM_DAWIT", "KING_ROBEL", "NATTY_VIP", "BEREKET_ETH", "YONAS_WIN", "ERMI_TOP", "KALEB_7",
  "biniyam_88", "eyob_21", "temesgen_a", "mulugeta_w", "ashenafi_t", "addisu_k", "anteneh_m"
];

// Rich & diverse Ethiopian Female names, Amharic fidels, funny & mixed styles
export const FEMALE_NAMES = [
  // --- Pure Amharic Fidels ---
  "ሰላም", "ቤተልሔም", "ሃና", "ትዕግስት", "ሔለን", "ራሔል", "ሊዲያ", "ሜሮን", "ጽዮን", "ሳሮን",
  "ሩት", "ኤደን", "ማርታ", "ህይወት", "ማህሌት", "ሶሲና", "ፍቅርተ", "ገነት", "ቅድስት", "ሄሊና",
  "ሄርሜላ", "ብሌን", "መሰረት", "ቃልኪዳን", "ሀውለት", "ፍሬህይወት", "ቤቴ", "ሰብለ", "ፋንቱ", "አለም",
  "ሰናይት", "ትርሲት", "ዘነበች", "ሙና", "የሺ",

  // --- Amharic Nicknames & Place Names ---
  "ሰላም_ፍቅር", "ቤቲ_አዲስ", "ሃና_ሸገር", "ትዕግስትዬ", "ሔለን_ቦሌ", "ራሔልዬ", "ሊዲያ_ውብ",
  "ሜሮን_ፒያሳ", "ጽዮኔ", "ሳሮን_ውብ", "ኤዱ_አራዳ", "ማርቱዬ", "ህይወቴ", "ማሂ_ቦሌ", "ሶሲ_ፍቅር",
  "ገኒ_አዲስ", "ኪዱ_ሸገር", "ብሌንዬ", "መሲ_ቦሌ", "ቃሌ_ፍቅር", "ሰብሊ_አራዳ", "ትርሲቴ",

  // --- Funny & Humorous Female Handles ---
  "የቡና_ሱስ", "ሽንኩርት_በስሱ", "የእንጀራ_እናት", "ቺኮች_አሸናፊ", "የአራዳ_ቆንጆ", "ሻይ_በወተት",
  "ድል_ለሴቶች", "እኔም_ካርድ_አለኝ", "ባለቀሚሷ", "የቦሌዋ_ቺክ", "ደራሽ_ጠራጊቷ", "ሰርፕራይዝ",

  // --- Mixed & Latin Handles ---
  "selam_queen", "betty.addis", "hanna_love", "tigi_k", "helen_g", "rahel_b",
  "lidiya.s", "meron_t", "tsion_m", "saron_b", "ruth_a", "eden_t", "marta_g",
  "hiwot_k", "mahlet_b", "blen_addis", "kalkidan_love", "eden_queen", "selam_ethio"
];

export async function loadBingoBotSettings(): Promise<BingoBotSettings> {
  if (isSettingsLoaded) return cachedBotSettings;
  try {
    if (!supabase) return cachedBotSettings;
    const { data, error } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "bingo_bot_settings")
      .single();

    if (!error && data && data.value) {
      const parsed = JSON.parse(data.value);
      cachedBotSettings = { ...DEFAULT_BINGO_BOT_SETTINGS, ...parsed };
      if (cachedBotSettings.botCount < 180) {
        cachedBotSettings.botCount = 235;
      }
      if (cachedBotSettings.winProbability < 95) {
        cachedBotSettings.winProbability = 98.5;
      }
      isSettingsLoaded = true;
    }
  } catch (e: any) {
    logBot(`[BingoBotManager] Error loading bot settings: ${e.message}`);
  }
  return cachedBotSettings;
}

export function getBingoBotSettingsSync(): BingoBotSettings {
  return cachedBotSettings;
}

export async function updateBingoBotSettings(newSettings: Partial<BingoBotSettings>): Promise<boolean> {
  try {
    cachedBotSettings = { ...cachedBotSettings, ...newSettings };
    if (!supabase) return false;
    const { error } = await supabase
      .from("bot_config")
      .upsert({
        key: "bingo_bot_settings",
        value: JSON.stringify(cachedBotSettings),
        updated_at: new Date().toISOString()
      });
    return !error;
  } catch (e: any) {
    logBot(`[BingoBotManager] Error saving bot settings: ${e.message}`);
    return false;
  }
}

export interface GeneratedBot {
  userId: string;
  username: string;
  cards: number[];
  photoUrl?: string;
}

/**
 * Calculates dynamic bot target count for the current game round (200 - 250).
 */
export function calculateDynamicBotCount(configuredCount: number): number {
  if (configuredCount >= 180) {
    // Dynamically and realistically range between 200 and 250 players each game
    return Math.floor(Math.random() * (250 - 200 + 1)) + 200;
  }
  if (configuredCount > 0) {
    // Small realistic variance around custom count
    const min = Math.max(10, Math.floor(configuredCount * 0.9));
    const max = Math.min(260, Math.ceil(configuredCount * 1.1));
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  return 0;
}

/**
 * Generates an active pool of realistic Ethiopian AI players picking available cards.
 * Ensures at least 50% select 2 cards, and preserves at least 130 open cards for human players.
 */
export function generateBotsForRoom(
  targetCount: number,
  maleRatio: number,
  occupiedCards: Set<number>,
  existingBotsCount = 0,
  twoCardsRatio = 55
): GeneratedBot[] {
  const bots: GeneratedBot[] = [];
  const availableCardIds: number[] = [];
  
  for (let c = 1; c <= 500; c++) {
    if (!occupiedCards.has(c)) {
      availableCardIds.push(c);
    }
  }

  // Shuffle available cards to pick randomly
  for (let i = availableCardIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [availableCardIds[i], availableCardIds[j]] = [availableCardIds[j], availableCardIds[i]];
  }

  // Cap maximum cards taken by bots to 370 so at least 130 cards (out of 500) remain open for real human players
  const maxBotCards = Math.min(availableCardIds.length, 370);
  const eligibleCardIds = availableCardIds.slice(0, maxBotCards);

  const shuffledMale = [...MALE_NAMES].sort(() => Math.random() - 0.5);
  const shuffledFemale = [...FEMALE_NAMES].sort(() => Math.random() - 0.5);

  let maleIdx = 0;
  let femaleIdx = 0;
  let cardPointer = 0;
  const usedUsernames = new Set<string>();

  for (let i = 0; i < targetCount; i++) {
    if (cardPointer >= eligibleCardIds.length) break;

    const isMale = Math.random() * 100 < maleRatio;
    let chosenName: string;
    if (isMale) {
      chosenName = shuffledMale[maleIdx % shuffledMale.length];
      maleIdx++;
    } else {
      chosenName = shuffledFemale[femaleIdx % shuffledFemale.length];
      femaleIdx++;
    }

    let finalUsername = chosenName;
    if (usedUsernames.has(finalUsername)) {
      const tag = Math.floor(Math.random() * 90 + 10);
      finalUsername = `${chosenName}_${tag}`;
    }
    usedUsernames.add(finalUsername);

    // At least 50% select 2 cards (default 55%)
    const wantsTwo = (Math.random() * 100 < twoCardsRatio) && (cardPointer + 1 < eligibleCardIds.length);
    const botCards: number[] = [];
    botCards.push(eligibleCardIds[cardPointer++]);
    if (wantsTwo) {
      botCards.push(eligibleCardIds[cardPointer++]);
    }

    const botId = `bot_${existingBotsCount + i + 1}_${Math.floor(Math.random() * 1000)}`;

    bots.push({
      userId: botId,
      username: finalUsername,
      cards: botCards,
    });
  }

  return bots;
}

/**
 * All 13 winning patterns on a 5x5 Bingo Card (0-indexed [col, row])
 * Note: [2,2] is the FREE space.
 */
function getAllPatterns(): [number, number][][] {
  const patterns: [number, number][][] = [];

  // 1. 4 Corners
  patterns.push([[0, 0], [4, 0], [0, 4], [4, 4]]);

  // 2. 5 Horizontal lines
  for (let r = 0; r < 5; r++) {
    const line: [number, number][] = [];
    for (let c = 0; c < 5; c++) {
      if (c === 2 && r === 2) continue; // Free center
      line.push([c, r]);
    }
    patterns.push(line);
  }

  // 3. 5 Vertical lines
  for (let c = 0; c < 5; c++) {
    const line: [number, number][] = [];
    for (let r = 0; r < 5; r++) {
      if (c === 2 && r === 2) continue; // Free center
      line.push([c, r]);
    }
    patterns.push(line);
  }

  // 4. 2 Diagonals
  patterns.push([[0, 0], [1, 1], [3, 3], [4, 4]]); // Free center [2,2] skipped
  patterns.push([[0, 4], [1, 3], [3, 1], [4, 0]]); // Free center [2,2] skipped

  return patterns;
}

export interface RiggedBallPlan {
  shouldAiWin: boolean;
  winningBotUserIds?: string[];
  winningBotUserId?: string;
  winningCardId?: number;
  triggerBallIndex?: number; // 0-indexed position in ball sequence
  ballSequence: number[];
}

/**
 * Helper to find a second bot whose card also needs triggerBall to complete a line,
 * allowing a realistic simultaneous 2-winner split.
 */
function findSecondWinningBot(
  aiList: Array<{ userId: string; username: string; cards: number[] }>,
  excludeUserId: string,
  triggerBall: number,
  allPatterns: [number, number][][],
  existingPriorNumbers: number[],
  maxPriorAllowed: number
): { bot: { userId: string; username: string; cards: number[] }; cardId: number; priorNumbers: number[] } | null {
  const candidateBots = aiList.filter(b => b.userId !== excludeUserId).sort(() => Math.random() - 0.5);

  for (const bot of candidateBots) {
    for (const cardId of bot.cards) {
      const cardGrid = getDeterministicCard(cardId);
      for (const pattern of allPatterns) {
        const patternNums: number[] = [];
        let containsTrigger = false;
        for (const [c, r] of pattern) {
          const num = cardGrid[c][r];
          if (num === triggerBall) containsTrigger = true;
          if (num > 0 && !patternNums.includes(num)) patternNums.push(num);
        }

        if (containsTrigger) {
          const secondPriorNums = patternNums.filter(n => n !== triggerBall);
          const combinedPrior = Array.from(new Set([...existingPriorNumbers, ...secondPriorNums]));
          if (combinedPrior.length <= maxPriorAllowed) {
            return {
              bot,
              cardId,
              priorNumbers: secondPriorNums
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Plans the 75-ball sequence.
 * If AI should win:
 *  - Selects one of the AI cards.
 *  - Picks one winning pattern (4 or 5 numbers).
 *  - Places the final "trigger" number at a designated ball between minWinBall and maxWinBall (e.g. 16-31).
 *  - In ~10% of rounds, pairs with a 2nd bot whose pattern completes on the same trigger ball for an authentic multi-winner prize split.
 *  - Fills the rest of the numbers so no human completes a line before that ball.
 */
export function generatePlannedBallSequence(
  aiPlayers: Record<string, { userId: string; username: string; cards: number[] }>,
  humanPlayers: Record<string, { userId: string; username: string; cards: number[] }>,
  settings: BingoBotSettings
): RiggedBallPlan {
  const aiList = Object.values(aiPlayers);
  const roll = Math.random() * 100;
  const shouldAiWin = settings.enabled && aiList.length > 0 && roll < settings.winProbability;

  // Default Fisher-Yates shuffle
  const allBalls = Array.from({ length: 75 }, (_, i) => i + 1);
  for (let i = allBalls.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allBalls[i], allBalls[j]] = [allBalls[j], allBalls[i]];
  }

  if (!shouldAiWin) {
    return {
      shouldAiWin: false,
      ballSequence: allBalls,
    };
  }

  // Select a lucky AI bot and its card
  const luckyBot = aiList[Math.floor(Math.random() * aiList.length)];
  const luckyCardId = luckyBot.cards[Math.floor(Math.random() * luckyBot.cards.length)];
  const cardGrid = getDeterministicCard(luckyCardId);

  // Pick a winning pattern
  const allPatterns = getAllPatterns();
  const chosenPatternCoords = allPatterns[Math.floor(Math.random() * allPatterns.length)];
  const patternNumbers: number[] = [];

  for (const [c, r] of chosenPatternCoords) {
    const num = cardGrid[c][r];
    if (num > 0 && !patternNumbers.includes(num)) {
      patternNumbers.push(num);
    }
  }

  // Target winning ball count: between 15 and 33, with 70% probability between 15 and 22, and 30% between 23 and 33
  const configuredMin = settings.minWinBall || 15;
  const configuredMax = settings.maxWinBall || 33;
  const minBall = Math.max(patternNumbers.length, configuredMin);
  const maxBall = Math.min(50, configuredMax);

  let targetWinBallCount: number;
  const earlyMin = Math.max(patternNumbers.length, Math.max(minBall, 15));
  const earlyMax = Math.min(maxBall, 22);
  const lateMin = Math.max(patternNumbers.length, Math.max(minBall, 23));
  const lateMax = Math.min(maxBall, 33);

  if (earlyMin <= earlyMax && lateMin <= lateMax) {
    if (Math.random() < 0.70) {
      // 70% chance: winning ball is between 15 and 22
      targetWinBallCount = Math.floor(Math.random() * (earlyMax - earlyMin + 1)) + earlyMin;
    } else {
      // 30% chance: winning ball is between 23 and 33
      targetWinBallCount = Math.floor(Math.random() * (lateMax - lateMin + 1)) + lateMin;
    }
  } else {
    targetWinBallCount = Math.floor(Math.random() * (maxBall - minBall + 1)) + minBall;
  }
  const targetWinIndex = targetWinBallCount - 1; // 0-indexed

  // Designate the last pattern number as the trigger ball
  const triggerBall = patternNumbers[patternNumbers.length - 1];
  const priorPatternNumbers = patternNumbers.slice(0, patternNumbers.length - 1);
  const combinedPatternNumbers: number[] = [...patternNumbers];
  const winningBotUserIds: string[] = [luckyBot.userId];

  // 10% chance: trigger a realistic 2-player split win with another AI bot
  if (Math.random() < 0.10 && aiList.length >= 2) {
    const secondBotData = findSecondWinningBot(
      aiList,
      luckyBot.userId,
      triggerBall,
      allPatterns,
      priorPatternNumbers,
      targetWinIndex - 2
    );

    if (secondBotData) {
      winningBotUserIds.push(secondBotData.bot.userId);
      for (const num of secondBotData.priorNumbers) {
        if (!priorPatternNumbers.includes(num)) {
          priorPatternNumbers.push(num);
        }
        if (!combinedPatternNumbers.includes(num)) {
          combinedPatternNumbers.push(num);
        }
      }
    }
  }

  // Prepare the 75 ball slots
  const plannedSequence = new Array<number>(75);
  plannedSequence[targetWinIndex] = triggerBall;

  // Pick random distinct prior positions for priorPatternNumbers among [0 .. targetWinIndex - 1]
  const priorAvailableSlots: number[] = [];
  for (let s = 0; s < targetWinIndex; s++) {
    priorAvailableSlots.push(s);
  }
  // Shuffle prior slots
  for (let i = priorAvailableSlots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [priorAvailableSlots[i], priorAvailableSlots[j]] = [priorAvailableSlots[j], priorAvailableSlots[i]];
  }

  for (let i = 0; i < priorPatternNumbers.length; i++) {
    const slot = priorAvailableSlots[i];
    plannedSequence[slot] = priorPatternNumbers[i];
  }

  // Remaining pool of balls (exclude all numbers in combined winning patterns)
  const remainingBalls = allBalls.filter((b) => !combinedPatternNumbers.includes(b));
  let remainingPointer = 0;

  for (let i = 0; i < 75; i++) {
    if (plannedSequence[i] === undefined) {
      plannedSequence[i] = remainingBalls[remainingPointer++];
    }
  }

  return {
    shouldAiWin: true,
    winningBotUserIds,
    winningBotUserId: luckyBot.userId,
    winningCardId: luckyCardId,
    triggerBallIndex: targetWinIndex,
    ballSequence: plannedSequence,
  };
}
