const fs = require('fs');
const path = require('path');

const botPath = path.join(__dirname, 'src/server/telegramBot.ts');
let botCode = fs.readFileSync(botPath, 'utf8');

const controlPanelCallback = `
    if (data === "control_announcements") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const anns = loadAnnouncements();
      let text = "📢 <b>Announcements Control</b>\\n\\n";
      text += \`Total announcements: \${anns.length}\\n\\n\`;
      text += "Use commands:\\n/announcement_list\\n/announcement_delete <id>";
      const keyboard = {
        inline_keyboard: [
           [{ text: "▶️ Test All Announcements Now", callback_data: "control_test_announcement_all" }],
           [{ text: "◀️ Back to Control Panel", callback_data: "control_panel_back" }]
        ]
      };
      bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      return;
    }
    
    if (data === "control_test_announcement_all") {
      if (!isStartingAdmin(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const { processAnnouncements } = require("./announcementManager.js");
      // Force trigger all
      const anns = loadAnnouncements();
      for (const ann of anns) {
        ann.lastRunTime = 0;
      }
      saveAnnouncements(anns);
      bot.sendMessage(chatId, "✅ All announcements will trigger on the next scheduler tick (max 5 mins). You can check the channel.");
      return;
    }
`;

if (!botCode.includes('if (data === "control_announcements") {')) {
  botCode = botCode.replace(
    'if (data === "control_manage_affiliate") {',
    controlPanelCallback + '\\n    if (data === "control_manage_affiliate") {'
  );
}

fs.writeFileSync(botPath, botCode, 'utf8');
console.log("Patched telegramBot.ts");
