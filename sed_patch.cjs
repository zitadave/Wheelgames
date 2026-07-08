const fs = require('fs');
let code = fs.readFileSync('src/server/telegramBot.ts', 'utf8');

const newCode = `  bot.onText(/\\/list_of_recent_announcement/, (msg) => {
    const chatId = msg.chat.id;
    if (!isStartingAdmin(msg.from?.id)) {
      return bot.sendMessage(chatId, "❌ Access Denied.");
    }
    const anns = loadAnnouncements();
    if (anns.length === 0) {
      return bot.sendMessage(chatId, "📋 Recent Announcements:\\n\\nNo announcements found.");
    }
    let text = "📢 <b>Recent Announcements:</b>\\n\\n";
    anns.forEach(a => {
      text += "<b>ID:</b> <code>" + a.id + "</code>\\n<b>Type:</b> " + a.type + "\\n<b>Interval (hrs):</b> " + a.intervalHours + "\\n<b>Enabled:</b> " + a.enabled + "\\n\\n";
    });
    bot.sendMessage(chatId, text, { parse_mode: "HTML" });
  });

  bot.onText(/\\/announcement/, (msg) => {`;

code = code.replace('  bot.onText(/\\/announcement/, (msg) => {', newCode);
fs.writeFileSync('src/server/telegramBot.ts', code, 'utf8');
