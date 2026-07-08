const fs = require('fs');
const path = require('path');

const botPath = path.join(__dirname, 'src/server/telegramBot.ts');
let botCode = fs.readFileSync(botPath, 'utf8');

if (!botCode.includes('/list_of_recent_announcement')) {
  botCode = botCode.replace(
    /bot\.onText\(\/\\\/announcement\/, \(msg\) => \{/,
    \`bot.onText(/\\/list_of_recent_announcement/, (msg) => {
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
      text += \\\`<b>ID:</b> <code>\${a.id}</code>\\n<b>Type:</b> \${a.type}\\n<b>Interval (hrs):</b> \${a.intervalHours}\\n<b>Enabled:</b> \${a.enabled}\\n\\n\\\`;
    });
    bot.sendMessage(chatId, text, { parse_mode: "HTML" });
  });

  bot.onText(/\\/announcement/, (msg) => {\`
  );
  fs.writeFileSync(botPath, botCode, 'utf8');
}
