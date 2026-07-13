const fs = require('fs');
let content = fs.readFileSync('src/server/telegramBot.ts', 'utf8');

// Revert lines 2596-2615
content = content.replace(
  `await downloadAndSendPhoto(bot, chatId, promptsConfig.welcome_image, { \n              caption: welcomeMsg, \n              parse_mode: "Markdown", \n              reply_markup: { inline_keyboard: welcomeButtonsRows } \n            });`,
  `await bot.sendPhoto(chatId, promptsConfig.welcome_image, { caption: welcomeMsg, parse_mode: "Markdown", reply_markup: { inline_keyboard: welcomeButtonsRows } })\n              .catch(() => bot.sendMessage(chatId, welcomeMsg, { parse_mode: "Markdown", reply_markup: { inline_keyboard: welcomeButtonsRows } }));`
);

content = content.replace(
  `await downloadAndSendPhoto(bot, chatId, promptsConfig.welcome_guest_image, { \n              caption: desc, \n              parse_mode: "HTML", \n              reply_markup: markup \n            });`,
  `await bot.sendPhoto(chatId, promptsConfig.welcome_guest_image, { caption: desc, parse_mode: "HTML", reply_markup: markup })\n              .catch(() => bot.sendMessage(chatId, desc, { parse_mode: "HTML", reply_markup: markup }));`
);

content = content.replace(
  `await downloadAndSendPhoto(bot, chatId, customCmd.photo, {\n              caption: customCmd.text,\n              parse_mode: "HTML",\n              reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined\n            });`,
  `await bot.sendPhoto(chatId, customCmd.photo, {\n              caption: customCmd.text,\n              parse_mode: "HTML",\n              reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined\n            });`
);

fs.writeFileSync('src/server/telegramBot.ts', content);
