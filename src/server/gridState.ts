import { logBot } from "./logger.js";

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

// Fallback for any missing keys
Object.keys(defaultRooms).forEach(key => {
  if (!gridRooms[key]) {
    gridRooms[key] = (defaultRooms as any)[key];
  }
});

/**
 * Returns an array of available slot numbers (1 to maxSlots) that are not yet claimed.
 */
export function getRemainingSlots(roomName: string, maxSlots: number): number[] {
  const room = gridRooms[roomName];
  if (!room) {
    logBot(`[GridState] getRemainingSlots: Room "${roomName}" not found!`);
    return [];
  }

  const remaining: number[] = [];
  const claimed = room.claimedSlots || {};
  const claimedCount = Object.keys(claimed).length;
  
  logBot(`[GridState] getRemainingSlots for ${roomName}: claimedCount=${claimedCount}, claimedKeys=${Object.keys(claimed)}`);

  const claimedIndices = new Set();
  Object.keys(claimed).forEach(k => {
    const num = parseInt(k, 10);
    if (!isNaN(num)) claimedIndices.add(num);
  });

  for (let i = 1; i <= maxSlots; i++) {
    if (!claimedIndices.has(i)) {
      remaining.push(i);
    }
  }

  return remaining;
}
