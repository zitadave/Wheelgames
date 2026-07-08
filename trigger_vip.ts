import { processAnnouncements, loadAnnouncements, saveAnnouncements } from "./src/server/announcementManager.js";
import { bot } from "./src/server/telegramBot.js";
import 'dotenv/config';

const anns = loadAnnouncements();
for (const ann of anns) {
  if (ann.id === "vip_slots_1") {
    ann.lastRunTime = 0;
  }
}
saveAnnouncements(anns);
processAnnouncements(bot).then(() => {
  console.log("Triggered announcements.");
  process.exit(0);
});
