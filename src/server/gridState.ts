import { logBot } from "./logger.js";
import { supabase } from "./supabase.js";
import fs from "fs";
import path from "path";

// Grid State singleton managed via globalThis to ensure consistency across module reloads
const GLOBAL_GRID_KEY = "__GLOBAL_GRID_ROOMS__";
const STATE_FILE = path.join(process.cwd(), "grid-state.json");

const defaultRooms = {
  '1-10': { claimedSlots: {}, roundId: 1001, history: [] },
  '1-20': { claimedSlots: {}, roundId: 1002, history: [] },
  'mini': { claimedSlots: {}, roundId: 1003, history: [] },
  'grand': { claimedSlots: {}, roundId: 1004, history: [] }
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch (e) {
    logBot(`[GridState] Error loading state file: ${e}`);
  }
  return null;
}

export function saveGridState() {
  try {
    const current = (globalThis as any)[GLOBAL_GRID_KEY] || gridRooms;
    fs.writeFileSync(STATE_FILE, JSON.stringify(current, null, 2));
    
    // Background async sync to Supabase
    if (supabase) {
      (async () => {
        try {
          const { error } = await supabase
            .from("bot_config")
            .upsert({
              key: "grid_state",
              value: JSON.stringify(current),
              updated_at: new Date().toISOString()
            });
          if (error) {
            logBot(`[GridState] Background save to Supabase error: ${error.message}`);
          } else {
            logBot(`[GridState] Background save to Supabase succeeded.`);
          }
        } catch (err) {
          logBot(`[GridState] Background save to Supabase exception: ${err}`);
        }
      })();
    }
  } catch (e) {
    logBot(`[GridState] Error saving state file: ${e}`);
  }
}

export async function syncFromSupabase() {
  try {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "grid_state")
      .single();
    if (data && data.value) {
      const dbState = JSON.parse(data.value);
      const current = (globalThis as any)[GLOBAL_GRID_KEY];
      if (current) {
        Object.keys(dbState).forEach(key => {
          current[key] = dbState[key];
        });
      }
      logBot(`[GridState] State loaded from Supabase.`);
    }
  } catch (e) {
    logBot(`[GridState] Error syncing state from Supabase: ${e}`);
  }
}

if (!(globalThis as any)[GLOBAL_GRID_KEY]) {
  logBot(`[GridState] Initializing global grid rooms state... (PID: ${process.pid})`);
  const saved = loadState();
  (globalThis as any)[GLOBAL_GRID_KEY] = saved || defaultRooms;
  syncFromSupabase().catch(e => logBot(`[GridState] Initial sync error: ${e}`));
} else {
  logBot(`[GridState] Re-using existing global grid rooms state. (PID: ${process.pid})`);
}

export const gridRooms: Record<string, any> = (globalThis as any)[GLOBAL_GRID_KEY];

export function getGridRooms() {
  return (globalThis as any)[GLOBAL_GRID_KEY];
}

// Fallback for any missing keys
Object.keys(defaultRooms).forEach(key => {
  if (!gridRooms[key]) {
    gridRooms[key] = (defaultRooms as any)[key];
  }
});

/**
 * Returns an array of available slot numbers (1 to maxSlots) that are not yet claimed.
 */
export async function getRemainingSlots(roomName: string, maxSlots: number, rooms: any): Promise<number[]> {
  const room = rooms[roomName];
  
  const claimedIndices = new Set<number>();
  
  // 1. Try memory
  if (room && room.claimedSlots) {
    Object.keys(room.claimedSlots).forEach(k => {
      const num = parseInt(k, 10);
      if (!isNaN(num)) claimedIndices.add(num);
    });
  }
  
  logBot(`[GridState] getRemainingSlots for ${roomName}: found ${claimedIndices.size} claimed slots in memory.`);

  const remaining: number[] = [];
  for (let i = 1; i <= maxSlots; i++) {
    if (!claimedIndices.has(i)) {
      remaining.push(i);
    }
  }
  return remaining;
}
