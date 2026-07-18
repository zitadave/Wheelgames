import { supabase } from "./supabase.js";
import { logBot } from "./logger.js";

export interface GameConfig {
  id: string;
  nameAm: string;
  nameEn: string;
  enabled: boolean;
  minBet: number;
  maxBet: number;
  multiplier: number; // For EvenOdd, multiplier. For Keno, base scaling factor (default 1.0). For Jackpots/Bingo, entry fees or payout multipliers.
}

export interface SystemGameSettings {
  [key: string]: GameConfig;
}

const DEFAULT_SETTINGS: SystemGameSettings = {
  even_odd: {
    id: "even_odd",
    nameAm: "ሞላ/ጎደለ (Even/Odd)",
    nameEn: "Even/Odd (Mola/Godele)",
    enabled: true,
    minBet: 10,
    maxBet: 100000,
    multiplier: 2.0
  },
  keno: {
    id: "keno",
    nameAm: "ኬኖ (Keno)",
    nameEn: "Keno",
    enabled: true,
    minBet: 5,
    maxBet: 50000,
    multiplier: 1.0
  },
  bingo_10: {
    id: "bingo_10",
    nameAm: "ባለ 10 ቢንጎ (Bingo 10)",
    nameEn: "Bingo 10",
    enabled: true,
    minBet: 10,
    maxBet: 100,
    multiplier: 1.0
  },
  bingo_20: {
    id: "bingo_20",
    nameAm: "ባለ 20 ቢንጎ (Bingo 20)",
    nameEn: "Bingo 20",
    enabled: true,
    minBet: 20,
    maxBet: 200,
    multiplier: 1.0
  },
  jackpot_10: {
    id: "jackpot_10",
    nameAm: "ባለ 10 ጃክፖት (Jackpot 1-10)",
    nameEn: "Jackpot 1-10",
    enabled: true,
    minBet: 1000,
    maxBet: 1000,
    multiplier: 9.0
  },
  jackpot_20: {
    id: "jackpot_20",
    nameAm: "ባለ 20 ጃክፖት (Jackpot 1-20)",
    nameEn: "Jackpot 1-20",
    enabled: true,
    minBet: 1000,
    maxBet: 1000,
    multiplier: 18.0
  },
  jackpot_mini: {
    id: "jackpot_mini",
    nameAm: "ሚኒ ጃክፖት (Mini Jackpot)",
    nameEn: "Mini Jackpot",
    enabled: true,
    minBet: 2000,
    maxBet: 2000,
    multiplier: 1.0
  },
  jackpot_grand: {
    id: "jackpot_grand",
    nameAm: "ግራንድ ጃክፖት (Grand Jackpot)",
    nameEn: "Grand Jackpot",
    enabled: true,
    minBet: 2000,
    maxBet: 2000,
    multiplier: 1.0
  }
};

let cachedSettings: SystemGameSettings = { ...DEFAULT_SETTINGS };
let isLoaded = false;

export async function loadGameSettings(): Promise<SystemGameSettings> {
  if (isLoaded) return cachedSettings;
  try {
    if (!supabase) {
      logBot("[GameSettings] Supabase client not initialized. Using default settings.");
      return cachedSettings;
    }
    const { data, error } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "game_settings")
      .single();

    if (error) {
      if (error.code !== "PGRST116") { // PGRST116 is 'no rows found'
        logBot(`[GameSettings] Error loading game settings from DB: ${error.message}`);
      } else {
        logBot("[GameSettings] Game settings not found in DB. Saving default settings.");
        await saveGameSettings(DEFAULT_SETTINGS);
      }
      return cachedSettings;
    }

    if (data && data.value) {
      const dbSettings = JSON.parse(data.value);
      // Merge with default settings to ensure any new keys are populated
      cachedSettings = { ...DEFAULT_SETTINGS, ...dbSettings };
      isLoaded = true;
      logBot("[GameSettings] Settings loaded successfully from Supabase.");
    }
  } catch (err: any) {
    logBot(`[GameSettings] Exception loading game settings: ${err.message}`);
  }
  return cachedSettings;
}

export async function saveGameSettings(settings: SystemGameSettings): Promise<boolean> {
  try {
    cachedSettings = { ...settings };
    if (!supabase) {
      logBot("[GameSettings] Supabase client not initialized. Cannot save to DB.");
      return false;
    }
    const { error } = await supabase
      .from("bot_config")
      .upsert({
        key: "game_settings",
        value: JSON.stringify(settings),
        updated_at: new Date().toISOString()
      });

    if (error) {
      logBot(`[GameSettings] Error saving game settings: ${error.message}`);
      return false;
    }
    logBot("[GameSettings] Game settings saved successfully to DB.");
    return true;
  } catch (err: any) {
    logBot(`[GameSettings] Exception saving game settings: ${err.message}`);
    return false;
  }
}

export function getGameSettingsSync(): SystemGameSettings {
  return cachedSettings;
}

// Helper methods
export function isGameEnabled(gameId: string): boolean {
  return cachedSettings[gameId]?.enabled ?? true;
}

export function getGameConfig(gameId: string): GameConfig | undefined {
  return cachedSettings[gameId];
}
