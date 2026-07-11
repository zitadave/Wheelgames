import { processAnnouncements, loadAnnouncements } from './src/server/announcementManager.js';
import { getGridRooms } from './src/server/gridState.js';

const gridRooms = getGridRooms();
if (!gridRooms["mini"]) gridRooms["mini"] = { claimedSlots: {}, roundId: 1, history: [] };
gridRooms["mini"].claimedSlots[5] = { userId: "test" };

processAnnouncements({ telegram: { sendMessage: async (chatId, text, opts) => {
  console.log("SENDING MESSAGE:");
  console.log(text);
  return { message_id: 123 };
}}});
