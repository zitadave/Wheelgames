import { logBot } from "./logger.js";
import { supabase } from "./supabase.js";

// Grid State singleton managed via globalThis to ensure consistency across module reloads
const GLOBAL_GRID_KEY = "__GLOBAL_GRID_ROOMS__";

const defaultRooms = {
  '1-10': { claimedSlots: {}, roundId: 1001, history: [] },
  '1-20': { claimedSlots: {}, roundId: 1002, history: [] },
  'mini': { claimedSlots: {}, roundId: 1003, history: [] },
  'grand': { claimedSlots: {}, roundId: 1004, history: [] }
};

if (!(globalThis as any)[GLOBAL_GRID_KEY]) {
  logBot(`[GridState] Initializing global grid rooms state... (PID: ${process.pid})`);
  (globalThis as any)[GLOBAL_GRID_KEY] = defaultRooms;
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
  logBot(`[GridState] getRemainingSlots for ${roomName}: roomName=${roomName}, room.roundId=${room?.roundId}`);

  // 2. Get the current round UUID for the room
  let currentRoundUuid;
  if (room && room.roundId) {
      const { data: roundData, error: roundError } = await supabase
        .from('rounds')
        .select('id')
        .eq('room_id', roomName)
        .eq('round_number', room.roundId)
        .maybeSingle();
      
      if (roundError) {
        logBot(`[GridState] Error finding round: ${JSON.stringify(roundError)}`);
      }
      currentRoundUuid = roundData?.id;
  }
  
  if (!currentRoundUuid) {
      logBot(`[GridState] No round UUID found for ${roomName}, round ${room.roundId || 'unknown'}. Falling back to latest round.`);
      const { data: latestRound } = await supabase
        .from('rounds')
        .select('id, round_number')
        .eq('room_id', roomName)
        .order('round_number', { ascending: false })
        .limit(1);
      logBot(`[GridState] Latest round found: ${JSON.stringify(latestRound?.[0])}`);
      currentRoundUuid = latestRound?.[0]?.id;
  }
  
  if (!currentRoundUuid) {
      logBot(`[GridState] Still no round UUID found for ${roomName}. Returning slots from memory.`);
  } else {
      logBot(`[GridState] getRemainingSlots for ${roomName}: using round_id=${currentRoundUuid}.`);
    
      // Fetching bets with room_id as well, in case that's needed!
      const { data: bets, error } = await supabase
        .from('bets')
        .select('side, rounds(room_id)')
        .eq('round_id', currentRoundUuid);
      
      if (error) logBot(`[GridState] Supabase error: ${error.message}`);
    
      if (bets && bets.length > 0) {
          logBot(`[GridState] getRemainingSlots for ${roomName}: processing ${bets.length} bets.`);
          
          const filteredBets = bets?.filter(b => {
              const roomId = (b.rounds as any)?.room_id;
              return roomId === roomName || !roomId; // Fallback if rounds join fails
          });
          
          filteredBets?.forEach(b => {
              const slotNum = parseInt(b.side, 10);
              if (!isNaN(slotNum)) claimedIndices.add(slotNum);
          });
          
          logBot(`[GridState] getRemainingSlots for ${roomName}: found ${claimedIndices.size} total claimed slots after Supabase.`);
      } else {
          logBot(`[GridState] getRemainingSlots for ${roomName}: No bets found in Supabase for round ${currentRoundUuid}.`);
      }
  }

  const remaining: number[] = [];
  for (let i = 1; i <= maxSlots; i++) {
    if (!claimedIndices.has(i)) {
      remaining.push(i);
    }
  }
  return remaining;
}
