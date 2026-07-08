const fs = require('fs');
const path = require('path');

const botPath = path.join(__dirname, 'src/server/telegramBot.ts');
let botCode = fs.readFileSync(botPath, 'utf8');

// Add import
if (!botCode.includes('startAnnouncementScheduler')) {
  botCode = botCode.replace(
    'import { fetchLeaderboardData, getStartOfWeekUTC } from "./leaderboardHelper.js";',
    'import { fetchLeaderboardData, getStartOfWeekUTC } from "./leaderboardHelper.js";\nimport { startAnnouncementScheduler, loadAnnouncements, saveAnnouncements, Announcement } from "./announcementManager.js";'
  );

  // Add the scheduler
  botCode = botCode.replace(
    'startAutoCampaignScheduler(bot);',
    'startAutoCampaignScheduler(bot);\n  startAnnouncementScheduler(bot);'
  );
}

// Add commands /announcement_list and /announcement_delete
const announcementCmds = `
  bot.onText(/\\/announcement_list/, (msg) => {
    const chatId = msg.chat.id;
    if (!isStartingAdmin(msg.from?.id)) {
      return bot.sendMessage(chatId, "❌ Access Denied.");
    }
    const anns = loadAnnouncements();
    if (anns.length === 0) {
      return bot.sendMessage(chatId, "No announcements configured.");
    }
    let text = "📢 <b>Announcements:</b>\\n\\n";
    anns.forEach(a => {
      text += \`<b>ID:</b> <code>\${a.id}</code>\\n<b>Type:</b> \${a.type}\\n<b>Interval (hrs):</b> \${a.intervalHours}\\n<b>Enabled:</b> \${a.enabled}\\n\\n\`;
    });
    bot.sendMessage(chatId, text, { parse_mode: "HTML" });
  });

  bot.onText(/\\/announcement_delete(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!isStartingAdmin(msg.from?.id)) {
      return bot.sendMessage(chatId, "❌ Access Denied.");
    }
    const id = match && match[1];
    if (!id) return bot.sendMessage(chatId, "Please specify an ID. Usage: /announcement_delete <id>");
    
    let anns = loadAnnouncements();
    const initialLen = anns.length;
    anns = anns.filter(a => a.id !== id);
    if (anns.length < initialLen) {
      saveAnnouncements(anns);
      bot.sendMessage(chatId, \`✅ Announcement \${id} deleted.\`);
    } else {
      bot.sendMessage(chatId, \`❌ Announcement \${id} not found.\`);
    }
  });
`;

if (!botCode.includes('/announcement_list')) {
  botCode = botCode.replace(
    'bot.onText(/\\/setadmin/, (msg) => {',
    announcementCmds + '\n  bot.onText(/\\/setadmin/, (msg) => {'
  );
}

// Add to control panel
const controlPanelButton = '{ text: "📢 Announcements", callback_data: "control_announcements" }';
if (!botCode.includes('control_announcements')) {
  botCode = botCode.replace(
    '{ text: "🤝 Manage Affiliate", callback_data: "control_manage_affiliate" }',
    '{ text: "🤝 Manage Affiliate", callback_data: "control_manage_affiliate" },\n          ' + controlPanelButton
  );

  const controlPanelCallback = `
    } else if (data === "control_announcements") {
      const anns = loadAnnouncements();
      let text = "📢 <b>Announcements Control</b>\\n\\n";
      text += \`Total announcements: \${anns.length}\\n\\n\`;
      text += "Use commands:\\n/announcement_list\\n/announcement_delete <id>";
      bot.sendMessage(chatId, text, { parse_mode: "HTML" });
  `;

  botCode = botCode.replace(
    '} else if (data === "control_manage_affiliate") {',
    controlPanelCallback + '\n    } else if (data === "control_manage_affiliate") {'
  );
}

fs.writeFileSync(botPath, botCode, 'utf8');
console.log("Patched telegramBot.ts");
